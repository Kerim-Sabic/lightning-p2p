//! Windows GATT transport for Lightning Chat mesh packets.
#![allow(clippy::needless_pass_by_value)]

use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
    sync::{Mutex, OnceLock},
    thread,
};
use windows::{
    core::GUID,
    Devices::Bluetooth::{
        Advertisement::BluetoothLEAdvertisement,
        BluetoothLEDevice,
        GenericAttributeProfile::{
            GattCharacteristic, GattCharacteristicProperties,
            GattClientCharacteristicConfigurationDescriptorValue, GattCommunicationStatus,
            GattDeviceService, GattLocalCharacteristic, GattLocalCharacteristicParameters,
            GattProtectionLevel, GattServiceProvider, GattServiceProviderAdvertisingParameters,
            GattValueChangedEventArgs, GattWriteOption, GattWriteRequestedEventArgs,
        },
    },
    Foundation::TypedEventHandler,
};

use super::ble::{buffer_to_bytes, bytes_to_buffer};

const CHAT_SERVICE_UUID: GUID = GUID::from_u128(0xf47b5e2d_4a9e_4c5a_9b3f_8e1d2c3a4b5c);
const CHAT_CHARACTERISTIC_UUID: GUID = GUID::from_u128(0xa1b2c3d4_e5f6_4a5b_8c9d_0e1f2a3b4c5d);
const MAX_PACKET_BYTES: usize = 65_535;
const MAX_QUEUE_PACKETS: usize = 512;

static SESSION: OnceLock<Mutex<ChatBleSession>> = OnceLock::new();
type IncomingPacketQueue = VecDeque<(u64, Vec<u8>)>;

static INCOMING: OnceLock<Mutex<IncomingPacketQueue>> = OnceLock::new();

#[derive(Default)]
struct ChatBleSession {
    provider: Option<GattServiceProvider>,
    local_characteristic: Option<GattLocalCharacteristic>,
    local_write_token: Option<i64>,
    remotes: Vec<RemoteGatt>,
    connecting: HashSet<u64>,
}

struct RemoteGatt {
    address: u64,
    _device: BluetoothLEDevice,
    _service: GattDeviceService,
    characteristic: GattCharacteristic,
    value_changed_token: i64,
}

/// Starts a connectable GATT service that receives writes and notifies
/// subscribed peers.
///
/// # Errors
///
/// Returns an error when Windows cannot create or advertise the service.
pub fn start() -> Result<(), String> {
    stop()?;
    let operation = GattServiceProvider::CreateAsync(CHAT_SERVICE_UUID).map_err(windows_error)?;
    let result =
        tauri::async_runtime::block_on(async move { operation.await }).map_err(windows_error)?;
    let provider = result.ServiceProvider().map_err(windows_error)?;
    let service = provider.Service().map_err(windows_error)?;
    let parameters = GattLocalCharacteristicParameters::new().map_err(windows_error)?;
    parameters
        .SetCharacteristicProperties(GattCharacteristicProperties(
            GattCharacteristicProperties::Read.0
                | GattCharacteristicProperties::Write.0
                | GattCharacteristicProperties::WriteWithoutResponse.0
                | GattCharacteristicProperties::Notify.0,
        ))
        .map_err(windows_error)?;
    parameters
        .SetReadProtectionLevel(GattProtectionLevel::Plain)
        .map_err(windows_error)?;
    parameters
        .SetWriteProtectionLevel(GattProtectionLevel::Plain)
        .map_err(windows_error)?;
    let operation = service
        .CreateCharacteristicAsync(CHAT_CHARACTERISTIC_UUID, &parameters)
        .map_err(windows_error)?;
    let result =
        tauri::async_runtime::block_on(async move { operation.await }).map_err(windows_error)?;
    let characteristic = result.Characteristic().map_err(windows_error)?;
    let write_handler =
        TypedEventHandler::<GattLocalCharacteristic, GattWriteRequestedEventArgs>::new(
            |_, args| {
                if let Some(args) = args.as_ref() {
                    handle_local_write(args);
                }
                Ok(())
            },
        );
    let write_token = characteristic
        .WriteRequested(&write_handler)
        .map_err(windows_error)?;
    let advertising = GattServiceProviderAdvertisingParameters::new().map_err(windows_error)?;
    advertising.SetIsConnectable(true).map_err(windows_error)?;
    advertising.SetIsDiscoverable(true).map_err(windows_error)?;
    provider
        .StartAdvertisingWithParameters(&advertising)
        .map_err(windows_error)?;

    let mut session = lock(session(), "chat BLE session")?;
    session.provider = Some(provider);
    session.local_characteristic = Some(characteristic);
    session.local_write_token = Some(write_token);
    Ok(())
}

/// Stops the GATT service and releases remote subscriptions. Idempotent.
///
/// # Errors
///
/// Returns an error if the session lock is poisoned.
pub fn stop() -> Result<(), String> {
    let mut session = lock(session(), "chat BLE session")?;
    if let Some(characteristic) = session.local_characteristic.take() {
        if let Some(token) = session.local_write_token.take() {
            let _ = characteristic.RemoveWriteRequested(token);
        }
    }
    if let Some(provider) = session.provider.take() {
        let _ = provider.StopAdvertising();
    }
    for remote in session.remotes.drain(..) {
        let _ = remote
            .characteristic
            .RemoveValueChanged(remote.value_changed_token);
    }
    session.connecting.clear();
    Ok(())
}

/// Observes advertisements from the shared active scanner and connects to
/// peers that publish the mesh service UUID.
pub fn observe_advertisement(address: u64, advertisement: &BluetoothLEAdvertisement) {
    let Ok(uuids) = advertisement.ServiceUuids() else {
        return;
    };
    let Ok(count) = uuids.Size() else {
        return;
    };
    let advertises_chat = (0..count).any(|index| {
        uuids
            .GetAt(index)
            .is_ok_and(|uuid| uuid == CHAT_SERVICE_UUID)
    });
    if !advertises_chat {
        return;
    }
    let should_connect = session().lock().ok().is_some_and(|mut session| {
        if session
            .remotes
            .iter()
            .any(|remote| remote.address == address)
            || session.connecting.contains(&address)
        {
            false
        } else {
            session.connecting.insert(address);
            true
        }
    });
    if should_connect {
        let _ = thread::Builder::new()
            .name("lightning-chat-ble-connect".into())
            .spawn(move || {
                let result = connect_remote(address);
                if let Ok(mut session) = session().lock() {
                    session.connecting.remove(&address);
                }
                if let Err(error) = result {
                    tracing::debug!(address, %error, "chat BLE peer connection failed");
                }
            });
    }
}

/// Sends one already-framed packet to connected central peers and subscribed
/// peripheral peers.
///
/// # Errors
///
/// Returns an error for an oversized frame, buffer conversion failure, or
/// when every available BLE path rejects the write.
pub fn send_packet(bytes: &[u8]) -> Result<usize, String> {
    if bytes.is_empty() || bytes.len() > MAX_PACKET_BYTES {
        return Err("chat BLE packet is outside size limits".into());
    }
    let (local, remotes) = {
        let session = lock(session(), "chat BLE session")?;
        (
            session.local_characteristic.clone(),
            session
                .remotes
                .iter()
                .map(|remote| remote.characteristic.clone())
                .collect::<Vec<_>>(),
        )
    };
    let mut delivered = 0;
    if let Some(characteristic) = local {
        let buffer = bytes_to_buffer(bytes)?;
        if let Ok(operation) = characteristic.NotifyValueAsync(&buffer) {
            if tauri::async_runtime::block_on(async move { operation.await }).is_ok() {
                delivered += 1;
            }
        }
    }
    for characteristic in remotes {
        let buffer = bytes_to_buffer(bytes)?;
        let Ok(operation) = characteristic
            .WriteValueWithOptionAsync(&buffer, GattWriteOption::WriteWithoutResponse)
        else {
            continue;
        };
        if tauri::async_runtime::block_on(async move { operation.await })
            .is_ok_and(|status| status == GattCommunicationStatus::Success)
        {
            delivered += 1;
        }
    }
    if delivered == 0 {
        return Err("no connected BLE peer accepted the chat packet".into());
    }
    Ok(delivered)
}

/// Drains received GATT packets as `(bluetooth_address, bytes)` pairs.
///
/// # Errors
///
/// Returns an error if the receive queue lock is poisoned.
pub fn drain_packets() -> Result<Vec<(u64, Vec<u8>)>, String> {
    let mut packets = lock(incoming(), "chat BLE incoming queue")?;
    Ok(packets.drain(..).collect())
}

#[must_use]
pub fn connected_peer_count() -> usize {
    session().lock().map_or(0, |session| session.remotes.len())
}

#[must_use]
pub fn is_advertising() -> bool {
    session()
        .lock()
        .ok()
        .and_then(|session| session.provider.clone())
        .is_some_and(|provider| {
            provider
                .AdvertisementStatus()
                .is_ok_and(|status| status.0 == 1)
        })
}

fn connect_remote(address: u64) -> Result<(), String> {
    let operation = BluetoothLEDevice::FromBluetoothAddressAsync(address).map_err(windows_error)?;
    let device =
        tauri::async_runtime::block_on(async move { operation.await }).map_err(windows_error)?;
    let operation = device
        .GetGattServicesForUuidAsync(CHAT_SERVICE_UUID)
        .map_err(windows_error)?;
    let services_result =
        tauri::async_runtime::block_on(async move { operation.await }).map_err(windows_error)?;
    if services_result.Status().map_err(windows_error)? != GattCommunicationStatus::Success {
        return Err("chat GATT service discovery failed".into());
    }
    let services = services_result.Services().map_err(windows_error)?;
    if services.Size().map_err(windows_error)? == 0 {
        return Err("chat GATT service was not found".into());
    }
    let service = services.GetAt(0).map_err(windows_error)?;
    let operation = service
        .GetCharacteristicsForUuidAsync(CHAT_CHARACTERISTIC_UUID)
        .map_err(windows_error)?;
    let characteristics_result =
        tauri::async_runtime::block_on(async move { operation.await }).map_err(windows_error)?;
    if characteristics_result.Status().map_err(windows_error)? != GattCommunicationStatus::Success {
        return Err("chat GATT characteristic discovery failed".into());
    }
    let characteristics = characteristics_result
        .Characteristics()
        .map_err(windows_error)?;
    if characteristics.Size().map_err(windows_error)? == 0 {
        return Err("chat GATT characteristic was not found".into());
    }
    let characteristic = characteristics.GetAt(0).map_err(windows_error)?;
    let value_handler =
        TypedEventHandler::<GattCharacteristic, GattValueChangedEventArgs>::new(move |_, args| {
            if let Some(args) = args.as_ref() {
                if let Ok(buffer) = args.CharacteristicValue() {
                    if let Ok(bytes) = buffer_to_bytes(&buffer) {
                        push_incoming(address, bytes);
                    }
                }
            }
            Ok(())
        });
    let value_changed_token = characteristic
        .ValueChanged(&value_handler)
        .map_err(windows_error)?;
    let operation = characteristic
        .WriteClientCharacteristicConfigurationDescriptorAsync(
            GattClientCharacteristicConfigurationDescriptorValue::Notify,
        )
        .map_err(windows_error)?;
    let status =
        tauri::async_runtime::block_on(async move { operation.await }).map_err(windows_error)?;
    if status != GattCommunicationStatus::Success {
        let _ = characteristic.RemoveValueChanged(value_changed_token);
        return Err("chat GATT notification subscription failed".into());
    }
    lock(session(), "chat BLE session")?
        .remotes
        .push(RemoteGatt {
            address,
            _device: device,
            _service: service,
            characteristic,
            value_changed_token,
        });
    Ok(())
}

fn handle_local_write(args: &GattWriteRequestedEventArgs) {
    let address = args
        .Session()
        .and_then(|session| session.DeviceId())
        .and_then(|device_id| device_id.Id())
        .map_or(0, |device_id| {
            let digest = Sha256::digest(device_id.to_string().as_bytes());
            u64::from_be_bytes(digest[..8].try_into().expect("SHA-256 prefix"))
        });
    let Ok(operation) = args.GetRequestAsync() else {
        return;
    };
    let Ok(request) = tauri::async_runtime::block_on(async move { operation.await }) else {
        return;
    };
    let bytes = request
        .Value()
        .map_err(windows_error)
        .and_then(|buffer| buffer_to_bytes(&buffer));
    match bytes {
        Ok(bytes) if !bytes.is_empty() && bytes.len() <= MAX_PACKET_BYTES => {
            push_incoming(address, bytes);
            let _ = request.Respond();
        }
        _ => {
            let _ = request.RespondWithProtocolError(0x0d);
        }
    }
}

fn push_incoming(address: u64, bytes: Vec<u8>) {
    if let Ok(mut packets) = incoming().lock() {
        packets.push_back((address, bytes));
        while packets.len() > MAX_QUEUE_PACKETS {
            packets.pop_front();
        }
    }
}

fn session() -> &'static Mutex<ChatBleSession> {
    SESSION.get_or_init(|| Mutex::new(ChatBleSession::default()))
}

fn incoming() -> &'static Mutex<IncomingPacketQueue> {
    INCOMING.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn lock<'a, T>(mutex: &'a Mutex<T>, label: &str) -> Result<std::sync::MutexGuard<'a, T>, String> {
    mutex
        .lock()
        .map_err(|_| format!("{label} lock is poisoned"))
}

fn windows_error(error: windows::core::Error) -> String {
    error.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_service_and_characteristic_ids_are_stable() {
        assert_eq!(
            CHAT_SERVICE_UUID,
            GUID::from_u128(0xf47b5e2d_4a9e_4c5a_9b3f_8e1d2c3a4b5c)
        );
        assert_eq!(
            CHAT_CHARACTERISTIC_UUID,
            GUID::from_u128(0xa1b2c3d4_e5f6_4a5b_8c9d_0e1f2a3b4c5d)
        );
    }

    #[test]
    fn incoming_queue_is_bounded() {
        for index in 0..(MAX_QUEUE_PACKETS + 10) {
            push_incoming(index as u64, vec![1]);
        }
        let drained = drain_packets().expect("drain");
        assert_eq!(drained.len(), MAX_QUEUE_PACKETS);
    }
}
