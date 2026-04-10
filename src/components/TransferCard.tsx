import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  StopCircle,
  TimerReset,
} from "lucide-react";
import {
  formatBytes,
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
        ? "Hashing content"
        : "Connecting to peer";
    case "running":
      return transfer.direction === "send"
        ? "Preparing share"
        : "Streaming to disk";
    case "completed":
      return transfer.direction === "send" ? "Ticket ready" : "Saved locally";
    case "failed":
      return "Transfer failed";
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

function AnimatedMetric({ label, value }: StatProps) {
  return (
    <div className="glass-subtle px-3.5 py-3">
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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="glass-panel relative overflow-hidden p-4"
    >
      <div className="relative flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-slate-300">
                {transfer.direction}
              </span>
              <StatusIcon className="h-3.5 w-3.5 text-sky-300" />
              <span className="text-xs text-slate-400">
                {statusLabel(transfer)}
              </span>
            </div>

            <p className="mt-2 truncate text-base font-medium text-white">
              {transfer.name}
            </p>
          </div>

          {isActive && onCancel ? (
            <button
              onClick={handleCancel}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/18"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold tabular-nums text-white">
              {hasTotal
                ? `${percent.toFixed(percent > 99 ? 0 : 1)}%`
                : "Preparing"}
            </span>
            <span className="tabular-nums text-slate-400">
              {formatBytes(transfer.bytes)}
              {hasTotal ? ` / ${formatBytes(transfer.total)}` : ""}
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.08]">
            <div
              style={{ width: hasTotal ? `${percent}%` : "34%" }}
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-[width] duration-150 ease-linear ${accentClasses(transfer)}`}
            />
          </div>
        </div>

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
            label="Status"
            value={
              transfer.status === "completed"
                ? "Done"
                : transfer.status === "failed"
                  ? "Error"
                  : "Live"
            }
          />
        </div>

        <AnimatePresence>
          {transfer.error ? (
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200"
            >
              {transfer.error}
            </motion.p>
          ) : null}
        </AnimatePresence>

        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span className="truncate font-mono">
            {transfer.hash ?? transfer.transferId}
          </span>
          {timestamp ? <span className="shrink-0 ml-3">{timestamp}</span> : null}
        </div>
      </div>
    </motion.article>
  );
}
