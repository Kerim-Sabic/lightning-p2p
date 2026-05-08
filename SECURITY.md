# Security Policy

## Supported Versions

Security fixes target the latest public Windows release and the current `main` branch.

## Reporting a Vulnerability

Please do not open a public issue for a suspected vulnerability.

Report security issues through GitHub Security Advisories if available, or contact the repository owner privately with:

- affected version or commit
- operating system
- steps to reproduce
- expected impact
- any logs, screenshots, or proof-of-concept files that are safe to share

## Security Model

Lightning P2P avoids cloud file hosting, but transfer tickets are capability tokens. Anyone with a valid ticket can request the referenced content while the sender is online and the content remains available.

Core properties:

- transfers use iroh over QUIC TLS 1.3
- content is verified with BLAKE3 through iroh-blobs
- identity keys are stored through the OS keychain
- receive handoff links keep tickets in URL fragments
- no telemetry is collected without explicit opt-in

Current limitations:

- sharing a ticket with the wrong person grants access to that transfer
- the sender must remain online for the receiver to fetch content
- relay fallback improves connectivity but is not a storage service
- detailed third-party audits have not been completed yet
