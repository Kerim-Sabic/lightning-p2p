import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  StopCircle,
  TimerReset,
} from "lucide-react";
import {
  formatBytes,
  formatDurationMs,
  formatEta,
  formatSpeed,
  formatTimestamp,
} from "../lib/format";
import type { TransferEntry } from "../stores/transferStore";

interface TransferCardProps {
  transfer: TransferEntry;
  onCancel?: (transferId: string) => void;
}

interface StatProps {
  label: string;
  value: string;
}

function statusLabel(transfer: TransferEntry): string {
  switch (transfer.status) {
    case "starting":
      return transfer.direction === "send"
        ? "Preparing share ticket"
        : "Connecting to peer";
    case "running":
      return transfer.direction === "send"
        ? "Importing content"
        : "Streaming verified data";
    case "completed":
      return transfer.direction === "send" ? "Ticket ready" : "Saved locally";
    case "failed":
      return "Transfer failed";
  }
}

function routeLabel(routeKind: TransferEntry["routeKind"]): string {
  switch (routeKind) {
    case "direct":
      return "Direct";
    case "relay":
      return "Relay";
    case "unknown":
    default:
      return "Detecting";
  }
}

function accentClasses(transfer: TransferEntry): string {
  if (transfer.status === "completed") {
    return "from-emerald-400 via-emerald-500 to-sky-400";
  }
  if (transfer.status === "failed") {
    return "from-red-400 via-red-500 to-orange-400";
  }
  return transfer.direction === "send"
    ? "from-sky-400 via-blue-500 to-violet-500"
    : "from-emerald-400 via-sky-500 to-blue-500";
}

function statusIcon(transfer: TransferEntry) {
  if (transfer.status === "completed") {
    return CheckCircle2;
  }
  if (transfer.status === "failed") {
    return TimerReset;
  }
  return ArrowUpRight;
}

function StatusBadge({ transfer }: { transfer: TransferEntry }) {
  const color =
    transfer.status === "completed"
      ? "text-emerald-100 border-emerald-400/15 bg-emerald-500/10"
      : transfer.status === "failed"
        ? "text-rose-100 border-rose-400/15 bg-rose-500/10"
        : "text-sky-100 border-sky-400/15 bg-sky-500/10";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${color}`}
    >
      {transfer.direction}
    </span>
  );
}

function AnimatedMetric({ label, value }: StatProps) {
  return (
    <div className="stat-card">
      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-sm font-semibold tabular-nums text-white">
        {value}
      </p>
    </div>
  );
}

export function TransferCard({ transfer, onCancel }: TransferCardProps) {
  const hasTotal = transfer.total > 0;
  const percent = hasTotal
    ? Math.min((transfer.bytes / transfer.total) * 100, 100)
    : 0;
  const timestamp = formatTimestamp(transfer.timestamp);
  const isActive =
    transfer.status === "starting" || transfer.status === "running";
  const StatusIcon = statusIcon(transfer);

  const handleCancel = (): void => {
    if (!onCancel) {
      return;
    }

    if (
      window.confirm(
        "Cancel this transfer? Partially downloaded data will stay local.",
      )
    ) {
      onCancel(transfer.transferId);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-panel relative overflow-hidden p-4"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.05),transparent_28%)]" />
      <div className="relative flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge transfer={transfer} />
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-slate-300/72">
                {routeLabel(transfer.routeKind)}
              </span>
              <StatusIcon className="h-3.5 w-3.5 text-slate-300/60" />
              <span className="text-xs text-slate-300/72">
                {statusLabel(transfer)}
              </span>
            </div>

            <p className="mt-2 truncate text-base font-semibold text-white">
              {transfer.name}
            </p>
          </div>

          {isActive && onCancel ? (
            <button
              onClick={handleCancel}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-2xl border border-rose-400/15 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-100/85 transition-all duration-200 hover:bg-rose-500/16 hover:text-rose-100 active:scale-[0.97]"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          ) : null}
        </div>

        {/* Progress bar */}
        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold tabular-nums text-white">
              {hasTotal
                ? `${percent.toFixed(percent > 99 ? 0 : 1)}%`
                : "Preparing"}
            </span>
            <span className="tabular-nums text-slate-300/70">
              {formatBytes(transfer.bytes)}
              {hasTotal ? ` / ${formatBytes(transfer.total)}` : ""}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: hasTotal ? `${percent}%` : "34%" }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${accentClasses(transfer)}`}
            />
            {isActive ? (
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <div className="shimmer-overlay h-full w-full" />
              </div>
            ) : null}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <AnimatedMetric
            label="Speed"
            value={formatSpeed(transfer.speedBps)}
          />
          <AnimatedMetric
            label="ETA"
            value={
              hasTotal
                ? formatEta(transfer.bytes, transfer.total, transfer.speedBps)
                : "--"
            }
          />
          <AnimatedMetric
            label="Route"
            value={routeLabel(transfer.routeKind)}
          />
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-300/60">
          <span>Connect {formatDurationMs(transfer.connectMs)}</span>
          <span>Download {formatDurationMs(transfer.downloadMs)}</span>
          <span>Export {formatDurationMs(transfer.exportMs)}</span>
        </div>

        {/* Error */}
        <AnimatePresence>
          {transfer.error ? (
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100"
            >
              {transfer.error}
            </motion.p>
          ) : null}
        </AnimatePresence>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-slate-400/60">
          <span className="truncate font-mono">
            {transfer.hash ?? transfer.transferId}
          </span>
          {timestamp ? (
            <span className="ml-3 shrink-0">{timestamp}</span>
          ) : null}
        </div>
      </div>
    </motion.article>
  );
}
