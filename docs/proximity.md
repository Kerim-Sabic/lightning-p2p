# Proximity Discovery: BLE and NFC

Lightning P2P uses proximity features only for discovery or ticket handoff.
File bytes always move through iroh QUIC and iroh-blobs.

## Current Status

| Surface | Status | What it carries | Notes |
| --- | --- | --- | --- |
| Wi-Fi/LAN discovery | Stable | iroh nearby identity and active-share metadata | Primary nearby path today. |
| Android BLE | Experimental in v0.5.0 | iroh NodeId beacons | Starts scan and advertise from Settings when permissions and adapter are available. |
| Windows BLE | Experimental in v0.5.0 | iroh NodeId beacons | Uses the native WinRT advertisement watcher and publisher when the adapter supports BLE. |
| macOS/Linux BLE | Not shipped | Nothing | No native BLE backend is compiled for these desktop targets yet. |
| Android NFC receive | Experimental in v0.5.0 | Receive ticket NDEF record | The app can ingest `application/vnd.lightning-p2p.ticket` intents. |
| Phone-to-phone NFC write | Not shipped | Nothing | Do not claim modern Android phone-to-phone tap transfer until a writer/HCE path exists and is tested. |

## BLE Behavior

BLE discovery is off by default. On Android, the app asks for the runtime
Bluetooth or location permission required by the Android version. On Windows,
the app uses WinRT BLE APIs and depends on the local Bluetooth adapter and OS
privacy controls. Both runtimes start advertising, start scanning, and drain
discovered Lightning P2P NodeIds into the nearby-device list.

The BLE advertisement is chunked because the iroh NodeId is 32 bytes and the
legacy BLE service-data payload is small. The native bridge rotates compact
service-data frames under the Lightning P2P service UUID:

```text
service uuid: 4c50324c-7032-7032-7032-4c6967687431
payload:      version, chunk_index, chunk_count, node_id_chunk
```

Receiving devices reassemble all chunks from the same BLE address before
surfacing the peer. A BLE-only peer may still need iroh relay discovery to dial
successfully because BLE does not carry direct socket addresses.

## NFC Behavior

The Android activity handles `NDEF_DISCOVERED` intents with MIME type:

```text
application/vnd.lightning-p2p.ticket
```

The payload is expected to be a Lightning P2P receive ticket. The frontend
drains the pending ticket on focus and opens the Receive view.

This is receive-side plumbing only. Modern Android removed Android Beam, so
phone-to-phone NFC write support should not be claimed until the project has a
tested writer or host-card-emulation path.

## Manual Test Plan

1. Install v0.5.0 on two Android devices with BLE hardware.
2. Open Settings, enable Bluetooth proximity discovery, and grant permissions.
3. Confirm Settings shows permission `Granted`, adapter `Available`, scanner
   `Active`, and advertiser `Active`.
4. Keep both devices awake for at least 20 seconds.
5. Confirm a `Bluetooth peer` appears in Devices.
6. Send a small file using the peer offer flow.
7. Confirm transfer route and bytes are still reported through iroh.
8. Repeat with Windows-to-Android and Android-to-Windows. On Windows, confirm
   the adapter supports BLE advertising as well as scanning.
9. For NFC, write a real receive ticket into an NDEF record with the MIME type
   above, scan it on Android, and confirm the Receive view pre-fills the ticket.

## Launch Rule

Public copy may say "experimental Android/Windows BLE discovery" and
"experimental Android NFC ticket receive." It must not say macOS/Linux BLE,
phone-to-phone NFC, or Bluetooth file transfer works until those paths have
committed code plus physical-device evidence.
