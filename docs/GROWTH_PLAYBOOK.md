# Growth Playbook

This is a practical launch checklist for getting Lightning P2P in front of the
right technical communities without weakening trust with exaggerated claims.

## Positioning

The sharp position is:

> Open-source direct file transfer for Windows and Android. No account, no cloud
> upload, no artificial file-size cap.

Use this instead of broad claims like "secure", "private", or "fastest" unless
the page immediately explains the exact mechanism and evidence.

## First-Week Launch Targets

- GitHub release post: stable `v0.4.6`, download links, checksums, Android signer
  fingerprint, and the demo GIF.
- Hacker News: technical angle around iroh, QUIC, iroh-blobs, and avoiding cloud
  upload links.
- Reddit `r/selfhosted`: no account, no hosted storage, sender-online model,
  exact caveats.
- Reddit `r/opensource`: Apache-2.0, contribution areas, architecture.
- Reddit `r/windows`: Windows installers, SmartScreen reality, checksum
  verification.
- Android communities: sideload APK, Android 10+ baseline, share-target send flow.
- AlternativeTo and similar directories: compare honestly against WeTransfer,
  LocalSend, Magic Wormhole, PairDrop, and Snapdrop.

## What To Pin

GitHub allows three pinned issues, so use them for work that makes the project
more credible to new visitors:

1. real app demo recording
2. repeatable benchmark report
3. winget packaging bootstrap

Avoid pinning internal chores that do not improve first-visitor trust.

## Evidence Ladder

Publish claims only when the evidence exists:

- "No cloud upload": supported by architecture and release behavior.
- "No account": supported by product behavior.
- "No artificial file-size cap": supported by streaming design; still mention
  disk, filesystem, network, and session limits.
- "Fast": use only with benchmark reports that include hardware, route, file
  sizes, app versions, run counts, medians, and failures.
- "Secure": prefer specific language: QUIC TLS, BLAKE3 verification, capability
  tickets, checksums, signer fingerprint, no third-party audit yet.

## Community Response Rules

- Lead with the problem, not the stack.
- Answer limitations directly.
- Do not argue with users who prefer LocalSend, PairDrop, Wormhole, Syncthing, or
  cloud drives; explain the lane where Lightning P2P is strongest.
- Ask for logs only after giving a likely next step.
- Convert repeat questions into FAQ entries or issue templates.

## Conversion Checklist

- README first screen shows product, demo, download, trust, and caveats.
- Latest stable release is non-prerelease and has assets.
- Repository topics include platform, category, and alternative-search terms.
- Social preview image is uploaded in GitHub repository settings.
- Discussions are enabled for questions and ideas.
- Open issues include good first issues that a new contributor can complete in
  one sitting.
- Website has answer pages for high-intent searches:
  - AirDrop for Windows
  - WeTransfer alternative
  - LocalSend alternative
  - Android P2P file transfer
  - large file transfer
  - secure P2P file transfer
  - open-source file transfer

## Follow-Up Content

- Record a real Windows-to-Android transfer.
- Publish a LAN benchmark report against LocalSend and PairDrop.
- Publish a WAN/relay fallback benchmark report.
- Write a short post explaining why receive tickets live in URL fragments.
- Write a short post explaining BLAKE3 content verification in plain language.
- Create a signed Windows release once production signing is configured.
