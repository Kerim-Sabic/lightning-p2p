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
const shareLinks = await readText("src/lib/shareLinks.ts");

const cargoVersion = matchRequired(
  cargoToml,
  /^\s*version\s*=\s*"([^"]+)"/m,
  "Cargo package version",
);
const stableTag = matchRequired(
  shareLinks,
  /STABLE_RELEASE_TAG\s*=\s*"([^"]+)"/,
  "STABLE_RELEASE_TAG",
);
const experimentalTag = matchRequired(
  shareLinks,
  /EXPERIMENTAL_RELEASE_TAG\s*=\s*"([^"]+)"/,
  "EXPERIMENTAL_RELEASE_TAG",
);

assertEqual(cargoVersion, packageJson.version, "Cargo/package version");
assertEqual(tauriConfig.version, packageJson.version, "Tauri/package version");
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
