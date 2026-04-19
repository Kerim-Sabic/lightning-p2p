# Changelog

All notable changes to Lightning P2P are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Semver.

## [Unreleased]

### Added
- **Velopack installer** as a second official Windows install path alongside NSIS. Modern one-click flow, per-user install, delta updates. NSIS remains the default and continues to use `tauri-plugin-updater`; Velopack ships its own updater with its artifact.
- **winget manifest workflow** (`.github/workflows/winget.yml`) auto-publishes to `microsoft/winget-pkgs` after each GitHub release. First submission is manual.
- WiX `upgradeCode` GUID pinned in `tauri.conf.json` to avoid MSI upgrade-code collisions ([tauri#14968](https://github.com/tauri-apps/tauri/issues/14968)).
- Velopack post-install / post-uninstall PowerShell hooks that mirror the NSIS firewall-rule behavior.
- Landing page Download section rebuilt as a three-column NSIS / Velopack / winget picker.
- `llms.txt` and `llms-full.txt` at site root for LLM discoverability.
- Five new SEO-targeted pages: `/wormhole-alternative`, `/wetransfer-alternative`, `/localsend-vs-lightning-p2p`, `/how-to-send-large-files`, `/send-files-between-windows-computers`.
- Per-page structured data: `WebSite`, `Organization`, `BreadcrumbList`, `FAQPage`, `HowTo` JSON-LD in addition to the existing `SoftwareApplication`.
- `<meta name="keywords">`, `preconnect`/`dns-prefetch` hints, and per-page priority in the sitemap.
- Static SEO fallback content now includes body paragraphs, FAQ, and related-page links for each generated route.
- `docs/seo-checklist.md` for off-page SEO submissions.

## [0.3.1] - 2026-04

### Added
- Custom NSIS installer artwork (header and sidebar BMPs).
- Browser landing page at `lightning-p2p.netlify.app` with six SEO pages.
- `lightning-p2p://receive?t=<ticket>` deep-link handler registration.
- Clipboard auto-detect chip on the Receive view.

### Changed
- Adaptive blob import parallelism (up to 128 workers, I/O-scaled).
- Relay-readiness cold-start timeout reduced from 15 s to 6 s.
- Release profile: `lto = "fat"`, `panic = "abort"`.

### Fixed
- LAN discovery on Windows: firewall rule registered at install, widened the remote-info candidate filter to include session-seen peers, logs explicit warnings when the mDNS subscription fails.

## [0.3.0] - 2026-03

Initial 0.3 line. See Git history for prior releases.
