---
name: Lightning P2P
description: Benchmark-first speed lab identity for direct peer-to-peer file transfer.
colors:
  lab-black: "#050706"
  lab-green: "#08120f"
  grid-green: "#0e1b15"
  signal-green: "#7ddf9c"
  proof-amber: "#f0c76b"
  proof-paper: "#f8faf7"
  security-paper: "#f3ead7"
  text-ink: "#111b16"
  border-light: "#d8e2d4"
typography:
  display:
    fontFamily: "Segoe UI Variable Display, Aptos, SF Pro Display, Segoe UI, sans-serif"
    fontSize: "clamp(3rem, 7vw, 5.2rem)"
    fontWeight: 650
    lineHeight: 0.98
    letterSpacing: "normal"
  headline:
    fontFamily: "Segoe UI Variable Display, Aptos, SF Pro Display, Segoe UI, sans-serif"
    fontSize: "clamp(2rem, 4vw, 3rem)"
    fontWeight: 650
    lineHeight: 1.08
    letterSpacing: "normal"
  body:
    fontFamily: "Segoe UI Variable Display, Aptos, SF Pro Display, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
    letterSpacing: "normal"
  label:
    fontFamily: "Segoe UI Variable Display, Aptos, SF Pro Display, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.24em"
rounded:
  sm: "8px"
  md: "10px"
  pill: "9999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.proof-paper}"
    textColor: "{colors.text-ink}"
    rounded: "{rounded.pill}"
    padding: "12px 20px"
  button-proof:
    backgroundColor: "{colors.signal-green}"
    textColor: "{colors.lab-green}"
    rounded: "{rounded.pill}"
    padding: "12px 20px"
  panel-lab:
    backgroundColor: "{colors.grid-green}"
    textColor: "{colors.proof-paper}"
    rounded: "{rounded.sm}"
    padding: "20px"
---

# Design System: Lightning P2P

## 1. Overview

**Creative North Star: "The Speed Lab Bench"**

Lightning P2P should feel like a working bench for measured transfer speed: dark instrumentation, green signal traces, paper-toned proof sections, and amber benchmark warnings where claims need evidence. The system is technical by texture, not by costume.

The website is a brand surface, so it must be memorable, but the app is still a tool. Do not bury users in decoration. The proof, route, ticket, benchmark, and download paths are the composition.

**Key Characteristics:**

- Dense proof beats broad slogans.
- Dark lab surfaces carry transfer and route content.
- Paper sections slow the page down for security, FAQ, and benchmark explanation.
- Controls use familiar icons and clear labels.
- Mobile widths must feel native and touch-first.

## 2. Colors

The palette is a full speed-lab palette: black-green work surfaces, bright green signal accents, amber proof warnings, and tinted paper for explanation sections.

### Primary

- **Lab Black:** The first-viewport field for hero, nav, and footer.
- **Lab Green:** The main app and site surface for download, proof, and resource sections.
- **Signal Green:** Sparse action and route emphasis. Use it for verified transfer, direct path, and primary proof moments.

### Secondary

- **Proof Amber:** Benchmark warnings, mixed route, and evidence-gated claims.

### Neutral

- **Proof Paper:** Light explanation surface for FAQ and quick answers.
- **Security Paper:** Warm technical paper for security model sections.
- **Text Ink:** Dark copy on light proof sections.
- **Border Light:** Dividers and table rules on light sections.

### Named Rules

**The Evidence Color Rule.** Green is for verified or active capability. Amber is for benchmark, caveat, mixed route, or not-yet-proven speed claims.

**The No Purple Rule.** Purple and purple-blue gradients are prohibited for this brand lane.

## 3. Typography

**Display Font:** Segoe UI Variable Display with Aptos, SF Pro Display, Segoe UI, and system sans fallbacks.
**Body Font:** The same sans stack for a technical product voice.
**Label/Mono Font:** Cascadia Code or JetBrains Mono only for tickets, hashes, commands, and diagnostics.

**Character:** One committed sans family keeps the system fast and plainspoken. Weight, scale, and grid position create hierarchy instead of decorative font pairing.

### Hierarchy

- **Display** (650, fluid, tight line-height): Hero statements and first-viewport product position only.
- **Headline** (650, fluid, compact): Section claims, comparison pages, and mobile route summaries.
- **Title** (600, 1.125rem to 1.5rem): Cards, transfer panels, and repeated proof modules.
- **Body** (400, 1rem, 1.65 to 1.8 line-height): Explanations capped around 75 characters.
- **Label** (700, small uppercase): Route, benchmark, security, and release metadata.

### Named Rules

**The No Hype Type Rule.** Do not use oversized type for claims that are not backed by benchmark data on the same page.

## 4. Elevation

Depth is mostly tonal. Surfaces separate through background color, border opacity, and spacing. Shadows appear on the logo, install affordances, and active hover states only, never as generic floating cards.

### Shadow Vocabulary

- **Logo Lift:** A deep black shadow under the brand tile to anchor the first viewport.
- **Action Lift:** A low shadow under primary install buttons when they sit on dark lab surfaces.

### Named Rules

**The Flat Proof Rule.** Benchmark and comparison evidence should read like rows, strips, and lab notes, not floating sales cards.

## 5. Components

### Buttons

- **Shape:** Pills for public website CTAs. App tool buttons may use tighter radii where the existing product shell requires it.
- **Primary:** Proof paper on dark surfaces for Download and Current page actions.
- **Proof:** Signal green for confirmed install and release actions only.
- **Hover / Focus:** Color shift plus visible focus ring. No layout movement.
- **Secondary / Ghost:** Thin white borders on dark surfaces, text stays readable without relying on blur.

### Chips

- **Style:** Pills with low-opacity fill, thin full border, compact uppercase labels.
- **State:** Route chips must include text labels: Direct, Relay, Mixed, or Unknown.

### Cards / Containers

- **Corner Style:** Public website cards use 8 px to 10 px. App shell panels may keep existing 16 px to 24 px radii for product continuity.
- **Background:** Dark cards use white at 3 to 6 percent opacity on lab surfaces. Light cards use paper with a visible neutral border.
- **Shadow Strategy:** Flat by default. Hover may change border and fill, not float the card.
- **Internal Padding:** 16 px to 24 px depending on density.

### Inputs / Fields

- **Style:** Dark translucent fill with full border and clear placeholder contrast.
- **Focus:** Border shift with a soft signal-colored ring.
- **Error / Disabled:** Rose or amber treatment plus plain-language recovery copy.

### Navigation

Desktop website navigation is compact and fixed. Phone UI uses bottom tabs and removes desktop window chrome. Mobile actions favor scan, paste, and pick-file controls instead of drag and drop.

### Signature Component

The proof strip is the signature pattern: route type, provider count, first-byte time, effective Mbps, app version, and commit hash presented as compact lab readouts.

## 6. Do's and Don'ts

### Do:

- **Do** attach speed copy to benchmark method, route, hardware, file size, commit hash, and failure count.
- **Do** show Direct, Relay, and Mixed as text labels in addition to color.
- **Do** keep mobile controls at least 44 px tall with scan, paste, and file-picker flows.
- **Do** use signal green for verified transfer capability and proof amber for caveats.
- **Do** keep comparison pages honest about LocalSend, PairDrop, WeTransfer, and Magic Wormhole trade-offs.

### Don't:

- **Don't** use generic SaaS card stacks with vague productivity copy.
- **Don't** use purple or purple-blue gradient landing pages.
- **Don't** make absolute "fastest" claims without published benchmark evidence.
- **Don't** use cloud-storage marketing language that hides where files go.
- **Don't** promise mobile web transfer as the fastest path when native Android and iOS are the target.
- **Don't** use decorative glassmorphism, side-stripe callouts, gradient text, or repeated icon cards that do not add proof.
