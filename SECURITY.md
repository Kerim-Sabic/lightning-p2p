# Security Policy

## Supported Versions

Security fixes target the latest public Windows release and the current `main` branch.

## Reporting a Vulnerability

Do not open a public issue for a suspected vulnerability.

Report security issues through GitHub Security Advisories when available, or contact the repository owner privately with:

- affected version or commit
- operating system
- transfer route if known: direct, relay, or unknown
- steps to reproduce
- expected impact
- safe proof-of-concept files, logs, or screenshots

## Security Model

Lightning P2P avoids cloud file hosting, uses encrypted peer transport through iroh, verifies content with BLAKE3 through iroh-blobs, and treats transfer tickets as capability tokens.

This is a direct-first peer-to-peer app. It is not a hosted cloud storage service, and it is not a browser transfer engine.

## What Lightning P2P Protects

- Files are not uploaded to a third-party cloud bucket before the receiver downloads them.
- Transport uses QUIC TLS through iroh peer connectivity.
- Content is addressed and verified with BLAKE3 through iroh-blobs.
- Receive handoff links keep tickets in URL fragments: `/receive#t=<ticket>`.
- Browser receive pages do not receive the ticket in normal HTTP requests.
- Local identity keys are stored through the OS keychain.
- No telemetry is collected without explicit opt-in.

## What Lightning P2P Does Not Protect

- It does not protect a ticket after you share it with the wrong person.
- It does not keep a transfer available after the sender goes offline or removes the content.
- It does not scan received files for malware.
- It does not protect against a compromised sender or receiver device.
- It does not hide all network metadata from infrastructure that helps peers connect.
- It has not completed a third-party security audit.

## Tickets Are Capability Tokens

A receive ticket is a capability token. Anyone with a valid ticket can request the referenced transfer while the sender is online and the content remains available.

Treat tickets like secrets:

- share them only with the intended receiver
- avoid posting them in public channels
- regenerate or remove the shared content if a ticket leaks

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

Do not assume every local development build is code-signed. Verify public release artifacts from GitHub Releases when install trust matters.

## Telemetry Policy

Lightning P2P does not send product telemetry by default. Diagnostics are copied locally by the user from the Settings view and can be pasted into issues manually.

## Threat Model

| Scenario | Expected behavior |
| --- | --- |
| Attacker without ticket | Cannot request the referenced transfer without the capability token. |
| Attacker with ticket | Can request that transfer while the sender is online and content is available. |
| Relay visibility | Relay infrastructure may see connection metadata needed for connectivity, but it is not a storage bucket. |
| Sender goes offline | Transfer becomes unavailable or fails. |
| Malicious file content | Bytes can be verified for integrity, but Lightning P2P does not judge whether the file is safe to open. |
| Receiver download path | App checks that the destination is writable and exports verified content to disk. |
| Compromised endpoint | A compromised sender or receiver can expose files, tickets, keys, logs, or downloads. |
| Invalid or stale ticket | Receiver should show an actionable failure instead of silently corrupting output. |

## Current Limitations

- Public benchmark leadership claims are not published yet.
- macOS/Linux/iOS are not public releases.
- Android remains alpha/internal foundation work.
- Pause/resume transfer UX is tracked but not complete.
- A formal third-party audit has not been completed.

## Audit Status

No external security audit has been published. Security-sensitive changes should be reviewed carefully, tested locally, and described in release notes.
