# SEO Checklist

On-page SEO is in code (see `scripts/build-web-metadata.mjs` and `src/content/web-pages.json`). This file tracks the off-page work that lives outside the repo.

## Submission checklist

### Search engines

- [ ] Google Search Console — add property for `lightning-p2p.netlify.app`, submit `sitemap.xml`.
- [ ] Bing Webmaster Tools — same, submit `sitemap.xml`.
- [ ] Confirm every sitemap URL resolves as `200` and uses the same no-trailing-slash canonical form.
- [ ] Run Google Rich Results Test for `/`, `/download`, `/receive`, `/how-to-send-large-files`, and `/best-p2p-file-transfer`.
- [ ] Validate that `/receive#t=example` does not send the ticket in HTTP requests; only `/receive` should appear in server logs.

### Directories and listings

- [ ] [AlternativeTo](https://alternativeto.net) — list Lightning P2P under WeTransfer, Magic Wormhole, LocalSend, AirDrop alternatives.
- [ ] [awesome-tauri](https://github.com/tauri-apps/awesome-tauri) — PR to add under "File Sharing" or equivalent section.
- [ ] [awesome-rust](https://github.com/rust-unofficial/awesome-rust) — PR under "Applications written in Rust".
- [ ] [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) — PR under "File Transfer & Synchronization" (if criteria met).
- [ ] [Product Hunt](https://www.producthunt.com/) — launch draft.

### Package managers

- [ ] [winget-pkgs](https://github.com/microsoft/winget-pkgs) - first manual submission is open at https://github.com/microsoft/winget-pkgs/pull/362516; subsequent releases via `winget-releaser` action.
- [ ] [Scoop](https://scoop.sh/) bucket entry (optional; extras or community bucket).
- [ ] [Chocolatey](https://community.chocolatey.org/packages) (optional).

### Community

- [ ] r/rust — "Show & tell" post after next visible release.
- [ ] r/selfhosted — positioning as AirDrop/WeTransfer replacement.
- [ ] r/opensource — general awareness post.
- [ ] Hacker News — "Show HN: Lightning P2P — direct peer-to-peer file transfer on Windows" draft.

### GitHub repo settings (manual)

- [ ] Repo description tightened to match landing page hero.
- [ ] Website field set to `https://lightning-p2p.netlify.app`.
- [ ] Topics updated (see README "GitHub Growth Checklist").
- [ ] Social preview image (Settings → Options → Social preview) set to `public/og-image.png`.
- [ ] Pin launch issues for benchmarks, mobile RFC, cross-platform packaging.
- [ ] Enable Discussions (Q&A + Ideas).

## Keyword baseline

Track month-over-month position for these queries. Free tools: Google Search Console, Bing Webmaster Tools. Optional paid: Ahrefs, Semrush.

| Query | Intent | Baseline date | Current position |
|-------|--------|---------------|------------------|
| `p2p file transfer` | Navigational | TBD | TBD |
| `peer to peer file transfer` | Navigational | TBD | TBD |
| `airdrop for windows` | Navigational | TBD | TBD |
| `wetransfer alternative` | Commercial | TBD | TBD |
| `magic wormhole alternative` | Navigational | TBD | TBD |
| `localsend alternative` | Navigational | TBD | TBD |
| `send large files peer to peer` | Navigational | TBD | TBD |
| `free p2p file transfer` | Commercial | TBD | TBD |

Recheck at `+4 weeks`, `+12 weeks`, `+26 weeks`.

## LLM citation probe

Query these prompts in ChatGPT (Search on), Claude (web search on), Perplexity, and Gemini. Check whether Lightning P2P appears in the cited sources.

1. "What's the best open-source app to send files peer-to-peer between computers?"
2. "AirDrop alternative for Windows"
3. "Free WeTransfer alternative that does not upload to the cloud"
4. "Magic Wormhole alternative with a GUI"
5. "How do I send a large file to someone without using WeTransfer?"

Recheck at `+4 weeks` (retrieval-time pickup) and `+12 weeks` (for any training-time effect).

## Once we have traction

- [ ] Aim for 1,000 GitHub stars (unlocks more visibility via GitHub's own ranking signals).
- [ ] Submit to [Open Source Alternative](https://opensourcealternative.to/).
- [ ] Consider a custom domain (`lightning-p2p.dev` or similar) and update all canonical URLs + `SITE_URL`.
- [ ] Add `aggregateRating` to `SoftwareApplication` JSON-LD once you have real, cite-able ratings.
