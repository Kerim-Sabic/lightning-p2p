import { motion } from "framer-motion";
import {
  ArrowRight,
  FolderCog,
  HardDriveDownload,
  LoaderCircle,
  Radar,
  Waypoints,
} from "lucide-react";
import { useState } from "react";
import { useTransferStore } from "../stores/transferStore";

function statusLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct route ready";
    case "relay_ready":
      return "Relay route ready";
    case "degraded":
      return "Route still warming";
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
      return "The local node can already advertise direct addresses for the fastest transfers.";
    case "relay_ready":
      return "Relay fallback is online while direct route information keeps warming up.";
    case "degraded":
      return "The node is online, but route discovery has not stabilized yet.";
    case "offline":
      return "Startup failed. You can continue, but open Settings before starting real transfers.";
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
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/72 px-4 backdrop-blur-2xl">
      <motion.section
        initial={{ opacity: 0, y: 20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="glass-panel relative w-full max-w-4xl overflow-hidden p-7"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_34%),radial-gradient(circle_at_90%_15%,rgba(56,189,248,0.08),transparent_30%)]" />
        <div className="relative space-y-5">
          <header className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr] xl:items-start">
            <div className="space-y-3">
              <div className="badge">
                <Waypoints className="h-3.5 w-3.5 text-sky-200" />
                First Run
              </div>
              <div className="space-y-3">
                <h2 className="page-title max-w-[13ch] text-[clamp(2.2rem,2rem+0.9vw,2.8rem)]">
                  Finish setup and keep the fast path available
                </h2>
                <p className="page-copy max-w-2xl text-[15px]">
                  Confirm where verified receives should land, wait for the node
                  to publish route information, and Lightning P2P is ready to
                  move files directly between devices.
                </p>
              </div>
            </div>

            <div className="glass-subtle p-4">
              <p className="metric-label">Route readiness</p>
              <div className="mt-3 flex items-start gap-3">
                <div className="glass-icon h-12 w-12 rounded-2xl">
                  {nodeStatus.online ? (
                    <Radar className="h-5 w-5 text-emerald-200" />
                  ) : (
                    <LoaderCircle className="h-5 w-5 animate-spin text-sky-200" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {statusLabel(nodeStatus.online_state)}
                  </p>
                  <p className="meta-copy mt-1">
                    {statusCopy(nodeStatus.online_state)}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <div className="grid gap-3 xl:grid-cols-2">
            <article className="glass-subtle p-4">
              <div className="flex items-center gap-3">
                <div className="glass-icon">
                  <Waypoints className="h-5 w-5 text-sky-200" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    Node identity
                  </p>
                  <p className="text-[13px] text-slate-300/72">
                    This is the sender identity embedded into your transfer
                    ticket.
                  </p>
                </div>
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

            <article className="glass-subtle p-4">
              <div className="flex items-center gap-3">
                <div className="glass-icon">
                  <HardDriveDownload className="h-5 w-5 text-emerald-200" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    Default receive folder
                  </p>
                  <p className="text-[13px] text-slate-300/72">
                    Verified downloads are exported here.
                  </p>
                </div>
              </div>

              <div className="mt-3 rounded-2xl border border-white/8 bg-black/25 p-4">
                <p className="mb-2 text-[10px] uppercase tracking-[0.3em] text-slate-500">
                  Save location
                </p>
                <p className="break-all font-mono text-[13px] leading-6 text-slate-100/88">
                  {settings.download_dir}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => void pickDownloadDir()}
                  className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-sm text-slate-100"
                >
                  <FolderCog className="h-4 w-4" />
                  Change folder
                </button>
                <button
                  onClick={() => void openDownloadDir()}
                  className="glass-button inline-flex items-center gap-2 px-3.5 py-2 text-sm text-slate-100"
                >
                  <HardDriveDownload className="h-4 w-4" />
                  Open folder
                </button>
              </div>
            </article>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/8 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-slate-300/72">
              You can change storage and relay settings later from the Settings
              view.
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
