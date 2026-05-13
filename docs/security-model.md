# Lightning P2P Security Model

Lightning P2P is private by design in a specific sense: it avoids hosted cloud file storage, uses encrypted peer transport through iroh, verifies content with BLAKE3, and keeps receive tickets in URL fragments during web handoff.

It is not an anonymity tool, malware scanner, or audited secure messaging system.

## Core Properties

| Area | Model |
| --- | --- |
| Transfer | Direct-first peer-to-peer transfer through the native app |
| Transport | iroh over QUIC |
| Integrity | BLAKE3 verification through iroh-blobs |
| Handoff | `/receive#t=<ticket>` URL fragment |
| Storage | Local app storage and user-selected download folders |
| Identity | OS keychain preferred; profile-scoped app-data fallback when keychain storage is unavailable |
| Cloud upload | No hosted cloud file bucket |
| Relay fallback | Connectivity helper, not retention storage |

## Ticket Handling

Tickets are capability tokens. Anyone with a valid ticket can request the referenced content while the sender is online and the content remains available.

Safe handling:

- share tickets only with intended receivers
- prefer private chat or direct communication
- rotate the transfer by clearing and re-sharing if a ticket leaks

## Browser Handoff

The website supports receive handoff only. It does not transfer files in the browser.

Receive links use:

```text
https://lightning-p2p.netlify.app/receive#t=<ticket>
```

The fragment keeps the raw ticket out of normal HTTP requests to the website host. The handoff page can then open:

```text
lightning-p2p://receive?t=<ticket>
```

## Relay Fallback

Relay fallback helps devices connect when NAT or firewalls block direct paths. It should not be described as cloud storage. It also should not be described as "never touches a server" because discovery and relay infrastructure can be involved in connectivity.

## Windows Install And Trust Surface

Lightning P2P is a networked desktop app, so public releases should make the
Windows trust surface explicit instead of hiding it.

Confirmed behavior in this repository:

- The app uses iroh and QUIC for peer connectivity. The operating system may
  show firewall prompts because direct peer connectivity and nearby discovery
  need network access.
- NSIS installs are configured as current-user installs, not per-machine admin
  installs.
- Velopack post-install hooks add inbound and outbound Windows Firewall rules
  scoped to `lightning-p2p.exe`; the uninstall hook removes the rule.
- The app registers the `lightning-p2p://` deep-link scheme through
  `tauri-plugin-deep-link`.
- The updater plugin can check signed update metadata when updater artifacts are
  enabled for a signed production release.
- The installer embeds the Microsoft Edge WebView2 bootstrapper/runtime path
  configured by Tauri. The app does not run an arbitrary post-install download
  script from this repository.
- No hidden autostart entry is configured in this repository.
- No telemetry endpoint or analytics SDK is configured in this repository.

Unsigned community releases can trigger Microsoft Defender SmartScreen because
Windows cannot verify a publisher identity. That is a distribution trust issue,
not a transfer-protocol property. Verify release source, SHA256 checksums, and
Authenticode status before installing.

## Nearby Discovery

Nearby discovery is meant for trusted local networks. When enabled, the device publishes itself over iroh's mDNS-based `LocalSwarmDiscovery`. Other peers on the same network can:

- See the device's NodeId, human-readable device name, route hint, and (when a share is active) the share label, size, content hash, and timestamp.
- Send a push-style **offer** to this device via the nearby ALPN (`lightning-p2p/nearby/2`). The receiver always sees an Accept/Decline prompt before any file bytes flow; declining sends an `OfferDecision::Rejected` back over the same QUIC stream and nothing is transferred.

The nearby ALPN is a tagged-enum protocol with three message types: `Hello` (device-name probe), `ListShares` (the legacy pull flow), and `OfferShare` (push). All three travel inside iroh's QUIC connection, which is already authenticated by NodeId and encrypted with TLS 1.3.

What this means for risk:

- A nearby peer cannot push files onto your device silently; every offer surfaces a UI prompt that requires explicit acceptance.
- A nearby peer *can* spam offer prompts. The current overlay shows one offer at a time and a counter for the rest; per-NodeId rate-limiting in the offer inbox is a planned mitigation before public release.
- A nearby peer can always read the public mDNS service announcement (NodeId + reachability) regardless of whether sharing is enabled; this is inherent to mDNS, not Lightning P2P specific.

Use manual ticket sharing when even the discovery metadata should not be visible on the LAN.

## Bluetooth LE Discovery (planned)

Android manifest permissions for BLE (`BLUETOOTH_SCAN` with `neverForLocation`, `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT`) are declared so a follow-up can ship cross-network proximity discovery. When wired up, the BLE advertisement payload will carry only the iroh NodeId + a truncated device name + a single flags byte; never file contents. All actual file transfer continues to ride iroh QUIC. The BLE service UUID and manufacturer-specific data layout will be documented here once the scanner/advertiser lands.

## Local Artifacts

Local logs, history, peer cache, blob store, clipboard contents, session storage during handoff, and fallback identity key files can contain sensitive metadata. Treat support bundles and screenshots accordingly.

## Current Limitations

- Sender must remain online.
- Tickets must be protected by the user.
- Received files are not scanned for malware.
- Endpoints can be compromised.
- Nearby discovery does not yet have a pairing/approval step before active-share metadata is visible to local peers. Push offers always require user acceptance, but the device's presence and active-share metadata are visible to any peer on the LAN that opts in to discovery.
- Keychain fallback stores plaintext identity key material in the app data directory when platform key storage is unavailable.
- Public benchmark leadership claims are not published yet.
- No third-party audit has been completed.

See [SECURITY.md](../SECURITY.md) for reporting instructions and the full threat table.
