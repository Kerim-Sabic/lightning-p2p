# Microsoft Store Readiness

Microsoft Store distribution is the best no-warning Windows trust path for most
new apps because Store packages are signed by Microsoft after certification.

Lightning P2P has not been submitted to the Microsoft Store yet.

## Recommended Free Path

The free/no-Azure path is to prepare a Store package and submit it through
Microsoft Partner Center. For MSIX Store submissions, Microsoft signs the package
after certification. This avoids managing a paid code-signing certificate for the
Store package itself.

If Lightning P2P submits an MSI or EXE installer to the Store instead of MSIX,
the installer must be Authenticode-signed by the publisher before submission.
That path is not the no-cost path.

## Store Listing Checklist

- App name: Lightning P2P
- Publisher identity: TODO, must match the future Partner Center identity
- Short description: Free open-source P2P file transfer for Windows
- Full description: explain no account, no cloud file bucket, direct-first iroh transfer, BLAKE3 verification, tickets as capability tokens
- Privacy policy: `PRIVACY.md` or hosted equivalent
- Support URL: GitHub Issues or official support page
- Website: <https://lightning-p2p.netlify.app/>
- Source code: <https://github.com/Kerim-Sabic/lightning-p2p>
- Screenshots: send flow, receive flow, QR/link handoff, devices view, transfer complete state
- Age rating: complete in Partner Center
- Category: Utilities / Productivity
- Package/install method: TODO, decide MSIX Store package path
- Security explanation: link `SECURITY.md` and `docs/security-model.md`
- Release notes: summarize version, limitations, and known warnings honestly

## Technical TODOs

- Confirm whether current Tauri packaging can generate an MSIX package suitable
  for Store submission without replacing the NSIS/MSI/Velopack release flow.
- Confirm package identity, publisher, logo assets, display name, and protocol
  declarations match Store requirements.
- Confirm the `lightning-p2p://` deep link behavior passes Store policy review.
- Confirm local-network discovery and firewall behavior are described in the
  Store listing and privacy policy.
- Test install, launch, send, receive, update, and uninstall on a clean Windows VM.

## Manual Partner Center TODOs

- Reserve the app name.
- Complete identity verification.
- Create the app listing.
- Upload screenshots and assets.
- Complete age rating.
- Add privacy policy and support links.
- Submit the package for certification.

Do not claim Microsoft Store availability until the listing is live.
