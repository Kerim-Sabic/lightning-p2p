# Growth Playbook

This is a practical launch checklist for getting Lightning P2P in front of the
right technical communities without weakening trust with exaggerated claims.

## Positioning

The sharp position is:

> Open-source direct file transfer for Windows and Android. No account, no cloud
> upload, no artificial file-size cap.

Use this instead of broad claims like "secure", "private", or "fastest" unless
the page immediately explains the exact mechanism and evidence.

## 2026 Research Baseline

- GitHub's own docs frame the README as the first visitor explanation: what the
  project does, why it is useful, how to start, where to get help, and who
  maintains it. Keep the first screen download-and-proof focused.
- GitHub topics help discovery by purpose, subject, community, and language.
  Use all 20 slots deliberately: platform, transfer category, alternatives, and
  stack terms only.
- GitHub Releases can carry release notes, binary assets, and a release
  Discussion. Every public launch should point to one release page with
  checksums, signing status, and benchmark caveats.
- GitHub Discussions are the right place for Q&A, Android beta feedback,
  benchmark submissions, and roadmap debate that is not yet scoped into an
  issue.
- Google says AI Overviews and AI Mode do not need special AI-only files,
  special markup, or separate schema. The same fundamentals still matter:
  crawlable pages, useful text, internal links, page experience, images where
  helpful, and structured data that matches visible content.
- Structured data should be accurate and complete rather than overstuffed. Use
  JSON-LD for SoftwareApplication, FAQPage, HowTo, BreadcrumbList, WebSite, and
  SoftwareSourceCode only where the visible page supports it.

Sources:

- GitHub README docs: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes
- GitHub topics docs: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics
- GitHub releases docs: https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
- GitHub Discussions docs: https://docs.github.com/en/discussions
- Google AI features docs: https://developers.google.com/search/docs/appearance/ai-features
- Google structured data docs: https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data

## No Unrelated SEO Stuffing

Do not add unrelated outbound promotion to the Lightning P2P website, README, or
LLM files for the sake of boosting another domain. A medtech site such as
horalix.com should earn AEO/SEO visibility from its own evidence pages, named
authors, clinical disclaimers, schema, and trustworthy third-party coverage.
If Lightning P2P links to Horalix later, it should be because there is a real
maintainer, sponsor, case-study, or company context visible to users.

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

## Star Growth Loop

The best star loop is tied to product success, not generic begging:

1. Sender shares a normal receive link.
2. Receiver lands on the handoff page and installs the native app if needed.
3. Transfer completes.
4. The app offers a dismissible GitHub star CTA only after value is delivered.
5. The README turns new stargazers into testers with download, proof, caveats,
   good-first areas, and benchmark submission links.

This loop is already partially implemented through receive handoff pages,
route-specific SEO pages, release artifacts, and the post-transfer star CTA.
Next work: real demo video, real-device benchmark report, discussion launch
thread, and pinned issues that a new contributor can finish quickly.

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
