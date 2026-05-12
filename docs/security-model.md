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

## Nearby Discovery

Nearby discovery is meant for trusted local networks. When enabled and a share is active, local peers can query share metadata such as device label, file label, size, content hash, timestamp, NodeId, and route hints. Use manual ticket sharing when that metadata should not be visible on the LAN.

## Local Artifacts

Local logs, history, peer cache, blob store, clipboard contents, session storage during handoff, and fallback identity key files can contain sensitive metadata. Treat support bundles and screenshots accordingly.

## Current Limitations

- Sender must remain online.
- Tickets must be protected by the user.
- Received files are not scanned for malware.
- Endpoints can be compromised.
- Nearby discovery does not yet have a pairing/approval step before active-share metadata is visible to local peers.
- Keychain fallback stores plaintext identity key material in the app data directory when platform key storage is unavailable.
- Public benchmark leadership claims are not published yet.
- No third-party audit has been completed.

See [SECURITY.md](../SECURITY.md) for reporting instructions and the full threat table.
