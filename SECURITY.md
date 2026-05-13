# Security Policy

## Supported Versions

Security fixes target the latest public Windows release and the current `main`
branch. Android is alpha/internal foundation work until a signed public Android
release is published.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability.

Report security issues through GitHub Security Advisories when available, or
contact the repository owner privately. If no private contact is listed for your
deployment, open a minimal public issue asking for a private security contact and
do not include exploit details.

Include:

- affected version or commit
- operating system
- transfer route if known: direct, relay, or unknown
- steps to reproduce
- expected impact
- safe proof-of-concept files, logs, or screenshots

## Official Release Sources

Official public builds are distributed only from:

- GitHub Releases: <https://github.com/Kerim-Sabic/lightning-p2p/releases>
- Official website: <https://lightning-p2p.netlify.app/>
- A future Microsoft Store listing after this repository documents it

Do not install builds from mirrors, chat attachments, or reuploads unless you
can independently verify the source and checksum.

## Security Model

Lightning P2P avoids cloud file hosting, uses encrypted peer transport through iroh, verifies content with BLAKE3 through iroh-blobs, and treats transfer tickets as capability tokens.

This is a direct-first peer-to-peer app. It is not a hosted cloud storage service, and it is not a browser transfer engine.

## What Lightning P2P Protects

- Files are not uploaded to a third-party cloud bucket before the receiver downloads them.
- Transport uses QUIC TLS through iroh peer connectivity.
- Content is addressed and verified with BLAKE3 through iroh-blobs.
- Receive handoff links keep tickets in URL fragments: `/receive#t=<ticket>`.
- Browser receive pages do not receive the ticket in normal HTTP requests.
- Local identity keys prefer the OS keychain. If the keychain is unavailable, current alpha/development builds fall back to an app-data key file so the iroh identity remains stable.
- No telemetry is collected without explicit opt-in.

## What Lightning P2P Does Not Protect

- It does not protect a ticket after you share it with the wrong person.
- It does not keep a transfer available after the sender goes offline or removes the content.
- It does not scan received files for malware.
- It does not protect against a compromised sender or receiver device.
- It does not hide all network metadata from infrastructure that helps peers connect.
- Nearby discovery can reveal local-network metadata for active shares, including device label, file label, content hash, size, route hints, and persistent NodeId.
- Local logs, transfer history, peer cache, blob store, and fallback identity files are local artifacts that should be treated as sensitive on shared machines.
- It has not completed a third-party security audit.

## Tickets Are Capability Tokens

A receive ticket is a capability token. Anyone with a valid ticket can request the referenced transfer while the sender is online and the content remains available.

Treat tickets like secrets:

- share them only with the intended receiver
- avoid posting them in public channels
- regenerate or remove the shared content if a ticket leaks
- remember that links, QR codes, clipboard contents, browser fragments, custom-scheme deep links, and support screenshots can all contain ticket material

## Nearby Discovery

Nearby discovery is designed for trusted local networks. When local discovery and a share are active, nearby peers can query the app over the Lightning P2P nearby-share protocol and see enough metadata to show a receive card: device label, share label, size, content hash, blob format, published time, NodeId, route hints, and direct-address count.

This metadata is not the raw receive ticket, but it is sensitive. Use manual ticket sharing instead of nearby discovery if filenames, hostnames, organizational device names, or local-network presence should remain private.

The current settings toggle controls nearby share listings and active-share responses. The iroh endpoint may still use local-network discovery for connectivity metadata until endpoint restart/rebuild support is added.

## Local Key Storage

Lightning P2P stores the persistent iroh identity key through the OS keychain when available. To keep profiles usable in CI, development, and mobile alpha environments, the app can fall back to `iroh-secret-key.hex` in the configured app data directory. That fallback file contains plaintext secret key material, is ignored by git, and is written with restrictive permissions on Unix platforms.

If this file is exposed, delete it and restart the app to rotate the local peer identity. Existing tickets tied to the old identity may stop working.

## Relay Fallback

Relay fallback helps devices reach each other when NAT or firewall rules block a direct path. Relay fallback is connectivity help, not cloud storage.

Lightning P2P should not be described as "never touches a server" because discovery and relay infrastructure can be involved in connection setup or fallback routing. The important product distinction is that Lightning P2P does not create a hosted cloud file bucket or retention link for the transfer.

## Sender Online Requirement

The sender must stay online, keep Lightning P2P open, and keep the content available until the receiver finishes. If the sender sleeps, disconnects, closes the app, or removes the content from the local blob store, the receiver may not be able to complete the transfer.

## Update And Signing Status

Release automation supports:

- Tauri updater metadata signatures
- SHA256 checksums
- Authenticode code-signing when Microsoft Trusted Signing secrets are configured

Unsigned community builds may show Microsoft Defender SmartScreen warnings such
as "Windows protected your PC" or "unrecognized app". Signed production builds
can also show SmartScreen prompts until Microsoft reputation builds for the
publisher and file hash.

Do not assume every build is code-signed. Verify public release artifacts from
GitHub Releases when install trust matters:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2PSetup.exe -Checksums .\SHA256SUMS.txt
```

See [docs/download-trust.md](docs/download-trust.md) for the download trust
model.

## Telemetry Policy

Lightning P2P does not send product telemetry by default. Diagnostics are copied locally by the user from the Settings view and can be pasted into issues manually.

## Threat Model

| Scenario | Expected behavior |
| --- | --- |
| Attacker without ticket | Cannot request the referenced transfer without the capability token. |
| Attacker with ticket | Can request that transfer while the sender is online and content is available. |
| Relay visibility | Relay infrastructure may see connection metadata needed for connectivity, but it is not a storage bucket. |
| Nearby LAN peer | Can see active nearby-share metadata while nearby discovery is enabled; use manual tickets for more private sharing. |
| Sender goes offline | Transfer becomes unavailable or fails. |
| Malicious file content | Bytes can be verified for integrity, but Lightning P2P does not judge whether the file is safe to open. |
| Receiver download path | App checks that the destination is writable and exports verified content to disk. |
| Compromised endpoint | A compromised sender or receiver can expose files, tickets, keys, logs, or downloads. |
| Invalid or stale ticket | Receiver should show an actionable failure instead of silently corrupting output. |

## Current Limitations

- Public benchmark leadership claims are not published yet.
- macOS/Linux/iOS are not public releases.
- Android remains alpha/internal foundation work.
- The keychain fallback stores raw identity key material in the app data directory when platform key storage is unavailable.
- Nearby discovery does not yet have an approval/pairing step before share metadata is visible to local-network peers.
- Pause/resume transfer UX is tracked but not complete.
- A formal third-party audit has not been completed.

## Audit Status

No external security audit has been published. Security-sensitive changes should be reviewed carefully, tested locally, and described in release notes.
