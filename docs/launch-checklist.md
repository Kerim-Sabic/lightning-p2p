# Launch Checklist

Internal checklist for repository promotion work. Keep this out of the README so the public project page stays focused on user value.

## Repository

- [x] Repository homepage is set to `https://lightning-p2p.netlify.app`.
- [x] Repository topics include `p2p`, `peer-to-peer`, `file-transfer`, `windows`, `airdrop-alternative`, `wetransfer-alternative`, `localsend-alternative`, `magic-wormhole-alternative`, `rust`, `tauri`, `iroh`, `quic`, `blake3`, `privacy`, `open-source`, `desktop-app`, `react`, and `typescript`.
- [ ] Upload `public/github-social-preview.png` as the GitHub social preview image from repository settings.
- [x] Pin the maximum supported launch issues: GitHub currently allows 3 pinned issues per repository, so `#17`, `#18`, and `#19` are pinned.
- [ ] Enable Discussions with Q&A and Ideas categories.

## Release Readiness

- [x] Release mismatch audited: `v0.4.6` is the intended latest stable public release; `v0.5.0` remains experimental.
- [ ] Tag and publish `v0.4.6` from commit `9f7dfaa`.
- [ ] Create historical GitHub Release pages for `v0.2.5`, `v0.4.1`, and `v0.4.2`.
- [ ] Confirm the release body says "no artificial file-size cap" instead of "no limits".
- [ ] Confirm Velopack, NSIS, MSI, Android APK, and checksum links point at current stable release assets.

## Public Proof

- [x] Add a 15-30 second README demo asset near the top.
- [ ] Replace the generated demo asset with a captured app recording when local recording tooling is available.
- [ ] Publish benchmark reports before making strong speed claims.
- [ ] Keep README wording private-by-design and ticket-based, not absolute-access-proof.

## Launch Issues

- [x] [Good first issue: add animated demo GIF to README](https://github.com/Kerim-Sabic/lightning-p2p/issues/17)
- [x] [Benchmark: Lightning P2P vs LocalSend vs PairDrop on LAN](https://github.com/Kerim-Sabic/lightning-p2p/issues/18)
- [x] [Packaging: publish winget manifest](https://github.com/Kerim-Sabic/lightning-p2p/issues/19)
- [x] [Platform: macOS packaging spike](https://github.com/Kerim-Sabic/lightning-p2p/issues/20)
- [x] [Platform: Linux packaging spike](https://github.com/Kerim-Sabic/lightning-p2p/issues/21)
- [x] [UX: pause/resume transfers](https://github.com/Kerim-Sabic/lightning-p2p/issues/22)
- [x] [Security: expand threat model documentation](https://github.com/Kerim-Sabic/lightning-p2p/issues/23)
