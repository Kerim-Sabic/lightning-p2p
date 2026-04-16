import { motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  Fingerprint,
  FolderCog,
  Globe,
  HardDriveDownload,
  LoaderCircle,
  Radar,
  RefreshCw,
  ScanSearch,
  Settings2,
  Waypoints,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  isDesktopRuntime,
  type NodeStatus,
  type RelayMode,
} from "../lib/tauri";
import { useTransferStore, type UpdateState } from "../stores/transferStore";

function statusPill(onlineState: NodeStatus["online_state"]): string {
  switch (onlineState) {
    case "direct_ready":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
    case "relay_ready":
      return "border-sky-400/20 bg-sky-500/10 text-sky-100";
    case "degraded":
      return "border-amber-400/20 bg-amber-500/10 text-amber-100";
    case "offline":
      return "border-rose-400/20 bg-rose-500/10 text-rose-100";
    case "starting":
    default:
      return "border-white/10 bg-white/[0.05] text-slate-100";
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
      return "The node has direct addresses and can advertise the fastest route to peers immediately.";
    case "relay_ready":
      return "Relay fallback is live while direct addresses continue warming up.";
    case "degraded":
      return "The endpoint is running, but neither a direct route nor relay has settled yet.";
    case "offline":
      return "Node startup failed. Review relay configuration and local network access.";
    case "starting":
    default:
      return "The iroh endpoint is still coming online in the background.";
  }
}

function relayModeLabel(relayMode: RelayMode): string {
  return relayMode === "custom" ? "Custom relay" : "Public relay";
}

function updateStatusCopy(updateState: UpdateState): string {
  switch (updateState.phase) {
    case "checking":
      return "Checking published signed releases for a newer build.";
    case "available":
      return `Version ${updateState.availableVersion ?? "unknown"} is ready to install.`;
    case "upToDate":
      return "This install already matches the latest published build.";
    case "downloading":
      return "Downloading and staging the update package.";
    case "restartRequired":
      return "Update installed. Restart Lightning P2P to switch over.";
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
    ? "border-sky-300/20 bg-sky-500/14 text-sky-100"
    : "border-white/10 bg-white/[0.04] text-slate-300";
}

export function SettingsView() {
  const settings = useTransferStore((state) => state.settings);
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const updateState = useTransferStore((state) => state.updateState);
  const pickDownloadDir = useTransferStore((state) => state.pickDownloadDir);
  const openDownloadDir = useTransferStore((state) => state.openDownloadDir);
  const setAutoUpdateEnabled = useTransferStore(
    (state) => state.setAutoUpdateEnabled,
  );
  const setRelayMode = useTransferStore((state) => state.setRelayMode);
  const setCustomRelayUrl = useTransferStore(
    (state) => state.setCustomRelayUrl,
  );
  const setLocalDiscoveryEnabled = useTransferStore(
    (state) => state.setLocalDiscoveryEnabled,
  );
  const checkForUpdates = useTransferStore((state) => state.checkForUpdates);
  const installUpdate = useTransferStore((state) => state.installUpdate);
  const desktopRuntime = isDesktopRuntime();
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
      <section className="grid gap-4 xl:grid-cols-[1.24fr_0.76fr]">
        <header className="glass-panel hero-panel relative overflow-hidden p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_86%_18%,rgba(56,189,248,0.08),transparent_24%),radial-gradient(circle_at_12%_100%,rgba(148,163,184,0.05),transparent_28%)]" />
          <div className="relative">
          <div className="badge">
            <Settings2 className="h-3 w-3 text-slate-200" />
            Settings
          </div>
          <h1 className="page-title mt-6 max-w-[14ch]">
            Tune reachability, storage, and update flow
          </h1>
          <p className="page-copy mt-4 max-w-[60ch]">
            These controls govern how Lightning P2P exposes routes, where
            verified files land, and how quickly this install picks up new
            signed releases.
          </p>

          <div className="hero-metrics mt-7 grid gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <p className="metric-label">Node state</p>
              <p className="mt-2 text-[15px] font-semibold tracking-[-0.02em] text-white">
                {onlineStateLabel(nodeStatus.online_state)}
              </p>
            </div>
            <div className="stat-card">
              <p className="metric-label">Relay mode</p>
              <p className="mt-2 text-[15px] font-semibold tracking-[-0.02em] text-white">
                {relayModeLabel(settings?.relay_mode ?? "public")}
              </p>
            </div>
            <div className="stat-card">
              <p className="metric-label">App version</p>
              <p className="mt-2 text-[15px] font-semibold tabular-nums tracking-[-0.02em] text-white">
                {updateState.currentVersion ?? "Unknown"}
              </p>
            </div>
          </div>
          </div>
        </header>

        <aside className="glass-panel p-6">
          <div className="flex items-start gap-3">
            <div className="glass-icon h-12 w-12 rounded-2xl">
              <Waypoints className="h-5 w-5 text-sky-200" />
            </div>
            <div>
              <div className="badge">
                <Radar className="h-3 w-3 text-sky-200" />
                Connection strategy
              </div>
              <h2 className="mt-4 text-[1.55rem] font-semibold leading-tight tracking-[-0.03em] text-white">
                Keep the direct path healthy
              </h2>
              <p className="meta-copy mt-3">
                Direct routes are the speed path. Relay connectivity is the
                fallback that preserves reachability when NAT or firewall rules
                prevent peers from dialing each other directly.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2">
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Direct addresses
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
                {nodeStatus.direct_address_count}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Active relay
              </p>
              <p className="mt-1.5 break-all font-mono text-[12px] leading-6 text-white">
                {nodeStatus.relay_url ?? "Relay not connected yet"}
              </p>
            </div>
          </div>
        </aside>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <Fingerprint className="h-5 w-5 text-sky-200" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Node identity</p>
              <p className="text-[13px] text-slate-300/72">
                Live reachability for this Lightning P2P node.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs ${statusPill(nodeStatus.online_state)}`}
            >
              {onlineStateLabel(nodeStatus.online_state)}
            </span>
            <span className="text-xs text-slate-300/72">
              {onlineStateCopy(nodeStatus)}
            </span>
          </div>

          <div className="mt-3 rounded-2xl border border-white/8 bg-black/25 p-4">
            <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-500">
              NodeId
            </p>
            <p className="break-all font-mono text-[13px] leading-6 text-slate-100/88">
              {nodeStatus.node_id ?? "Initializing node..."}
            </p>
          </div>
        </article>

        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <HardDriveDownload className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Download directory
              </p>
              <p className="text-[13px] text-slate-300/72">
                Verified receives are exported here after integrity checks.
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-white/8 bg-black/25 p-4">
            <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Save location
            </p>
            <p className="break-all font-mono text-[13px] leading-6 text-slate-100/88">
              {downloadDir ?? "Resolving download directory..."}
            </p>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => void pickDownloadDir()}
              disabled={!desktopRuntime}
              className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-sm text-slate-100"
            >
              <FolderCog className="h-4 w-4" />
              Change folder
            </button>
            <button
              onClick={() => void openDownloadDir()}
              disabled={!desktopRuntime}
              className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-sm text-slate-100"
            >
              <HardDriveDownload className="h-4 w-4" />
              Open folder
            </button>
          </div>
        </article>
      </section>

      <section className="glass-panel p-6">
        <div className="flex items-center gap-3">
          <div className="glass-icon">
            <Waypoints className="h-5 w-5 text-sky-200" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Relay routing</p>
            <p className="text-[13px] text-slate-300/72">
              Lightning P2P uses iroh discovery plus relay fallback. Relay
              changes apply on the next app launch.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => void setRelayMode("public")}
            disabled={!desktopRuntime}
            className={`rounded-2xl border px-4 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 ${relayModeButtonClass(
              (settings?.relay_mode ?? "public") === "public",
            )}`}
          >
            Public relay
          </button>
          <button
            onClick={() => void enableCustomRelay()}
            disabled={!desktopRuntime}
            className={`rounded-2xl border px-4 py-2 text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50 ${relayModeButtonClass(
              settings?.relay_mode === "custom",
            )}`}
          >
            Custom relay
          </button>
        </div>

        <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_auto] xl:items-end">
          <label className="space-y-2">
            <span className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Custom relay URL
            </span>
            <input
              value={customRelayUrl}
              onChange={(event) => setCustomRelayUrlInput(event.target.value)}
              placeholder="https://relay.example.com"
              className="glass-input w-full rounded-2xl px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500"
            />
          </label>
          <button
            onClick={() => void saveCustomRelay()}
            disabled={!desktopRuntime}
            className="glass-button inline-flex items-center justify-center gap-2 px-4 py-3 text-sm text-slate-100"
          >
            <Globe className="h-4 w-4" />
            Save relay URL
          </button>
        </div>
        {!desktopRuntime ? (
          <p className="mt-3 text-xs leading-6 text-slate-400">
            Relay and storage controls are available only in the native desktop
            runtime.
          </p>
        ) : null}

        <div className="mt-5 flex items-center justify-between rounded-[24px] border border-white/8 bg-black/20 px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="glass-icon h-10 w-10 rounded-[16px]">
              <ScanSearch className="h-4 w-4 text-sky-200" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Nearby share discovery
              </p>
              <p className="text-[13px] leading-6 text-slate-300/72">
                Automatically find active LAN shares without manually exchanging
                a code first.
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              void setLocalDiscoveryEnabled(
                !(settings?.local_discovery_enabled ?? true),
              )
            }
            disabled={!desktopRuntime}
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-all duration-200 ${
              settings?.local_discovery_enabled ?? true
                ? "border-sky-300/20 bg-sky-500/20"
                : "border-white/10 bg-white/[0.04]"
            } disabled:cursor-not-allowed disabled:opacity-50`}
            aria-pressed={settings?.local_discovery_enabled ?? true}
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={`inline-block h-4 w-4 rounded-full shadow-sm transition-colors ${
                (settings?.local_discovery_enabled ?? true)
                  ? "bg-sky-200"
                  : "bg-slate-300"
              }`}
              style={{
                marginLeft: (settings?.local_discovery_enabled ?? true)
                  ? "22px"
                  : "3px",
              }}
            />
          </button>
        </div>

        <div className="mt-5 grid gap-2 xl:grid-cols-3">
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
              Recommendation
            </p>
            <p className="mt-1.5 text-sm leading-6 text-white">
              Stay on the public relay for general use and early testing.
            </p>
          </div>
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
              Speed note
            </p>
            <p className="mt-1.5 text-sm leading-6 text-white">
              Relay keeps transfers reachable, but it is not the speed path.
            </p>
          </div>
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
              Controlled deployments
            </p>
            <p className="mt-1.5 text-sm leading-6 text-white">
              A custom relay is useful when you want tighter control over the
              connectivity layer.
            </p>
          </div>
        </div>
      </section>

      <section className="glass-panel p-6">
        <div className="flex items-center gap-3">
          <div className="glass-icon">
            <Download className="h-5 w-5 text-sky-200" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Updates</p>
            <p className="text-[13px] text-slate-300/72">
              Signed releases are distributed through GitHub Releases.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Current version
            </p>
            <p className="mt-1.5 text-sm font-semibold tabular-nums text-white">
              {updateState.currentVersion ?? "Unknown"}
            </p>
          </div>
          <div className="stat-card">
            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
              Available version
            </p>
            <p className="mt-1.5 text-sm font-semibold tabular-nums text-white">
              {updateState.availableVersion ?? "None"}
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm text-slate-300/80">
          {updateBusy ? (
            <LoaderCircle className="h-4 w-4 animate-spin text-sky-200" />
          ) : updateState.phase === "restartRequired" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-200" />
          ) : (
            <RefreshCw className="h-4 w-4 text-slate-400" />
          )}
          <span className="text-[13px]">{updateStatusCopy(updateState)}</span>
        </div>

        {updateState.body ? (
          <p className="mt-3 rounded-2xl border border-white/8 bg-white/[0.04] p-4 text-sm leading-6 text-slate-100/88">
            {updateState.body}
          </p>
        ) : null}

        {updateProgressLabel(updateState) ? (
          <p className="mt-2 text-xs tabular-nums text-slate-400">
            {updateProgressLabel(updateState)}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void checkForUpdates()}
            disabled={updateBusy || !desktopRuntime}
            className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-100 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw
              className={`h-4 w-4 ${updateBusy ? "animate-spin" : ""}`}
            />
            Check now
          </button>
          <button
            onClick={() => void installUpdate()}
            disabled={!canInstall || !desktopRuntime}
            className="btn-success"
          >
            <span className="relative inline-flex items-center gap-2">
              <Download className="h-4 w-4" />
              Install update
            </span>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/8 pt-4">
          <div>
            <p className="text-sm font-medium text-white">
              Auto-check on startup
            </p>
            <p className="text-[13px] text-slate-300/72">
              Check GitHub releases when Lightning P2P launches.
            </p>
          </div>
          <button
            onClick={() =>
              void setAutoUpdateEnabled(!settings?.auto_update_enabled)
            }
            disabled={!desktopRuntime}
            className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-all duration-200 ${
              settings?.auto_update_enabled
                ? "border-sky-300/20 bg-sky-500/20"
                : "border-white/10 bg-white/[0.04]"
            } disabled:cursor-not-allowed disabled:opacity-50`}
            aria-pressed={settings?.auto_update_enabled ?? false}
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className={`inline-block h-4 w-4 rounded-full shadow-sm transition-colors ${
                settings?.auto_update_enabled ? "bg-sky-200" : "bg-slate-300"
              }`}
              style={{
                marginLeft: settings?.auto_update_enabled ? "22px" : "3px",
              }}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
