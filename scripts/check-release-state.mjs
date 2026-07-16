import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function readText(path) {
  return readFile(join(root, path), "utf8");
}

function fail(message) {
  failures.push(message);
}

function matchRequired(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) {
    fail(`Could not find ${label}.`);
    return null;
  }
  return match[1];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    fail(`${label} mismatch: expected ${expected}, found ${actual}.`);
  }
}

function assertIncludes(text, value, label) {
  if (!text.includes(value)) {
    fail(`${label} does not mention ${value}.`);
  }
}

const failures = [];

const packageJson = JSON.parse(await readText("package.json"));
const cargoToml = await readText("src-tauri/Cargo.toml");
const tauriConfig = JSON.parse(await readText("src-tauri/tauri.conf.json"));
const releaseManifest = JSON.parse(
  await readText("src/content/release-manifest.json"),
);
const benchmarkSummary = JSON.parse(
  await readText("src/content/local-benchmark-summary.json"),
);

const cargoVersion = matchRequired(
  cargoToml,
  /^\s*version\s*=\s*"([^"]+)"/m,
  "Cargo package version",
);
const stableTag = releaseManifest.stableReleaseTag;
const experimentalTag = releaseManifest.experimentalReleaseTag;
const lastAndroidReleaseTag = releaseManifest.lastAndroidReleaseTag;

assertEqual(cargoVersion, packageJson.version, "Cargo/package version");
assertEqual(tauriConfig.version, packageJson.version, "Tauri/package version");
assertEqual(
  releaseManifest.currentAppVersion,
  packageJson.version,
  "Release manifest/package version",
);
assertEqual(
  releaseManifest.benchmark.appVersion,
  benchmarkSummary.appVersion,
  "Release manifest/benchmark app version",
);
assertEqual(
  releaseManifest.benchmark.commitHash,
  benchmarkSummary.commitHash,
  "Release manifest/benchmark commit",
);
assertEqual(
  experimentalTag,
  `v${packageJson.version}`,
  "Experimental release tag/current app version",
);

if (stableTag === experimentalTag) {
  fail("Stable and experimental release tags must remain distinct.");
}

for (const [path, label] of [
  ["README.md", "README"],
  ["src/content/web-pages.json", "website page metadata"],
  ["src/components/WebLandingPage.tsx", "website landing page"],
  ["scripts/build-web-metadata.mjs", "metadata generator"],
  ["docs/ROADMAP.md", "roadmap"],
]) {
  const text = await readText(path);
  assertIncludes(text, stableTag, label);
  assertIncludes(text, experimentalTag, label);
}

const staleAndroidApkUrl =
  "releases/latest/download/LightningP2P-android-latest.apk";
const staleAndroidChecksumsUrl =
  "releases/latest/download/SHA256SUMS-android.txt";
for (const [path, label] of [
  ["README.md", "README"],
  ["index.html", "source HTML metadata"],
  ["public/llms-full.txt", "LLM context"],
  ["scripts/android-physical-acceptance.ps1", "Android acceptance script"],
  ["docs/android-release-runbook.md", "Android release runbook"],
]) {
  const text = await readText(path);
  assertIncludes(text, lastAndroidReleaseTag, label);
  if (text.includes(staleAndroidApkUrl)) {
    fail(`${label} still points the Android APK at /releases/latest.`);
  }
  if (text.includes(staleAndroidChecksumsUrl)) {
    fail(`${label} still points Android checksums at /releases/latest.`);
  }
}

if (failures.length > 0) {
  console.error("Release-state check failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(
  `Release-state check passed: app v${packageJson.version}, stable ${stableTag}, experimental ${experimentalTag}.`,
);
