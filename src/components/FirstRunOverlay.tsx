import { motion } from "framer-motion";
import {
  ArrowRight,
  FolderCog,
  HardDriveDownload,
  LoaderCircle,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { useTransferStore } from "../stores/transferStore";

function statusLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct path ready";
    case "relay_ready":
      return "Relay ready";
    case "degraded":
      return "Node degraded";
    case "offline":
      return "Node offline";
    case "starting":
    default:
      return "Booting node";
  }
}

function statusCopy(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Lightning P2P is ready for direct send and receive traffic.";
    case "relay_ready":
      return "Relay fallback is ready while direct addresses continue warming up.";
    case "degraded":
      return "The node is online, but no route is ready yet.";
    case "offline":
      return "Startup failed. Review settings or restart the app.";
    case "starting":
    default:
      return "The iroh endpoint is starting in the background.";
  }
}

export function FirstRunOverlay() {
  const settings = useTransferStore((state) => state.settings);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const pickDownloadDir = useTransferStore((state) => state.pickDownloadDir);
  const completeFirstRun = useTransferStore((state) => state.completeFirstRun);
  const openDownloadDir = useTransferStore((state) => state.openDownloadDir);
  const [isSaving, setIsSaving] = useState(false);

  if (!settings || settings.first_run_complete) {
    return null;
  }

  const handleContinue = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await completeFirstRun();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/60 px-4 backdrop-blur-2xl">
      <motion.section
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="glass-panel relative w-full max-w-2xl overflow-hidden p-6"
      >
        <div className="relative space-y-5">
          {/* Header */}
          <header className="space-y-3">
            <div className="badge">
              <Waypoints className="h-3.5 w-3.5 text-sky-300" />
              First Run
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Lightning P2P is almost ready
              </h2>
              <p className="text-sm leading-6 text-slate-400">
                Confirm where verified receives should land, wait for the local
                node to come online, and you are ready to go.
              </p>
            </div>
          </header>

          {/* Cards */}
          <div className="grid gap-3 md:grid-cols-2">
            {/* Node status */}
            <article className="glass-subtle p-4">
              <div className="flex items-center gap-3">
                <div className="glass-icon">
                  {nodeStatus.online ? (
                    <Waypoints className="h-5 w-5 text-emerald-300" />
                  ) : (
                    <LoaderCircle className="h-5 w-5 animate-spin text-sky-300" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {statusLabel(nodeStatus.online_state)}
                  </p>
                  <p className="text-[13px] text-slate-500">
                    {statusCopy(nodeStatus.online_state)}
                  </p>
                </div>
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

            {/* Download dir */}
            <article className="glass-subtle p-4">
              <div className="flex items-center gap-3">
                <div className="glass-icon">
                  <HardDriveDownload className="h-5 w-5 text-emerald-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    Default receive folder
                  </p>
                  <p className="text-[13px] text-slate-500">
                    Verified downloads are exported here.
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 p-3.5">
                <p className="mb-1.5 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Save location
                </p>
                <p className="break-all font-mono text-[13px] text-slate-300">
                  {settings.download_dir}
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
          </div>

          {/* Footer */}
          <div className="flex flex-col gap-3 border-t border-white/[0.06] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">
              You can change these settings later from the Settings view.
            </p>
            <button
              onClick={() => void handleContinue()}
              disabled={isSaving}
              className="btn-primary"
            >
              <span className="relative inline-flex items-center gap-2">
                {isSaving ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                Continue
              </span>
            </button>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
