import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const [netlifyToml, tauriConfigText] = await Promise.all([
  readFile(join(root, "netlify.toml"), "utf8"),
  readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
]);
const tauriConfig = JSON.parse(tauriConfigText);
const failures = [];

function fail(message) {
  failures.push(message);
}

function parseHeadersBlocks(source) {
  const blocks = [];
  let current = null;

  for (const line of source.split(/\r?\n/)) {
    if (line.trim() === "[[headers]]") {
      current = { path: null, values: {} };
      blocks.push(current);
      continue;
    }
    if (!current) continue;

    const pathMatch = line.match(/^\s*for\s*=\s*"([^"]+)"/);
    if (pathMatch) current.path = pathMatch[1];

    const valueMatch = line.match(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/);
    if (valueMatch) current.values[valueMatch[1].toLowerCase()] = valueMatch[2];
  }

  return blocks;
}

function parseCsp(value, label) {
  if (!value) {
    fail(`${label} does not configure Content-Security-Policy.`);
    return new Map();
  }

  const directives = new Map();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), new Set(sources));
  }
  assertScriptPolicy(directives, label);
  return directives;
}

function assertScriptPolicy(directives, label) {
  const scriptSources = directives.get("script-src");
  if (!scriptSources) return;
  for (const source of ["*", "'unsafe-inline'", "'unsafe-eval'"]) {
    if (scriptSources.has(source)) {
      fail(`${label} allows ${source} through script-src.`);
    }
  }
}

function requireSources(directives, directive, expected, label) {
  const actual = directives.get(directive);
  if (!actual) {
    fail(`${label} is missing the ${directive} directive.`);
    return;
  }
  for (const source of expected) {
    if (!actual.has(source)) {
      fail(`${label} ${directive} is missing ${source}.`);
    }
  }
}

const headers = parseHeadersBlocks(netlifyToml);
const globalHeader = headers.find((block) => block.path === "/*");
const globalCsp = parseCsp(
  globalHeader?.values["content-security-policy"],
  "Netlify global headers",
);
for (const [directive, sources] of [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "'wasm-unsafe-eval'"]],
  ["connect-src", ["'self'", "https:", "wss:"]],
  ["worker-src", ["'self'", "blob:"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
  ["frame-ancestors", ["'none'"]],
]) {
  requireSources(globalCsp, directive, sources, "Netlify global CSP");
}

for (const route of ["/receive", "/receive/*", "/send", "/send/*"]) {
  const block = headers.find((candidate) => candidate.path === route);
  const csp = parseCsp(
    block?.values["content-security-policy"],
    `Netlify ${route} headers`,
  );
  requireSources(csp, "default-src", ["'self'"], `Netlify ${route} CSP`);
  requireSources(
    csp,
    "script-src",
    ["'self'", "'wasm-unsafe-eval'"],
    `Netlify ${route} CSP`,
  );
  requireSources(csp, "connect-src", ["https:", "wss:"], `Netlify ${route} CSP`);
  requireSources(csp, "worker-src", ["blob:"], `Netlify ${route} CSP`);
  requireSources(csp, "base-uri", ["'self'"], `Netlify ${route} CSP`);
  requireSources(csp, "form-action", ["'self'"], `Netlify ${route} CSP`);
  requireSources(csp, "frame-ancestors", ["'none'"], `Netlify ${route} CSP`);
}

const tauriCsp = tauriConfig.app?.security?.csp;
if (!tauriCsp || typeof tauriCsp !== "object") {
  fail("Tauri app security does not configure a CSP.");
} else {
  const tauriDirectives = new Map(
    Object.entries(tauriCsp).map(([directive, sources]) => [
      directive.toLowerCase(),
      new Set(String(sources).split(/\s+/)),
    ]),
  );
  for (const [directive, sources] of [
    ["default-src", ["'self'", "customprotocol:", "asset:"]],
    ["script-src", ["'self'"]],
    ["connect-src", ["ipc:", "http://ipc.localhost"]],
  ]) {
    requireSources(tauriDirectives, directive, sources, "Tauri CSP");
  }
  assertScriptPolicy(tauriDirectives, "Tauri CSP");
}

if (failures.length > 0) {
  console.error("Security-policy check failed:");
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log("Security-policy check passed: Netlify routes and Tauri CSP are constrained.");
