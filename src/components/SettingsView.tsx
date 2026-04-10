import {
  CheckCircle2,
  Download,
  Fingerprint,
  FolderCog,
  HardDriveDownload,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import { formatBytes } from "../lib/format";
import { useTransferStore, type UpdateState } from "../stores/transferStore";

function statusPill(online: boolean): string {
  return online
    ? "border-emerald-400/20 bg-emerald-500/12 text-emerald-200"
    : "border-white/10 bg-white/5 text-slate-300";
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
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.32em] text-slate-400">
          <Sparkles className="h-3 w-3 text-sky-300" />
          Settings
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Settings
        </h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Node identity, download folder, and update management.
        </p>
      </header>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <Fingerprint className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Node identity</p>
              <p className="text-xs text-slate-400">
                The node id shown here is what peers connect to.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <span
              className={`rounded-full border px-3 py-1 text-xs ${statusPill(nodeStatus.online)}`}
            >
              {nodeStatus.online ? "Online" : "Starting"}
            </span>
            <span className="text-xs text-slate-500">
              {nodeStatus.online
                ? "Ready to send and receive"
                : "Waiting for iroh"}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
              NodeId
            </p>
            <p className="break-all font-mono text-sm text-slate-200">
              {nodeStatus.node_id ?? "Initializing node..."}
            </p>
          </div>
        </article>

        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <HardDriveDownload className="h-5 w-5 text-emerald-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Download directory
              </p>
              <p className="text-xs text-slate-400">
                Incoming transfers land here after verification and export.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
              Save location
            </p>
            <p className="break-all font-mono text-sm text-slate-200">
              {downloadDir ?? "Resolving download directory..."}
            </p>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => void pickDownloadDir()}
              className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-100"
            >
              <FolderCog className="h-4 w-4" />
              Change folder
            </button>
            <button
              onClick={() => void openDownloadDir()}
              className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-100"
            >
              <HardDriveDownload className="h-4 w-4" />
              Open folder
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div>
              <p className="text-sm font-medium text-white">
                Startup update checks
              </p>
              <p className="text-xs text-slate-400">
                Check GitHub releases automatically when the app launches.
              </p>
            </div>
            <button
              onClick={() =>
                void setAutoUpdateEnabled(!settings?.auto_update_enabled)
              }
              className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-colors ${
                settings?.auto_update_enabled
                  ? "border-sky-400/35 bg-sky-500/20"
                  : "border-white/10 bg-white/5"
              }`}
              aria-pressed={settings?.auto_update_enabled ?? false}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${
                  settings?.auto_update_enabled
                    ? "translate-x-6"
                    : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <Download className="h-5 w-5 text-sky-300" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Updates</p>
              <p className="text-xs text-slate-400">
                Signed releases are delivered through GitHub Releases.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="glass-subtle p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Current version
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {updateState.currentVersion ?? "Unknown"}
              </p>
            </div>
            <div className="glass-subtle p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Available version
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {updateState.availableVersion ?? "None"}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="flex items-start gap-3">
              <div className="glass-icon mt-0.5">
                {updateBusy ? (
                  <LoaderCircle className="h-4 w-4 animate-spin text-sky-300" />
                ) : updateState.phase === "restartRequired" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                ) : (
                  <RefreshCw className="h-4 w-4 text-slate-300" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-white">Update status</p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  {updateStatusCopy(updateState)}
                </p>
                {updateState.body ? (
                  <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">
                    {updateState.body}
                  </p>
                ) : null}
                {updateProgressLabel(updateState) ? (
                  <p className="mt-3 text-xs uppercase tracking-[0.28em] text-slate-500">
                    {updateProgressLabel(updateState)}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => void checkForUpdates()}
              disabled={updateBusy}
              className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-100 disabled:cursor-wait disabled:opacity-70"
            >
              <RefreshCw
                className={`h-4 w-4 ${updateBusy ? "animate-spin" : ""}`}
              />
              Check for updates
            </button>
            <button
              onClick={() => void installUpdate()}
              disabled={!canInstall}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-50 shadow-[0_18px_50px_rgba(34,197,94,0.16)] transition-all hover:border-emerald-300/35 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download className="h-4 w-4" />
              Install update
            </button>
          </div>
        </article>

        <article className="glass-panel p-6">
          <div className="flex items-center gap-3">
            <div className="glass-icon">
              <ShieldCheck className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                Transfer guarantees
              </p>
              <p className="text-xs text-slate-400">
                Verified transfers, persistent history, and native packaged-app
                defaults.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="glass-subtle p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Network
              </p>
              <p className="mt-2 text-sm text-slate-200">
                iroh QUIC transport only
              </p>
            </div>
            <div className="glass-subtle p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Integrity
              </p>
              <p className="mt-2 text-sm text-slate-200">
                BLAKE3-verified blob streaming
              </p>
            </div>
            <div className="glass-subtle p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                First run
              </p>
              <p className="mt-2 text-sm text-slate-200">
                {settings?.first_run_complete
                  ? "Setup completed"
                  : "Setup pending"}
              </p>
            </div>
            <div className="glass-subtle p-4">
              <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
                Transport
              </p>
              <div className="mt-2 flex items-center gap-2 text-sm text-slate-200">
                <Wifi className="h-4 w-4 text-emerald-300" />
                Relay fallback and direct peer connectivity
              </div>
            </div>
          </div>
        </article>
      </section>

      {error ? (
        <div className="glass-panel border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
