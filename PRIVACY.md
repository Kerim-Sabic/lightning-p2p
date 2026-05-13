# Privacy Policy

Lightning P2P is designed to transfer files directly between devices without
requiring an account or uploading files to a third-party cloud storage bucket.

## Account

Lightning P2P does not require an account, email address, or paid subscription.

## File Transfer

Transfers are handled by the native app using iroh and QUIC. The sender prepares
content locally, shares a ticket/link/QR code, and the receiver streams verified
bytes to disk.

Lightning P2P does not run a hosted cloud file bucket for storing your files.
Relay fallback may help devices connect when direct connectivity is blocked, but
relay fallback is connectivity help, not cloud storage.

## Tickets

Receive tickets are capability tokens. Anyone with a valid ticket can request
the referenced transfer while the sender is online and the content remains
available. Treat tickets, QR codes, clipboard contents, and support screenshots
that include tickets as sensitive.

## Local Data

Lightning P2P may store local data on your device, including:

- app settings
- transfer history
- peer/discovery cache
- blob store content needed for active or recent shares
- diagnostic logs copied manually by the user
- fallback identity key files when OS keychain storage is unavailable

Local data can reveal file names, device names, NodeIds, transfer metadata, and
download locations. Protect your Windows account and avoid sharing support logs
publicly if they contain sensitive details.

## Nearby Discovery

Nearby discovery is intended for trusted local networks. When enabled and the app
is running, peers on the same network can discover device presence and limited
share metadata needed to show nearby-device and offer prompts.

Use manual ticket sharing if local-network presence, device labels, filenames, or
active-share metadata should remain private.

## Telemetry

Lightning P2P does not send product telemetry by default. Diagnostics are local
unless you copy and share them manually in an issue, support request, or security
report.

## Official Sources

Download public builds only from:

- <https://github.com/Kerim-Sabic/lightning-p2p/releases>
- <https://lightning-p2p.netlify.app/>
- a future Microsoft Store listing once documented by this repository

See [SECURITY.md](SECURITY.md) and [docs/download-trust.md](docs/download-trust.md)
for download verification and reporting guidance.
