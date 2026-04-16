import { motion } from "framer-motion";
import {
  ArrowUpRight,
  FolderSymlink,
  Radar,
  RefreshCw,
} from "lucide-react";
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
      className="status-strip"
    >
      <article className="status-strip-segment">
        <div className="status-strip-icon">
          <Radar className="h-4 w-4 text-sky-200/85" />
        </div>
        <div className="min-w-0">
          <p className="metric-label">
            Network
          </p>
          <p className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-white">
            {networkHeadline(overview.nodeStatus.online_state)}
          </p>
          <p className="mt-1 text-[13px] text-slate-400">
            {overview.nodeStatus.direct_address_count} direct addresses
          </p>
        </div>
      </article>

      <article className="status-strip-segment">
        <div className="status-strip-icon">
          <ArrowUpRight className="h-4 w-4 text-sky-200/85" />
        </div>
        <div className="min-w-0">
          <p className="metric-label">
            Throughput
          </p>
          <p className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-white">
            {formatSpeed(overview.combinedSpeedBps)}
          </p>
          <p className="mt-1 text-[13px] text-slate-400">
            {overview.activeTransferCount} live transfer
            {overview.activeTransferCount === 1 ? "" : "s"}
          </p>
        </div>
      </article>

      <article className="status-strip-segment">
        <div className="status-strip-icon">
          <FolderSymlink className="h-4 w-4 text-slate-200/85" />
        </div>
        <div className="min-w-0">
          <p className="metric-label">
            Receive folder
          </p>
          <p className="mt-1 truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
            {pathTail(overview.downloadDir)}
          </p>
          <p className="mt-1 truncate text-[13px] text-slate-400">
            {overview.latestTransfer?.name ?? "Ready for next transfer"}
          </p>
        </div>
      </article>

      <article className="status-strip-segment">
        <div className="status-strip-icon">
          <RefreshCw className="h-4 w-4 text-slate-200/85" />
        </div>
        <div className="min-w-0">
          <p className="metric-label">
            Updates
          </p>
          <p className="mt-1 text-[15px] font-semibold tracking-[-0.02em] text-white">
            {updateCopy(overview.updatePhase)}
          </p>
          <p className="mt-1 text-[13px] text-slate-400">
            Startup checks stay optional
          </p>
        </div>
      </article>
    </motion.section>
  );
}
