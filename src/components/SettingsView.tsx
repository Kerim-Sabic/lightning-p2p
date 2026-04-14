import { motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  Fingerprint,
  FolderCog,
  Globe,
  HardDriveDownload,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Waypoints,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { NodeStatus, RelayMode } from "../lib/tauri";
import { useTransferStore, type UpdateState } from "../stores/transferStore";

function statusPill(onlineState: NodeStatus["online_state"]): string {
  switch (onlineState) {
    case "direct_ready":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-200";
    case "relay_ready":
      return "border-sky-400/20 bg-sky-500/10 text-sky-200";
    case "degraded":
      return "border-amber-400/20 bg-amber-500/10 text-amber-200";
    case "offline":
      return "border-red-400/20 bg-red-500/10 text-red-200";
    case "starting":
    default:
      return "border-white/[0.08] bg-white/[0.04] text-slate-400";
  }
}

function onlineStateLabel(onlineState: NodeStatus["online_state"]): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay ready";
    case "degraded":
      return "Degraded";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Starting";
  }
}

function onlineStateCopy(nodeStatus: NodeStatus): string {
  switch (nodeStatus.online_state) {
    case "direct_ready":
      return "Direct addresses are available for the fastest peer path.";
    case "relay_ready":
      return "Relay fallback is online. Direct addresses are still warming up.";
    case "degraded":
      return "The node is running, but neither a direct route nor relay is ready yet.";
    case "offline":
      return "Node startup failed. Check relay settings and restart Lightning P2P.";
    case "starting":
    default:
      return "The iroh endpoint is still coming online.";
  }
}

function relayModeLabel(relayMode: RelayMode): string {
  return relayMode === "custom" ? "Custom relay" : "Public relay";
}

function updateStatusCopy(updateState: UpdateState): string {
  switch (updateState.phase) {
    case "checking":
      return "Checking GitHub releases for a newer signed build.";
    case "available":
      return `Version ${updateState.availableVersion ?? "unknown"} is ready to install.`;
    case "upToDate":
      return "This install is already on the latest published version.";
    case "downloading":
      return "Downloading and staging the update package.";
    case "restartRequired":
      return "Update installed. Restart Lightning P2P to launch the new build.";
    case "error":
      return updateState.error ?? "Update check failed.";
    case "idle":
    default:
      return "Automatic checks run on startup when enabled.";
  }
}

function updateProgressLabel(updateState: UpdateState): string | null {
  if (updateState.phase !== "downloading") {
    return null;
  }

  if (updateState.totalBytes) {
    return `${updateState.downloadedBytes.toLocaleString()} / ${updateState.totalBytes.toLocaleString()} bytes`;
  }

  return `${updateState.downloadedBytes.toLocaleString()} bytes downloaded`;
}

function relayModeButtonClass(active: boolean): string {
  return active
    ? "border-sky-400/30 bg-sky-500/14 text-sky-200"
    : "border-white/[0.08] bg-white/[0.04] text-slate-400";
}

export function SettingsView() {
  const settings = useTransferStore((state) => state.settings);
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const updateState = useTransferStore((state) => state.updateState);
  const error = useTransferStore((state) => state.error);
  const pickDownloadDir = useTransferStore((state) => state.pickDownloadDir);
  const openDownloadDir = useTransferStore((state) => state.openDownloadDir);
  const setAutoUpdateEnabled = useTransferStore(
    (state) => state.setAutoUpdateEnabled,
  );
  const setRelayMode = useTransferStore((state) => state.setRelayMode);
  const setCustomRelayUrl = useTransferStore(
    (state) => state.setCustomRelayUrl,
  );
  const checkForUpdates = useTransferStore((state) => state.checkForUpdates);
  const installUpdate = useTransferStore((state) => state.installUpdate);
  const [customRelayUrl, setCustomRelayUrlInput] = useState("");

  useEffect(() => {
    setCustomRelayUrlInput(settings?.custom_relay_url ?? "");
  }, [settings?.custom_relay_url]);

  const updateBusy =
    updateState.phase === "checking" || updateState.phase === "downloading";
  const canInstall = updateState.phase === "available";

  const saveCustomRelay = async (): Promise<void> => {
    await setCustomRelayUrl(customRelayUrl.trim() || null);
  };

  const enableCustomRelay = async (): Promise<void> => {
    if (customRelayUrl.trim()) {
      await setCustomRelayUrl(customRelayUrl.trim());
    }
    await setRelayMode("custom");
  };

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="badge">
          <Settings2 className="h-3 w-3 text-slate-300" />
          Settings
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Lightning P2P settings
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-400">
          Inspect node reachability, control relay behavior, choose where
          verified files land, and manage signed updates.
        </p>
      </header>

      <section className="grid gap-3 lg:grid-cols-2">
        <article className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <Fingerprint className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Node identity</p>
              <p className="text-[13px] text-slate-500">
                Live reachability for this Lightning P2P node.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-lg border px-3 py-1 text-xs ${statusPill(nodeStatus.online_state)}`}
            >
              {onlineStateLabel(nodeStatus.online_state)}
            </span>
            <span className="text-xs text-slate-500">
              {onlineStateCopy(nodeStatus)}
            </span>
          </div>

          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 p-3.5">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.3em] text-slate-500">
              NodeId
            </p>
            <p className="break-all font-mono text-[13px] text-slate-300">
              {nodeStatus.node_id ?? "Initializing node..."}
            </p>
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Direct addresses
              </p>
              <p className="mt-1.5 text-sm font-medium text-slate-200">
                {nodeStatus.direct_address_count}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Relay mode
              </p>
              <p className="mt-1.5 text-sm font-medium text-slate-200">
                {relayModeLabel(settings?.relay_mode ?? "public")}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 p-3.5">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Active relay
            </p>
            <p className="break-all font-mono text-[13px] text-slate-300">
              {nodeStatus.relay_url ?? "Relay not connected yet"}
            </p>
          </div>
        </article>

        <article className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <HardDriveDownload className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Download directory
              </p>
              <p className="text-[13px] text-slate-500">
                Verified receives are exported here after integrity checks.
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 p-3.5">
            <p className="mb-1.5 text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Save location
            </p>
            <p className="break-all font-mono text-[13px] text-slate-300">
              {downloadDir ?? "Resolving download directory..."}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void pickDownloadDir()}
              className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-sm text-slate-200"
            >
              <FolderCog className="h-4 w-4" />
              Change folder
            </button>
            <button
              onClick={() => void openDownloadDir()}
              className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-sm text-slate-200"
            >
              <HardDriveDownload className="h-4 w-4" />
              Open folder
            </button>
          </div>
        </article>
      </section>

      <section className="glass-panel p-5">
        <div className="flex items-center gap-3">
          <div className="glass-icon">
            <Waypoints className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Internet routing</p>
            <p className="text-[13px] text-slate-500">
              Lightning P2P already works over the internet through iroh
              discovery plus relay fallback. Relay changes apply on next app
              launch.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void setRelayMode("public")}
            className={`rounded-xl border px-4 py-2 text-sm transition-all ${relayModeButtonClass(
              (settings?.relay_mode ?? "public") === "public",
            )}`}
          >
            Public relay
          </button>
          <button
            onClick={() => void enableCustomRelay()}
            className={`rounded-xl border px-4 py-2 text-sm transition-all ${relayModeButtonClass(
              settings?.relay_mode === "custom",
            )}`}
          >
            Custom relay
          </button>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <label className="space-y-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Custom relay URL
            </span>
            <input
              value={customRelayUrl}
              onChange={(event) => setCustomRelayUrlInput(event.target.value)}
              placeholder="https://relay.example.com"
              className="glass-input w-full rounded-xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </label>
          <button
            onClick={() => void saveCustomRelay()}
            className="glass-button inline-flex items-center justify-center gap-2 px-4 py-3 text-sm text-slate-200"
          >
            <Globe className="h-4 w-4" />
            Save relay URL
          </button>
        </div>

        <p className="mt-3 text-xs leading-5 text-slate-500">
          Use public relay mode for the default network. Switch to custom only
          when you control the relay endpoint and want stricter routing.
        </p>
      </section>

      <section className="glass-panel p-5">
        <div className="flex items-center gap-3">
          <div className="glass-icon">
            <Download className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Updates</p>
            <p className="text-[13px] text-slate-500">
              Signed releases are distributed through GitHub Releases.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Current version
            </p>
            <p className="mt-1.5 text-sm font-medium tabular-nums text-slate-200">
              {updateState.currentVersion ?? "Unknown"}
            </p>
          </div>
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Available version
            </p>
            <p className="mt-1.5 text-sm font-medium tabular-nums text-slate-200">
              {updateState.availableVersion ?? "None"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm text-slate-400">
          {updateBusy ? (
            <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
          ) : updateState.phase === "restartRequired" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          ) : (
            <RefreshCw className="h-4 w-4 text-slate-500" />
          )}
          <span className="text-[13px]">{updateStatusCopy(updateState)}</span>
        </div>

        {updateState.body ? (
          <p className="mt-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-sm text-slate-300">
            {updateState.body}
          </p>
        ) : null}
        {updateProgressLabel(updateState) ? (
          <p className="mt-2 text-xs tabular-nums text-slate-500">
            {updateProgressLabel(updateState)}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void checkForUpdates()}
            disabled={updateBusy}
            className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${updateBusy ? "animate-spin" : ""}`}
            />
            Check now
          </button>
          <button
            onClick={() => void installUpdate()}
            disabled={!canInstall}
            className="btn-success"
          >
            <span className="relative inline-flex items-center gap-2">
              <Download className="h-4 w-4" />
              Install update
            </span>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
          <div>
            <p className="text-sm font-medium text-white">
              Auto-check on startup
            </p>
            <p className="text-[13px] text-slate-500">
              Check GitHub releases when Lightning P2P launches.
            </p>
          </div>
          <button
            onClick={() =>
              void setAutoUpdateEnabled(!settings?.auto_update_enabled)
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-all duration-200 ${
              settings?.auto_update_enabled
                ? "border-sky-400/30 bg-sky-500/20"
                : "border-white/[0.08] bg-white/[0.04]"
            }`}
            aria-pressed={settings?.auto_update_enabled ?? false}
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={`inline-block h-4 w-4 rounded-full shadow-sm transition-colors ${
                settings?.auto_update_enabled ? "bg-sky-300" : "bg-slate-400"
              }`}
              style={{
                marginLeft: settings?.auto_update_enabled ? "22px" : "3px",
              }}
            />
          </button>
        </div>
      </section>

      {error ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </motion.div>
      ) : null}
    </div>
  );
}
