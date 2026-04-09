import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  Pause,
  StopCircle,
  TimerReset,
} from "lucide-react";
import { formatBytes, formatEta, formatSpeed, formatTimestamp } from "../lib/format";
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
      return transfer.direction === "send" ? "Hashing content" : "Connecting to peer";
    case "running":
      return transfer.direction === "send" ? "Preparing share" : "Streaming to disk";
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
    <div className="glass-subtle p-3">
      <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{label}</p>
      <div className="mt-2 min-h-6 text-sm font-medium text-white">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={`${label}-${value}`}
            initial={{ opacity: 0, y: 10, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -8, filter: "blur(4px)" }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="inline-block"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function TransferCard({ transfer, onCancel }: TransferCardProps) {
  const hasTotal = transfer.total > 0;
  const percent = hasTotal ? Math.min((transfer.bytes / transfer.total) * 100, 100) : 0;
  const timestamp = formatTimestamp(transfer.timestamp);
  const isActive = transfer.status === "starting" || transfer.status === "running";
  const StatusIcon = statusIcon(transfer);

  const handleCancel = (): void => {
    if (!onCancel) {
      return;
    }

    if (window.confirm("Cancel this transfer? Partially downloaded data will stay local.")) {
      onCancel(transfer.transferId);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 16, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.985 }}
      transition={{ type: "spring", stiffness: 280, damping: 24 }}
      className="glass-panel relative overflow-hidden p-5"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.1),transparent_28%)]" />

      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300">
                {transfer.direction}
              </span>
              <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                <StatusIcon className="h-3.5 w-3.5 text-sky-300" />
                {statusLabel(transfer)}
              </span>
            </div>

            <p className="mt-3 truncate text-lg font-medium text-white">{transfer.name}</p>
            {transfer.peer ? (
              <p className="mt-2 break-all font-mono text-[11px] text-slate-500">
                {transfer.peer}
              </p>
            ) : null}
          </div>

          {isActive && onCancel ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                disabled
                title="Pause requires resume support in the transfer backend."
                className="glass-button inline-flex cursor-not-allowed items-center gap-2 px-4 py-2 text-sm text-slate-400 opacity-60"
              >
                <Pause className="h-4 w-4" />
                Pause
              </button>
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-2 rounded-xl border border-red-400/20 bg-red-500/12 px-4 py-2 text-sm font-medium text-red-100 transition-colors hover:bg-red-500/18"
              >
                <StopCircle className="h-4 w-4" />
                Cancel
              </button>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <div className="relative h-3 overflow-hidden rounded-full bg-white/[0.08]">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: hasTotal ? `${percent}%` : "34%" }}
              transition={{ duration: 0.24, ease: "easeOut" }}
              className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${accentClasses(transfer)} shadow-[0_0_30px_rgba(59,130,246,0.35)]`}
            />
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.22),transparent)] opacity-40" />
          </div>
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>{hasTotal ? `${percent.toFixed(percent > 99 ? 0 : 1)}%` : "Preparing"}</span>
            <span>{statusLabel(transfer)}</span>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AnimatedMetric
            label="Transferred"
            value={`${formatBytes(transfer.bytes)} / ${
              hasTotal ? formatBytes(transfer.total) : "Calculating"
            }`}
          />
          <AnimatedMetric label="Speed" value={formatSpeed(transfer.speedBps)} />
          <AnimatedMetric
            label="ETA"
            value={hasTotal ? formatEta(transfer.bytes, transfer.total, transfer.speedBps) : "--"}
          />
          <AnimatedMetric
            label="Status"
            value={transfer.status === "completed" ? "Done" : transfer.status === "failed" ? "Error" : "Live"}
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

        <div className="flex flex-col gap-2 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span className="break-all font-mono">{transfer.hash ?? transfer.transferId}</span>
          {timestamp ? <span>{timestamp}</span> : null}
        </div>
      </div>
    </motion.article>
  );
}
