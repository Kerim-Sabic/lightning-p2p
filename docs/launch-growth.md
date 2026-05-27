# Lightning P2P Launch And Growth Notes

Use this after a release has a benchmark report attached. Do not publish fastest language without the report link.

## Launch Assets

- GitHub release notes with installer links, SHA256 checksums, app version, commit hash, and benchmark report link.
- README hero refreshed with current website preview and mobile screenshots when Android/iOS captures exist.
- Website pages for download, security, benchmarks, receive handoff, LocalSend comparison, WeTransfer comparison, AirDrop for Windows, and Magic Wormhole alternative.
- `public/llms.txt`, `public/llms-full.txt`, generated sitemap, Open Graph image, and canonical metadata.
- Benchmark report using `docs/benchmark-report-template.md`.
- Mobile beta CTA that points to GitHub Releases or GitHub Discussions, not a fake mobile web transfer promise.

## Launch Copy Angles

- **Show HN:** Free, open-source Windows P2P file transfer built with Rust, Tauri, iroh, and verified streaming.
- **r/rust:** Rust desktop app using iroh and iroh-blobs for encrypted direct-first file transfer, with benchmark methodology before speed claims.
- **r/opensource:** Apache-2.0 licensed file transfer app with no account, no cloud upload, signed Windows release pipeline, Android sideload release, and native mobile beta roadmap.
- **AlternativeTo:** Position against LocalSend, PairDrop, WeTransfer, and Magic Wormhole with honest platform trade-offs.
- **Product Hunt:** Lead with no account, no cloud upload, verified bytes, direct-first transfer, and published benchmark methodology.

## Claims Guardrail

Approved before real-device benchmarks:

- Free and open source.
- Direct-first peer-to-peer transfer.
- No account and no cloud file bucket.
- QUIC transport through iroh.
- BLAKE3 verified content through iroh-blobs.
- Windows public release and Android 10+ sideload release.
- Designed for high-throughput direct transfer.
- Automated same-machine benchmark harness available (`pnpm bench:local`;
  CI uploads CSV/JSON on every push). See
  [`reports/automated-local-benchmarks.md`](reports/automated-local-benchmarks.md).
- Reproducible release-evidence catalog at
  [`release-evidence.md`](release-evidence.md).

Hold until real-device benchmarks:

- Fastest transfer app.
- Faster than LocalSend, PairDrop, WeTransfer, or Magic Wormhole.
- Multi-device speed boost improves throughput in practice.
- iOS LAN direct works without entitlement caveats.
- Any throughput number quoted as "Lightning P2P transfer speed" (the
  same-machine harness measures loopback only — quote it as
  "same-machine loopback throughput" or not at all).

## Community Loop

1. Publish the release and benchmark report.
2. Open a pinned GitHub Discussion for Android beta testers.
3. Add a benchmark reproduction issue template for users to submit hardware, route, file size, app version, commit hash, provider count, first-byte time, median throughput, and failures.
4. Convert real benchmark submissions into website proof sections only after the raw report is linked.
