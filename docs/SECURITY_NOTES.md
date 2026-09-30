# Security Notes

These notes are implementation-facing and complement the public [SECURITY.md](../SECURITY.md).

## Changes From The Launch Audit

- Raw `BlobTicket` values are no longer written to info logs during send.
- Persistent iroh identity is now scoped by app data directory/profile instead of one global keychain entry.
- Fallback identity files are ignored by git.
- Nearby response parsing rejects mismatched protocol versions.
- Receive links continue to use `/receive#t=<ticket>` so browser HTTP requests do not carry tickets.

## Sensitive Local Artifacts

Treat these as sensitive when sharing diagnostics or support bundles:

- receive tickets, links, QR codes, clipboard contents, and custom-scheme deep links
- runtime logs, because they can include persistent NodeIds, content hashes, file sizes, and route status
- sled database files containing history and peer metadata
- blob store contents
- `iroh-secret-key.hex` fallback identity files
- browser `sessionStorage` during receive handoff

## Nearby Discovery Metadata

Nearby discovery exposes device presence and a human-readable device name on the local network. Detailed active-share metadata is returned only when the authenticated transport peer's NodeId is saved in My Devices:

- device label
- share label
- size
- content hash
- blob format
- published timestamp
- NodeId and route hints

The protocol uses `Connection::remote_id()` for this check; it does not trust an identity supplied inside the request. Unpaired peers receive an empty share list, but can still send a push offer that requires receiver consent or use a ticket shared with them. Revoking a paired identity clears its cached nearby-share metadata. A ticket already given to someone remains a bearer capability until the share is otherwise removed from serving.

## Key Storage

Preferred path:

- OS keychain through the `keyring` crate.

Fallback path:

- `iroh-secret-key.hex` in the configured app data directory when keychain access fails.
- This fallback is plaintext key material.
- Unix writes use restrictive mode at creation time.
- Windows ACL hardening should be added if fallback is kept for production.

Android imports use user-granted `content://` URIs and stage into the app cache; received media is published through scoped `MediaStore` APIs. The manifest no longer requests broad shared-media read permissions or declares a `FileProvider`. Physical-device coverage is still needed for the supported document-picker, share-intent, and save flows.

## Current Security TODOs

- Keep ticket strings out of runtime logs; current tests cover diagnostic redaction, not every logging call.
- Validate the configured web and Tauri CSP against packaged builds and the deployed receive/send pages.
- Validate Android document-picker, share-intent, and MediaStore save flows on supported OS versions after removing broad media read permissions.
- Add Windows ACL hardening for the plaintext identity-key fallback.
- Document that custom-scheme deep links carry the receive ticket to the operating system and may be retained by OS/app history or logs.

History and peer-cache clearing, endpoint restart when local discovery changes, hidden-by-default raw tickets in the handoff UI, and web/Tauri CSP configuration are implemented. Receive ticket fragments stay out of normal website HTTP requests. The custom-scheme ticket exposure remains a local artifact concern.
