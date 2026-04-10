import { motion } from "framer-motion";
import {
  ArrowRight,
  FolderCog,
  HardDriveDownload,
  LoaderCircle,
  Wifi,
} from "lucide-react";
import { useState } from "react";
import { useTransferStore } from "../stores/transferStore";

function statusLabel(online: boolean): string {
  return online ? "Node online" : "Booting node";
}

function statusCopy(online: boolean): string {
  return online
    ? "FastDrop is ready to send and receive directly."
    : "The iroh endpoint is starting in the background.";
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
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-black/55 px-4 backdrop-blur-xl">
      <motion.section
        initial={{ opacity: 0, y: 16, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
        className="glass-panel relative w-full max-w-2xl overflow-hidden p-7"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.18),transparent_42%)] opacity-80" />
        <div className="relative space-y-6">
          <header className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.32em] text-slate-400">
              <Wifi className="h-3.5 w-3.5 text-sky-300" />
              First Run
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                FastDrop is almost ready
              </h2>
              <p className="text-sm leading-6 text-slate-400">
                Confirm where verified receives should land, wait for the local
                node to come online, and the packaged app is ready for daily
                use.
              </p>
            </div>
          </header>

          <div className="grid gap-4 md:grid-cols-2">
            <article className="glass-subtle p-4">
              <div className="flex items-center gap-3">
                <div className="glass-icon">
                  {nodeStatus.online ? (
                    <Wifi className="h-5 w-5 text-emerald-300" />
                  ) : (
                    <LoaderCircle className="h-5 w-5 animate-spin text-sky-300" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    {statusLabel(nodeStatus.online)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {statusCopy(nodeStatus.online)}
                  </p>
                </div>
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

            <article className="glass-subtle p-4">
              <div className="flex items-center gap-3">
                <div className="glass-icon">
                  <HardDriveDownload className="h-5 w-5 text-emerald-300" />
                </div>
                <div>
                  <p className="text-sm font-medium text-white">
                    Default receive folder
                  </p>
                  <p className="text-xs text-slate-400">
                    Verified downloads are exported here by default.
                  </p>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-black/30 p-4">
                <p className="mb-2 text-[11px] uppercase tracking-[0.28em] text-slate-500">
                  Save location
                </p>
                <p className="break-all font-mono text-sm text-slate-200">
                  {settings.download_dir}
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
            </article>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">
              You can change these settings later from the Settings view.
            </p>
            <button
              onClick={() => void handleContinue()}
              disabled={isSaving}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-400/20 bg-sky-500/15 px-5 py-3 text-sm font-medium text-sky-50 shadow-[0_18px_50px_rgba(59,130,246,0.22)] transition-all hover:border-sky-300/35 hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-70"
            >
              {isSaving ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              Continue
            </button>
          </div>
        </div>
      </motion.section>
    </div>
  );
}
