#!/usr/bin/env node

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const tauriCliPath = resolve(
  repoRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function missingCommand(result) {
  return result.error?.code === "ENOENT";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureTauriCliInstalled() {
  if (!existsSync(tauriCliPath)) {
    fail(
      [
        "The local Tauri CLI is missing.",
        "",
        "Run `pnpm install` in the project root, then try again.",
      ].join("\n"),
    );
  }
}

function ensureRustIsReady() {
  const cargo = run("cargo", ["--version"]);
  if (missingCommand(cargo)) {
    const cargoHomeBin =
      process.platform === "win32" && process.env.USERPROFILE
        ? resolve(process.env.USERPROFILE, ".cargo", "bin")
        : undefined;
    const cargoExe = cargoHomeBin ? resolve(cargoHomeBin, "cargo.exe") : undefined;
    const rustupExe = cargoHomeBin ? resolve(cargoHomeBin, "rustup.exe") : undefined;
    const hasCargoHomeInstall =
      Boolean(cargoExe) &&
      Boolean(rustupExe) &&
      existsSync(cargoExe) &&
      existsSync(rustupExe);

    fail(
      [
        "Lightning P2P cannot start because `cargo` is not available on PATH.",
        "",
        "Tauri calls `cargo metadata` before launching the app, so `pnpm tauri dev` will fail until Rust is installed correctly.",
        "",
        ...(hasCargoHomeInstall && cargoHomeBin
          ? [
              `Rust looks installed at \`${cargoHomeBin}\`, but this terminal cannot see it yet.`,
              "",
              "Most likely fix:",
              "  1. Close this PowerShell window",
              "  2. Open a new PowerShell window",
              "  3. Run `cargo --version` again",
              "",
              "If you need a one-session workaround right now, run:",
              `  $env:Path = "${cargoHomeBin};" + $env:Path`,
              "  cargo --version",
              "",
            ]
          : []),
        "Windows setup:",
        "  1. Install Rustup: `winget install --id Rustlang.Rustup`",
        "  2. Keep the MSVC toolchain selected in the installer",
        "  3. Restart PowerShell / VS Code so PATH is refreshed",
        "  4. Run `rustup default stable-msvc`",
        "  5. Verify with `cargo --version`",
        "",
        "Tauri on Windows also requires:",
        '  - Microsoft C++ Build Tools with "Desktop development with C++"',
        "  - Microsoft Edge WebView2 runtime",
        "",
        "See README.md for the full setup tutorial and troubleshooting steps.",
      ].join("\n"),
    );
  }

  if (process.platform !== "win32") {
    return;
  }

  const rustc = run("rustc", ["-vV"]);
  const hostLine = rustc.stdout
    ?.split(/\r?\n/u)
    .find((line) => line.startsWith("host:"));
  const hostTriple = hostLine?.replace("host:", "").trim();

  if (hostTriple && !hostTriple.endsWith("windows-msvc")) {
    fail(
      [
        `Lightning P2P expects the MSVC Rust toolchain on Windows, but found \`${hostTriple}\`.`,
        "",
        "Switch toolchains, then reopen your terminal:",
        "  `rustup default stable-msvc`",
      ].join("\n"),
    );
  }
}

ensureTauriCliInstalled();
ensureRustIsReady();

const child = spawn(process.execPath, [tauriCliPath, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  fail(`Failed to start the local Tauri CLI: ${error.message}`);
});
