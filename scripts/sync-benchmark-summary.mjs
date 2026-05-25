#!/usr/bin/env node
// Sync src/content/local-benchmark-summary.json from
// docs/reports/raw/local/latest.json. Run after pnpm bench:local. Exits 0
// when the summary is already in sync, 0 when it was rewritten, 1 on error.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const rawPath = resolve(repoRoot, "docs/reports/raw/local/latest.json");
const targetPath = resolve(repoRoot, "src/content/local-benchmark-summary.json");
const caveat =
  "Same-machine loopback only. Not Windows ↔ Android. Not WAN. Not relay. See docs/reports/automated-local-benchmarks.md.";

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const raw = JSON.parse(readFileSync(rawPath, "utf8"));
const summary = {
  schemaVersion: 1,
  generatedAtUnix: raw.generated_at_unix,
  appVersion: raw.app_version,
  commitHash: raw.commit_hash,
  os: raw.os,
  arch: raw.arch,
  harness: raw.harness,
  transport: raw.transport,
  scenarios: raw.summary.map((s) => ({
    scenario: s.scenario,
    bytes: s.bytes,
    runs: s.runs,
    successes: s.successes,
    failures: s.failures,
    medianTotalMs: s.median_total_ms,
    medianDownloadMs: s.median_download_ms,
    medianExportMs: s.median_export_ms,
    medianEffectiveMbps:
      s.median_effective_mbps === null
        ? null
        : round(s.median_effective_mbps, 2),
  })),
  caveat,
};

const next = `${JSON.stringify(summary, null, 2)}\n`;
let previous = "";
try {
  previous = readFileSync(targetPath, "utf8");
} catch {
  previous = "";
}

if (previous === next) {
  console.log("local-benchmark-summary.json already in sync");
  process.exit(0);
}

writeFileSync(targetPath, next);
console.log(`wrote ${targetPath}`);
