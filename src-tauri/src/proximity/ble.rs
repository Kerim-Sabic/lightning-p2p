//! Windows Bluetooth LE proximity discovery.
//!
//! The beacon carries only the local iroh `NodeId`, split across small service
//! data frames so it fits legacy BLE advertisements. File bytes still move over
//! iroh QUIC and iroh-blobs.

use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    fmt::Write as _,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use windows::{
    core::GUID,
    Devices::Bluetooth::Advertisement::{
        BluetoothLEAdvertisement, BluetoothLEAdvertisementDataSection,
        BluetoothLEAdvertisementDataTypes, BluetoothLEAdvertisementPublisher,
        BluetoothLEAdvertisementReceivedEventArgs, BluetoothLEAdvertisementWatcher,
        BluetoothLEScanningMode,
    },
    Foundation::TypedEventHandler,
    Storage::Streams::{DataReader, DataWriter, IBuffer},
};

const SERVICE_UUID: GUID = GUID::from_u128(0x4c50324c_7032_7032_7032_4c6967687431);
const PROTOCOL_VERSION: u8 = 1;
const CHUNK_DATA_BYTES: usize = 9;
const MAX_CHUNKS: usize = 8;
const ROTATION_MS: u64 = 900;
const PARTIAL_STALE_MS: i64 = 20_000;
const MAX_DISCOVERIES: usize = 64;

static SESSION: OnceLock<Mutex<BleSession>> = OnceLock::new();
static DISCOVERIES: OnceLock<Mutex<VecDeque<(String, i64)>>> = OnceLock::new();
static PARTIALS: OnceLock<Mutex<HashMap<u64, PartialNodeId>>> = OnceLock::new();
static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static SCANNING: AtomicBool = AtomicBool::new(false);
static ADVERTISING: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
struct BleSession {
    watcher: Option<BluetoothLEAdvertisementWatcher>,
    received_token: Option<i64>,
    advertise_signal: Option<Arc<AtomicBool>>,
}

#[derive(Debug)]
struct PartialNodeId {
    total: usize,
    chunks: BTreeMap<usize, Vec<u8>>,
    last_seen_ms: i64,
}

impl PartialNodeId {
    fn new(total: usize, last_seen_ms: i64) -> Self {
        Self {
            total,
            chunks: BTreeMap::new(),
            last_seen_ms,
        }
    }

    fn joined(&self) -> Option<Vec<u8>> {
        if self.chunks.len() < self.total {
            return None;
        }
        let mut out = Vec::with_capacity(self.total * CHUNK_DATA_BYTES);
        for index in 0..self.total {
            out.extend(self.chunks.get(&index)?);
        }
        Some(out)
    }
}

/// Start Windows BLE scan and advertise using the Lightning P2P beacon.
///
/// # Errors
///
/// Returns an error when the `WinRT` BLE watcher or publisher cannot be created.
pub fn start(node_id_hex: &str) -> Result<bool, String> {
    let payloads = build_node_id_payloads(node_id_hex)?;
    stop()?;
    set_last_error(None);

    let scanning = start_watcher().map_or_else(
        |error| {
            set_last_error(Some(error));
            false
        },
        |()| true,
    );
    let advertising = start_advertising(payloads).map_or_else(
        |error| {
            set_last_error(Some(error));
            false
        },
        |()| true,
    );

    Ok(scanning || advertising)
}

/// Stop Windows BLE scan and advertise. Idempotent.
///
/// # Errors
///
/// Returns an error if the session lock is poisoned.
pub fn stop() -> Result<(), String> {
    let mut session = lock(session(), "BLE session")?;
    if let Some(signal) = session.advertise_signal.take() {
        signal.store(false, Ordering::SeqCst);
    }
    if let Some(watcher) = session.watcher.take() {
        if let Some(token) = session.received_token.take() {
            let _ = watcher.RemoveReceived(token);
        }
        let _ = watcher.Stop();
    }
    SCANNING.store(false, Ordering::SeqCst);
    ADVERTISING.store(false, Ordering::SeqCst);
    Ok(())
}

/// Drain Windows BLE discoveries as (`node_id_hex`, `epoch_ms`) pairs.
///
/// # Errors
///
/// Returns an error if the discovery queue lock is poisoned.
pub fn drain_discoveries() -> Result<Vec<(String, i64)>, String> {
    let mut guard = lock(discoveries(), "BLE discoveries")?;
    Ok(guard.drain(..).collect())
}

/// Returns whether the `WinRT` watcher is running.
#[must_use]
pub fn is_scanning() -> bool {
    SCANNING.load(Ordering::SeqCst)
}

/// Returns whether the `WinRT` publisher loop is running.
#[must_use]
pub fn is_advertising() -> bool {
    ADVERTISING.load(Ordering::SeqCst)
}

/// Returns the current Windows BLE permission state.
#[must_use]
pub const fn permission_state() -> &'static str {
    "granted"
}

/// Returns whether the `WinRT` BLE watcher can be activated.
#[must_use]
pub fn adapter_state() -> &'static str {
    if BluetoothLEAdvertisementWatcher::new().is_ok() {
        "available"
    } else {
        "unavailable"
    }
}

/// Returns the most recent user-actionable BLE error.
#[must_use]
pub fn last_error() -> Option<String> {
    LAST_ERROR
        .get_or_init(|| Mutex::new(None))
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
}

fn start_watcher() -> Result<(), String> {
    let watcher = BluetoothLEAdvertisementWatcher::new().map_err(windows_error)?;
    watcher
        .SetScanningMode(BluetoothLEScanningMode::Active)
        .map_err(windows_error)?;
    let handler = TypedEventHandler::<
        BluetoothLEAdvertisementWatcher,
        BluetoothLEAdvertisementReceivedEventArgs,
    >::new(|_, args| {
        if let Some(args) = args.as_ref() {
            if let Err(error) = handle_received(args) {
                set_last_error(Some(error));
            }
        }
        Ok(())
    });
    let token = watcher.Received(&handler).map_err(windows_error)?;
    watcher.Start().map_err(windows_error)?;

    let mut session = lock(session(), "BLE session")?;
    session.received_token = Some(token);
    session.watcher = Some(watcher);
    SCANNING.store(true, Ordering::SeqCst);
    Ok(())
}

fn start_advertising(payloads: Vec<Vec<u8>>) -> Result<(), String> {
    let signal = Arc::new(AtomicBool::new(true));
    {
        let mut session = lock(session(), "BLE session")?;
        session.advertise_signal = Some(signal.clone());
    }

    thread::Builder::new()
        .name("lightning-p2p-ble-advertise".into())
        .spawn(move || rotate_advertisements(&payloads, &signal))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn rotate_advertisements(payloads: &[Vec<u8>], signal: &Arc<AtomicBool>) {
    while signal.load(Ordering::SeqCst) {
        for payload in payloads {
            if !signal.load(Ordering::SeqCst) {
                break;
            }
            match publish_payload(payload) {
                Ok(publisher) => {
                    ADVERTISING.store(true, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(ROTATION_MS));
                    let _ = publisher.Stop();
                    ADVERTISING.store(false, Ordering::SeqCst);
                }
                Err(error) => {
                    set_last_error(Some(error));
                    ADVERTISING.store(false, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(ROTATION_MS));
                }
            }
        }
    }
    ADVERTISING.store(false, Ordering::SeqCst);
}

fn publish_payload(payload: &[u8]) -> Result<BluetoothLEAdvertisementPublisher, String> {
    let advertisement = BluetoothLEAdvertisement::new().map_err(windows_error)?;
    let data_type =
        BluetoothLEAdvertisementDataTypes::ServiceData128BitUuids().map_err(windows_error)?;
    let buffer = bytes_to_buffer(&service_data_section(payload))?;
    let section =
        BluetoothLEAdvertisementDataSection::Create(data_type, &buffer).map_err(windows_error)?;
    advertisement
        .DataSections()
        .map_err(windows_error)?
        .Append(&section)
        .map_err(windows_error)?;
    let publisher =
        BluetoothLEAdvertisementPublisher::Create(&advertisement).map_err(windows_error)?;
    publisher.Start().map_err(windows_error)?;
    Ok(publisher)
}

fn handle_received(args: &BluetoothLEAdvertisementReceivedEventArgs) -> Result<(), String> {
    let address = args.BluetoothAddress().map_err(windows_error)?;
    let advertisement = args.Advertisement().map_err(windows_error)?;
    for payload in service_payloads(&advertisement)? {
        ingest_payload(address, &payload)?;
    }
    Ok(())
}

fn service_payloads(advertisement: &BluetoothLEAdvertisement) -> Result<Vec<Vec<u8>>, String> {
    let data_type =
        BluetoothLEAdvertisementDataTypes::ServiceData128BitUuids().map_err(windows_error)?;
    let sections = advertisement
        .GetSectionsByType(data_type)
        .map_err(windows_error)?;
    let count = sections.Size().map_err(windows_error)?;
    let mut payloads = Vec::new();
    for index in 0..count {
        let section = sections.GetAt(index).map_err(windows_error)?;
        let data = buffer_to_bytes(&section.Data().map_err(windows_error)?)?;
        if let Some(payload) = parse_service_data_section(&data) {
            payloads.push(payload);
        }
    }
    Ok(payloads)
}

fn ingest_payload(address: u64, payload: &[u8]) -> Result<(), String> {
    if payload.len() < 3 || payload[0] != PROTOCOL_VERSION {
        return Ok(());
    }
    let index = usize::from(payload[1]);
    let total = usize::from(payload[2]);
    if total == 0 || total > MAX_CHUNKS || index >= total {
        return Ok(());
    }

    let now = epoch_ms();
    let mut partials = lock(partials(), "BLE partial discoveries")?;
    let entry = partials
        .entry(address)
        .and_modify(|partial| {
            if partial.total != total {
                *partial = PartialNodeId::new(total, now);
            }
        })
        .or_insert_with(|| PartialNodeId::new(total, now));
    entry.chunks.insert(index, payload[3..].to_vec());
    entry.last_seen_ms = now;

    let complete = entry.joined().filter(|bytes| bytes.len() >= 32);
    if let Some(bytes) = complete {
        let node_id_hex = bytes_to_hex(&bytes[..32]);
        partials.remove(&address);
        push_discovery(node_id_hex, now)?;
    }
    partials.retain(|_, partial| now.saturating_sub(partial.last_seen_ms) <= PARTIAL_STALE_MS);
    Ok(())
}

fn build_node_id_payloads(node_id_hex: &str) -> Result<Vec<Vec<u8>>, String> {
    let bytes = hex_to_bytes(node_id_hex)?;
    if bytes.len() < 32 {
        return Err("Invalid iroh NodeId for BLE advertisement".into());
    }
    let node_id = &bytes[..32];
    let total = node_id.len().div_ceil(CHUNK_DATA_BYTES);
    let total_u8 = u8::try_from(total).map_err(|error| error.to_string())?;
    (0..total)
        .map(|index| {
            let index_u8 = u8::try_from(index).map_err(|error| error.to_string())?;
            let start = index * CHUNK_DATA_BYTES;
            let end = (start + CHUNK_DATA_BYTES).min(node_id.len());
            let mut payload = Vec::with_capacity(3 + end - start);
            payload.extend([PROTOCOL_VERSION, index_u8, total_u8]);
            payload.extend(&node_id[start..end]);
            Ok(payload)
        })
        .collect()
}

fn parse_service_data_section(data: &[u8]) -> Option<Vec<u8>> {
    let uuid = service_uuid_ble_bytes();
    data.strip_prefix(&uuid).map(<[u8]>::to_vec)
}

fn service_data_section(payload: &[u8]) -> Vec<u8> {
    let mut data = service_uuid_ble_bytes().to_vec();
    data.extend(payload);
    data
}

fn service_uuid_ble_bytes() -> [u8; 16] {
    SERVICE_UUID.to_u128().to_le_bytes()
}

fn bytes_to_buffer(bytes: &[u8]) -> Result<IBuffer, String> {
    let writer = DataWriter::new().map_err(windows_error)?;
    writer.WriteBytes(bytes).map_err(windows_error)?;
    writer.DetachBuffer().map_err(windows_error)
}

fn buffer_to_bytes(buffer: &IBuffer) -> Result<Vec<u8>, String> {
    let len = buffer.Length().map_err(windows_error)?;
    let reader = DataReader::FromBuffer(buffer).map_err(windows_error)?;
    let out_len = usize::try_from(len).map_err(|error| error.to_string())?;
    let mut out = vec![0; out_len];
    reader.ReadBytes(&mut out).map_err(windows_error)?;
    Ok(out)
}

fn push_discovery(node_id_hex: String, timestamp_ms: i64) -> Result<(), String> {
    let mut guard = lock(discoveries(), "BLE discoveries")?;
    guard.push_back((node_id_hex, timestamp_ms));
    while guard.len() > MAX_DISCOVERIES {
        guard.pop_front();
    }
    Ok(())
}

fn set_last_error(message: Option<String>) {
    if let Ok(mut guard) = LAST_ERROR.get_or_init(|| Mutex::new(None)).lock() {
        *guard = message;
    }
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    let trimmed = hex
        .chars()
        .filter(|character| !character.is_whitespace() && *character != ':' && *character != '-')
        .collect::<String>();
    if trimmed.len() % 2 != 0 {
        return Err("hex string has an odd length".into());
    }
    (0..trimmed.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&trimmed[index..index + 2], 16).map_err(|error| error.to_string())
        })
        .collect()
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

fn epoch_ms() -> i64 {
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => i64::try_from(duration.as_millis()).unwrap_or(i64::MAX),
        Err(_) => 0,
    }
}

#[allow(clippy::needless_pass_by_value)]
fn windows_error(error: windows::core::Error) -> String {
    error.to_string()
}

fn session() -> &'static Mutex<BleSession> {
    SESSION.get_or_init(|| Mutex::new(BleSession::default()))
}

fn discoveries() -> &'static Mutex<VecDeque<(String, i64)>> {
    DISCOVERIES.get_or_init(|| Mutex::new(VecDeque::new()))
}

fn partials() -> &'static Mutex<HashMap<u64, PartialNodeId>> {
    PARTIALS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock<'a, T>(mutex: &'a Mutex<T>, label: &str) -> Result<std::sync::MutexGuard<'a, T>, String> {
    mutex
        .lock()
        .map_err(|_| format!("{label} lock is poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_uuid_is_full_128_bit_uuid() {
        assert_eq!(service_uuid_ble_bytes().len(), 16);
        assert_eq!(
            SERVICE_UUID.to_u128(),
            0x4c50324c_7032_7032_7032_4c6967687431
        );
    }

    #[test]
    fn node_id_payloads_reassemble_to_first_32_bytes() {
        let hex = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
        let payloads = build_node_id_payloads(hex).expect("payloads");

        assert_eq!(payloads.len(), 4);
        let joined = payloads
            .iter()
            .flat_map(|payload| payload[3..].iter().copied())
            .collect::<Vec<_>>();
        assert_eq!(bytes_to_hex(&joined), hex);
    }

    #[test]
    fn service_data_section_round_trips_payload() {
        let payload = [PROTOCOL_VERSION, 0, 1, 0xaa, 0xbb];
        let section = service_data_section(&payload);

        assert_eq!(parse_service_data_section(&section), Some(payload.to_vec()));
    }
}
