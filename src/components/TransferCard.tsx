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

function statusLabel(transfer: TransferEntry): string {
  if (transfer.phase === "cancelled") {
    return "Cancelled";
  }
  switch (transfer.status) {
    case "starting":
      return transfer.direction === "send" ? "Preparing share" : "Connecting";
    case "running":
      if (transfer.phase === "connecting") {
        return "Connecting";
      }
      if (transfer.phase === "verifying") {
        return "Verifying and saving";
      }
      return transfer.direction === "send" ? "Importing content" : "Receiving";
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
      return "Unknown";
  }
}

function routeTone(routeKind: TransferEntry["routeKind"]): string {
  switch (routeKind) {
    case "direct":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
    case "relay":
      return "border-sky-400/20 bg-sky-500/10 text-sky-100";
    case "unknown":
    default:
      return "border-white/[0.08] bg-white/[0.04] text-slate-300";
  }
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

function failureHelp(transfer: TransferEntry): string | null {
  switch (transfer.failureCategory) {
    case "cancelled":
      return "The transfer was cancelled before completion. Start it again when both devices are ready.";
    case "unreachable":
      return "The sender could not be reached. Confirm both apps are open and try again.";
    case "interrupted":
      return "The transfer started, then stopped. Retry after checking network or sender sleep settings.";
    case "destination":
      return "Choose a writable download folder in Settings, then retry.";
    case "disk_space":
      return "Free space in the download folder, then retry.";
    case "export":
      return "The verified download finished, but saving to disk failed.";
    case "invalid_ticket":
    case "unknown":
    case null:
      return null;
  }
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
    <article className="glass-panel p-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                {transfer.direction}
              </span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${routeTone(
                  transfer.routeKind,
                )}`}
              >
                Route {routeLabel(transfer.routeKind)}
              </span>
              <StatusIcon className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-400">{statusLabel(transfer)}</span>
            </div>
            <p className="mt-2 truncate text-base font-semibold tracking-[-0.02em] text-white">
              {transfer.name}
            </p>
          </div>

          {isActive && onCancel ? (
            <button
              onClick={handleCancel}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-rose-400/15 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100/85"
            >
              <StopCircle className="h-3.5 w-3.5" />
              Cancel
            </button>
          ) : null}
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-xs">
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
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(56,189,248,0.95),rgba(16,185,129,0.9))]"
              style={{
                width: hasTotal ? `${percent}%` : "24%",
              }}
            />
          </div>
        </div>

        <div className="grid gap-3 text-sm text-slate-300/78 md:grid-cols-3">
          <div className="stat-card">
            <p className="metric-label">Speed</p>
            <p className="mt-1.5 font-semibold text-white">
              {formatSpeed(transfer.speedBps)}
            </p>
          </div>
          <div className="stat-card">
            <p className="metric-label">ETA</p>
            <p className="mt-1.5 font-semibold text-white">
              {hasTotal
                ? formatEta(transfer.bytes, transfer.total, transfer.speedBps)
                : "--"}
            </p>
          </div>
          <div className="stat-card">
            <p className="metric-label">Route</p>
            <p className="mt-1.5 font-semibold text-white">
              {routeLabel(transfer.routeKind)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>Connect {formatDurationMs(transfer.connectMs)}</span>
          <span>Download {formatDurationMs(transfer.downloadMs)}</span>
          <span>Export {formatDurationMs(transfer.exportMs)}</span>
        </div>

        {transfer.error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <p>{transfer.error}</p>
            {failureHelp(transfer) ? (
              <p className="mt-2 text-xs leading-5 text-rose-100/72">
                {failureHelp(transfer)}
              </p>
            ) : null}
          </div>
        ) : null}

        {transfer.outputPath && transfer.status === "completed" ? (
          <div className="rounded-2xl border border-emerald-400/15 bg-emerald-500/8 px-4 py-3">
            <p className="metric-label">Saved to</p>
            <p className="mt-1.5 break-all font-mono text-xs leading-5 text-emerald-50/86">
              {transfer.outputPath}
            </p>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500">
          <span className="truncate font-mono">
            {transfer.hash ?? transfer.transferId}
          </span>
          {timestamp ? <span className="shrink-0">{timestamp}</span> : null}
        </div>
      </div>
    </article>
  );
}
