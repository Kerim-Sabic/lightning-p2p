import { motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  Fingerprint,
  FolderCog,
  HardDriveDownload,
  LoaderCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { formatBytes } from "../lib/format";
import { useTransferStore, type UpdateState } from "../stores/transferStore";

function statusPill(online: boolean): string {
  return online
    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
    : "border-white/[0.08] bg-white/[0.04] text-slate-400";
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
      return "Update installed. Restart FastDrop to launch the new build.";
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
    return `${formatBytes(updateState.downloadedBytes)} / ${formatBytes(updateState.totalBytes)}`;
  }

  return `${formatBytes(updateState.downloadedBytes)} downloaded`;
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
  const checkForUpdates = useTransferStore((state) => state.checkForUpdates);
  const installUpdate = useTransferStore((state) => state.installUpdate);

  const updateBusy =
    updateState.phase === "checking" || updateState.phase === "downloading";
  const canInstall = updateState.phase === "available";

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="badge">
          <Settings2 className="h-3 w-3 text-slate-300" />
          Settings
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Settings
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-slate-400">
          Node identity, download folder, and update management.
        </p>
      </header>

      {/* Node + Download dir cards */}
      <section className="grid gap-3 lg:grid-cols-2">
        {/* Node identity */}
        <article className="glass-panel p-5">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <Fingerprint className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Node identity</p>
              <p className="text-[13px] text-slate-500">
                Peers connect to this node id.
              </p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <span
              className={`rounded-lg border px-3 py-1 text-xs ${statusPill(nodeStatus.online)}`}
            >
              {nodeStatus.online ? "Online" : "Starting"}
            </span>
            <span className="text-xs text-slate-500">
              {nodeStatus.online
                ? "Ready to send and receive"
                : "Waiting for iroh"}
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
        </article>

        {/* Download directory */}
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
                Incoming transfers land here after verification.
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

      {/* Updates */}
      <section className="glass-panel p-5">
        <div className="flex items-center gap-3">
          <div className="glass-icon">
            <Download className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Updates</p>
            <p className="text-[13px] text-slate-500">
              Signed releases delivered through GitHub Releases.
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
              Check GitHub releases when the app launches.
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

      {/* Error */}
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
