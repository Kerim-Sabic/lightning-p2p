# Security Policy

## Supported Versions

Security fixes target the latest public Windows and Android releases and the
current `main` branch.

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
- Browser handoff hides raw ticket text by default; revealing or copying it is a deliberate user action.
- Local identity keys prefer the OS keychain. If the keychain is unavailable, development, CI, or platform-specific builds can fall back to an app-data key file so the iroh identity remains stable.
- No telemetry is collected without explicit opt-in.

## What Lightning P2P Does Not Protect

- It does not protect a ticket after you share it with the wrong person.
- It does not keep a transfer available after the sender goes offline or removes the content.
- It does not scan received files for malware.
- It does not protect against a compromised sender or receiver device.
- It does not hide all network metadata from infrastructure that helps peers connect.
- Nearby discovery reveals device presence, persistent NodeId, and device name to local peers. Detailed active-share metadata is returned only to identities saved in My Devices.
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

Nearby discovery reveals device presence, persistent NodeId, and device name to local peers. A peer must be saved in My Devices before the nearby-share protocol returns active-share labels, sizes, hashes, format, publication time, and route hints. New peers can still send a push offer, which requires receiver approval, or use a ticket that was deliberately shared with them.

Detailed share metadata is sensitive. Use manual ticket sharing and turn off local discovery if local-network device presence and device names should remain private. Turning discovery off restarts the endpoint when no transfer is active.

The settings toggle controls nearby discovery and rebuilds the endpoint when no transfer is active. mDNS may still expose endpoint identity and device name while discovery is on, even when no share is published.

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
- SHA256 checksums for both Windows and Android artifacts
- Authenticode code-signing for Windows when Microsoft Trusted Signing secrets are configured
- Android v2/v3 APK signing with a project-controlled release keystore (cert fingerprint published in [README.md](README.md#android))

Unsigned community builds may show Microsoft Defender SmartScreen warnings such
as "Windows protected your PC" or "unrecognized app". Signed production builds
can also show SmartScreen prompts until Microsoft reputation builds for the
publisher and file hash.

On Android, sideloaded APKs always show the OS-level "Install unknown apps"
prompt; that is normal and not a malware signal. Play Protect may also show a
one-time "couldn't verify this app" dialog for new releases — this also subsides
as install reputation grows. See [docs/android-trust.md](docs/android-trust.md)
for verification commands and the published cert fingerprint.

Do not assume every build is code-signed. Verify public release artifacts from
GitHub Releases when install trust matters:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\verify-release.ps1 -Installer .\LightningP2PSetup.exe -Checksums .\SHA256SUMS.txt

# Android (PowerShell): hash check
(Get-FileHash .\LightningP2P-android-latest.apk -Algorithm SHA256).Hash
Get-Content .\SHA256SUMS-android.txt | Select-String "LightningP2P-android-latest.apk"
```

See [docs/download-trust.md](docs/download-trust.md) for the Windows trust
model and [docs/android-trust.md](docs/android-trust.md) for the Android
sideload trust model.

## Telemetry Policy

Lightning P2P does not send product telemetry by default. Diagnostics are copied locally by the user from the Settings view and can be pasted into issues manually.

Diagnostic bundles redact known app/download paths and ticket-like strings before copying. They can still include NodeIds, route state, file sizes, content hashes, and timing metadata, so review them before posting publicly.

## Threat Model

| Scenario | Expected behavior |
| --- | --- |
| Attacker without ticket | Cannot request the referenced transfer without the capability token. |
| Attacker with ticket | Can request that transfer while the sender is online and content is available. |
| Relay visibility | Relay infrastructure may see connection metadata needed for connectivity, but it is not a storage bucket. |
| Nearby LAN peer | Can see device presence, identity, and name. Detailed active-share metadata requires a saved verified identity; new peers need receiver consent for push offers. |
| Sender goes offline | Transfer becomes unavailable or fails. |
| Malicious file content | Bytes can be verified for integrity, but Lightning P2P does not judge whether the file is safe to open. |
| Receiver download path | App checks that the destination is writable and exports verified content to disk. |
| Compromised endpoint | A compromised sender or receiver can expose files, tickets, keys, logs, or downloads. |
| Invalid or stale ticket | Receiver should show an actionable failure instead of silently corrupting output. |

## Current Limitations

- Public benchmark leadership claims are not published yet.
- macOS/Linux/iOS are not public releases.
- The keychain fallback stores raw identity key material in the app data directory when platform key storage is unavailable.
- Nearby discovery still exposes device presence, stable identity, and device name to local peers while enabled.
- Pause/resume transfer UX is tracked but not complete.
- A formal third-party audit has not been completed.

## Audit Status

No external security audit has been published. Security-sensitive changes should be reviewed carefully, tested locally, and described in release notes.
