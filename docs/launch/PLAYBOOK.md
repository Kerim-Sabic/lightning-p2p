# Launch Playbook

A single-page runbook for the v0.9.0 launch. Grounded in what actually moves
GitHub stars, not vibes.

## The three facts this plan is built on

1. **A Show HN is a pulse, not a strategy.** ~92% of a launch's star impact
   lands within 48h; a good launch is ~120-290 stars. Durable growth comes
   from a product people re-recommend + repeatable content, not one post.
   ([Show HN by the numbers](https://danfking.github.io/blog/2026/04/23/show-hn-by-the-numbers/))
2. **Personal story > feature list.** A personal-story framing gets ~3x the
   upvotes of a technical description. Lead with the 6 GB-video problem.
3. **"Try it in <5 min" ~2x conversion.** The in-browser receiver *is* the
   sub-5-minute try. That's why v0.9.0 is the launch trigger, not v0.8.0.

## Pre-flight gates (all must be true before D-0)

- [ ] v0.9.0 tagged; every download link works in a fresh incognito window.
- [ ] Browser receiver live on the site; tested Chrome + Firefox + Safari,
      including one forced-relay (phone-hotspot) transfer.
- [ ] `docs/reports/v0.9.0-benchmarks.md` published; every number in every
      post matches it. No "fastest" claim.
- [ ] README leads with the demo GIF; social preview image uploaded in repo
      Settings → General.
- [ ] All 8 `good first issue`s still open and labeled (a visitor's way in).
- [ ] Prepared HN replies re-read (relay privacy, why-not-WebRTC, unsigned
      binaries, iroh 1.0, benchmark honesty) — see `hackernews-show-hn.md`.

## Day-by-day (all times ET)

| When | Action | Notes |
|---|---|---|
| **D-7 to D-4** | Freeze v0.9.0. Publish benchmark report. Verify every link incognito. | No new features; only fixes. |
| **D-3** | Re-read prepared replies. Line up 3-5 people who'll genuinely look on launch morning (not vote-rings — real early eyes). | HN penalizes vote manipulation; this is just "be awake." |
| **D-2 (Sun)** | Publish the dev.to deep-dive: "Shipping one Rust transfer engine to desktop, Android, and the browser with iroh." | This is the canonical link everything else points to. Building-in-public tone. |
| **D-1 (Mon)** | Schedule the Twitter/X thread; draft the LinkedIn post. **Do not post yet.** | Monday HN is a firehose; hold. |
| **D-0 (Tue or Wed, 8-10am)** | **Show HN.** Personal-story title from `hackernews-show-hn.md`. Then be present all day to reply. | Single best lever. Reply fast, concede limitations honestly. |
| D-0, when it gains traction | Fire the Twitter thread; cross-link HN. LinkedIn that evening. | Time to the front-page push, don't double-post cold. |
| **D+1 (morning)** | r/rust — the engineering angle (`reddit-rust.md`, refreshed). | "Same Rust code on 4 OSes + browser via WASM" is the hook. |
| **D+2** | r/selfhosted — the CLI + no-cloud angle (`reddit-selfhosted.md`). | `lightning-p2p-cli send` piping resonates hard here. |
| **D+3** | r/opensource (`reddit-opensource.md`). | Apache-2.0, no telemetry, inspectable. |
| **D+4** | r/androidapps / r/android (`reddit-android.md`). | Signed APK + share-target. |
| **D+7 to D+14** | Product Hunt (midnight PT). Submit to awesome-lists. winget / Homebrew cask / AUR. | PH once you have a few testimonials. |

## Awesome-list + directory submissions (durable, do these regardless of launch)

- `awesome-rust` (applications → utilities)
- `awesome-selfhosted` (file transfer)
- `awesome-privacy` / `privacytools`
- `alternativeto.net` (list vs WeTransfer, AirDrop, LocalSend)

## After the pulse: the actual growth engine

The launch buys a spike; these keep the line climbing:

- **Milestone posts** at every 100 stars (short, genuine, "here's what changed").
- **Content cadence**: one dev.to/Hashnode post every ~2 weeks (how-tos,
  "building X with iroh", not ads).
- **Ship the `good first issue`s' PRs fast** — every merged first-time
  contributor is a durable advocate. This is the LocalSend playbook.
- **i18n**: once the strings module lands (issue), community translations
  unlock language-filtered trending — LocalSend's biggest multiplier.

## What NOT to do

- Don't claim "fastest" or post competitor speed numbers without the matrix.
- Don't buy stars or organize vote-rings — HN/GitHub both detect and penalize.
- Don't spend the Show HN before the browser receiver is live.
- Don't argue with critics; concede real limitations and log them as issues.
