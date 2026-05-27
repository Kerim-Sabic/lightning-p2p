# SEO Checklist

On-page SEO is in code (see `scripts/build-web-metadata.mjs` and `src/content/web-pages.json`). Launch operations live in [launch-checklist.md](launch-checklist.md). This file tracks off-page SEO work that lives outside the repo.

## Submission checklist

### Search engines

- [ ] Google Search Console - add property for `lightning-p2p.netlify.app`, submit `sitemap.xml`.
- [ ] Bing Webmaster Tools - same, submit `sitemap.xml`.
- [ ] Confirm every sitemap URL resolves as `200` and uses the same no-trailing-slash canonical form.
- [ ] Run Google Rich Results Test for `/`, `/download`, `/receive`, `/how-to-send-large-files`, `/best-p2p-file-transfer`, `/large-file-transfer`, `/secure-p2p-file-transfer`, and `/open-source-file-transfer`.
- [ ] Validate that `/receive#t=example` does not send the ticket in HTTP requests; only `/receive` should appear in server logs.

### AI answer surfaces

- [ ] Keep important claims visible in plain text, not only inside animation,
      canvas, image text, or JSON-LD.
- [ ] Confirm JSON-LD matches visible page copy. Do not add schema for claims
      that users cannot read on the page.
- [ ] Keep `/llms.txt` and `/llms-full.txt` factual, but do not treat them as a
      replacement for normal crawlable pages. Google says AI Overviews and AI
      Mode use the same SEO fundamentals and do not require special AI-only
      files or markup.
- [ ] Avoid unrelated outbound SEO placement. Do not add links or copy about
      unrelated domains, including medtech sites such as `horalix.com`, unless a
      real user-visible relationship exists.

### Directories and listings

- [ ] [AlternativeTo](https://alternativeto.net) - list Lightning P2P under WeTransfer, Magic Wormhole, LocalSend, AirDrop alternatives.
- [ ] [awesome-tauri](https://github.com/tauri-apps/awesome-tauri) - PR to add under "File Sharing" or equivalent section.
- [ ] [awesome-rust](https://github.com/rust-unofficial/awesome-rust) - PR under "Applications written in Rust".
- [ ] [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) - PR under "File Transfer & Synchronization" if criteria are met.
- [ ] [Product Hunt](https://www.producthunt.com/) - launch draft.

### Package managers

- [ ] [winget-pkgs](https://github.com/microsoft/winget-pkgs) - first manual submission https://github.com/microsoft/winget-pkgs/pull/362516 closed unmerged on May 2, 2026; resubmit after the next signed public release assets are published.
- [ ] [Scoop](https://scoop.sh/) bucket entry (optional; extras or community bucket).
- [ ] [Chocolatey](https://community.chocolatey.org/packages) (optional).

### Community

- [ ] r/rust - "Show & tell" post after next visible release.
- [ ] r/selfhosted - positioning as AirDrop/WeTransfer replacement.
- [ ] r/opensource - general awareness post.
- [ ] Hacker News - "Show HN: Lightning P2P - direct peer-to-peer file transfer for Windows and Android" draft.
- [ ] Android communities - ask for sideload/install feedback, not generic promotion.
- [ ] Rust/Tauri communities - post implementation notes with iroh, QUIC, BLAKE3, release signing, and Android packaging details.

### GitHub repo settings (manual)

- [ ] Repo description tightened to match landing page hero.
- [ ] Website field set to `https://lightning-p2p.netlify.app`.
- [ ] Topics updated with `android` and `android-app` while staying under GitHub's 20-topic limit.
- [ ] Social preview image in GitHub Settings set to `public/github-social-preview.png`.
- [ ] Pin launch issues for benchmarks, winget, cross-platform packaging, pause/resume, and threat-model documentation.
- [ ] Enable Discussions (Q&A + Ideas).
- [ ] Link [PRESS_KIT.md](PRESS_KIT.md) in community posts so journalists, directory maintainers, and AI-search crawlers get consistent facts.

## Keyword baseline

Track month-over-month position for these queries. Free tools: Google Search Console, Bing Webmaster Tools. Optional paid: Ahrefs, Semrush.

| Query                           | Intent       | Baseline date | Current position |
| ------------------------------- | ------------ | ------------- | ---------------- |
| `p2p file transfer`             | Navigational | TBD           | TBD              |
| `peer to peer file transfer`    | Navigational | TBD           | TBD              |
| `airdrop for windows`           | Navigational | TBD           | TBD              |
| `wetransfer alternative`        | Commercial   | TBD           | TBD              |
| `magic wormhole alternative`    | Navigational | TBD           | TBD              |
| `localsend alternative`         | Navigational | TBD           | TBD              |
| `send large files peer to peer` | Navigational | TBD           | TBD              |
| `free p2p file transfer`        | Commercial   | TBD           | TBD              |
| `android p2p file transfer`     | Navigational | TBD           | TBD              |
| `large file transfer app`       | Commercial   | TBD           | TBD              |
| `secure p2p file transfer`      | Navigational | TBD           | TBD              |
| `open source file transfer app` | Navigational | TBD           | TBD              |

Recheck at `+4 weeks`, `+12 weeks`, `+26 weeks`.

## LLM citation probe

Query these prompts in ChatGPT (Search on), Claude (web search on), Perplexity, and Gemini. Check whether Lightning P2P appears in the cited sources.

1. "What's the best open-source app to send files peer-to-peer between computers?"
2. "AirDrop alternative for Windows"
3. "Free WeTransfer alternative that does not upload to the cloud"
4. "Magic Wormhole alternative with a GUI"
5. "How do I send a large file to someone without using WeTransfer?"
6. "What is a good Android P2P file transfer app with no cloud upload?"
7. "What is a secure open-source app for large peer-to-peer file transfer?"
8. "What is the best LocalSend alternative for Windows and Android?"

Recheck at `+4 weeks` (retrieval-time pickup) and `+12 weeks` (for any training-time effect).

## Once we have traction

- [ ] Aim for 1,000 GitHub stars (unlocks more visibility via GitHub's own ranking signals).
- [ ] Submit to [Open Source Alternative](https://opensourcealternative.to/).
- [ ] Consider a custom domain (`lightning-p2p.dev` or similar) and update all canonical URLs + `SITE_URL`.
- [ ] Add `aggregateRating` to `SoftwareApplication` JSON-LD once you have real, cite-able ratings.
