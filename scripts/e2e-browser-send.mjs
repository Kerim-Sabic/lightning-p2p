// Headless-browser E2E for the browser transfer surface: share on /send,
// receive on /receive, across real tabs and the live iroh relay.
//
// Verifies, in order:
//   1. tab A stages a file, goes live, renders the QR code, and holds the
//      anti-tab-sleep Web Lock + live tab title
//   2. forced GC does not kill the live share
//   3. tab B opens the receive link and completes a real, BLAKE3-verified
//      receive through the UI (asserted on the success badge — the static
//      marketing copy also says "BLAKE3", so match "bytes are proven correct")
//   4. "Stop sharing" really stops serving: tab C must fail to receive
//
// Requirements (not wired into CI yet):
//   - a production bundle being served, e.g.:  pnpm build && pnpm preview
//   - playwright-core resolvable (npm i --no-save playwright-core)
//   - Microsoft Edge installed (channel "msedge"; swap for "chrome" if wanted)
//
// Usage:  BASE=http://localhost:4173 node scripts/e2e-browser-send.mjs
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("playwright-core not found. Run: npm i --no-save playwright-core");
  process.exit(2);
}

const BASE = process.env.BASE ?? "http://localhost:4173";
const payloadPath = path.join(mkdtempSync(path.join(tmpdir(), "lp2p-e2e-")), "e2e-payload.bin");
writeFileSync(payloadPath, randomBytes(2 * 1024 * 1024));

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? "msedge",
  headless: true,
  args: ["--js-flags=--expose-gc"],
});

try {
  const context = await browser.newContext();
  const pageA = await context.newPage();
  pageA.on("pageerror", (e) => console.log("[A pageerror]", e.message));
  await pageA.goto(`${BASE}/send`, { waitUntil: "domcontentloaded" });
  await pageA.setInputFiles('input[type="file"]', payloadPath);
  await pageA.getByRole("button", { name: /start sharing/i }).click();
  await pageA.getByText("Sharing live from this tab").waitFor({ timeout: 120_000 });
  console.log("A: share live");

  if ((await pageA.locator(".qr-code-frame svg").count()) !== 1) {
    throw new Error("QR code not rendered");
  }
  console.log("A: QR rendered");

  const lockNames = await pageA.evaluate(async () => {
    const state = await navigator.locks.query();
    return (state.held ?? []).map((l) => l.name);
  });
  if (!lockNames.includes("lightning-p2p-live-share")) {
    throw new Error(`web lock not held; held=${JSON.stringify(lockNames)}`);
  }
  console.log("A: web lock held (tab-sleep protection)");

  if (!/sharing live/i.test(await pageA.title())) {
    throw new Error("tab title does not signal the live share");
  }

  const link = (await pageA.locator("code").first().innerText()).trim();
  if (!link.includes("/receive#t=fd2:")) throw new Error(`unexpected link: ${link}`);

  await pageA.evaluate(() => {
    if (typeof window.gc === "function") for (let i = 0; i < 10; i += 1) window.gc();
  });
  await new Promise((r) => setTimeout(r, 2000));
  console.log("A: GC forced");

  const pageB = await context.newPage();
  pageB.on("pageerror", (e) => console.log("[B pageerror]", e.message));
  await pageB.goto(link, { waitUntil: "domcontentloaded" });
  await pageB.getByRole("button", { name: /receive in this browser/i }).first().click({ timeout: 30_000 });
  await pageB.getByRole("button", { name: /receive here|receive anyway/i }).click({ timeout: 60_000 });
  await pageB.getByText("bytes are proven correct").waitFor({ timeout: 180_000 });
  if ((await pageB.getByText("e2e-payload.bin").count()) < 1) {
    throw new Error("received file row missing");
  }
  console.log("B: received + verified");

  await pageA.getByRole("button", { name: /stop sharing/i }).click();
  await pageA.getByRole("button", { name: /start sharing/i }).waitFor({ timeout: 15_000 });
  console.log("A: stopped sharing");
  await new Promise((r) => setTimeout(r, 2000));

  const pageC = await context.newPage();
  await pageC.goto(link, { waitUntil: "domcontentloaded" });
  await pageC.getByRole("button", { name: /receive in this browser/i }).first().click({ timeout: 30_000 });
  await pageC.getByRole("button", { name: /receive here|receive anyway/i }).click({ timeout: 60_000 });
  let stopped = false;
  try {
    await pageC.getByText("bytes are proven correct").waitFor({ timeout: 45_000 });
  } catch {
    stopped = true;
  }
  if (!stopped) throw new Error("share still serving after Stop sharing");
  console.log("C: receive fails after stop — shutdown is real");

  console.log("E2E PASS: QR + guards + receive + real stop all verified");
} finally {
  await browser.close();
}
