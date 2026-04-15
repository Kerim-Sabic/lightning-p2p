import { motion } from "framer-motion";
import { ArrowUpRight, FolderSymlink, Radar, RefreshCw } from "lucide-react";
import { formatSpeed } from "../lib/format";
import { useOverviewSnapshot } from "../stores/transferSelectors";

function pathTail(path: string | null): string {
  if (!path) {
    return "Resolving folder";
  }

  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function networkHeadline(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay-assisted";
    case "degraded":
      return "Routes warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Booting";
  }
}

function updateCopy(phase: string): string {
  switch (phase) {
    case "available":
      return "Update ready";
    case "checking":
      return "Checking";
    case "downloading":
      return "Updating";
    case "restartRequired":
      return "Restart required";
    case "error":
      return "Check failed";
    case "upToDate":
      return "Current";
    case "idle":
    default:
      return "Standby";
  }
}

export function AppOverview() {
  const overview = useOverviewSnapshot();

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel grid gap-3 p-4 lg:grid-cols-4"
    >
      <article className="stat-card flex items-start gap-3">
        <div className="glass-icon h-11 w-11 shrink-0 rounded-2xl">
          <Radar className="h-4 w-4 text-sky-200" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Network
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {networkHeadline(overview.nodeStatus.online_state)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {overview.nodeStatus.direct_address_count} direct addresses
          </p>
        </div>
      </article>

      <article className="stat-card flex items-start gap-3">
        <div className="glass-icon h-11 w-11 shrink-0 rounded-2xl">
          <ArrowUpRight className="h-4 w-4 text-emerald-200" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Throughput
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {formatSpeed(overview.combinedSpeedBps)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {overview.activeTransferCount} live transfer
            {overview.activeTransferCount === 1 ? "" : "s"}
          </p>
        </div>
      </article>

      <article className="stat-card flex items-start gap-3">
        <div className="glass-icon h-11 w-11 shrink-0 rounded-2xl">
          <FolderSymlink className="h-4 w-4 text-sky-200" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Receive folder
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-white">
            {pathTail(overview.downloadDir)}
          </p>
          <p className="mt-1 truncate text-xs text-slate-400">
            {overview.latestTransfer?.name ?? "Ready for next transfer"}
          </p>
        </div>
      </article>

      <article className="stat-card flex items-start gap-3">
        <div className="glass-icon h-11 w-11 shrink-0 rounded-2xl">
          <RefreshCw className="h-4 w-4 text-violet-200" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
            Updates
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {updateCopy(overview.updatePhase)}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Startup checks stay optional
          </p>
        </div>
      </article>
    </motion.section>
  );
}
