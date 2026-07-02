import {
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  FolderOpen,
  Send,
  Star,
  StopCircle,
  TimerReset,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  formatBytes,
  formatDurationMs,
  formatEta,
  formatSpeed,
  formatTimestamp,
} from "../lib/format";
import {
  collectDiagnosticBundle,
  openExternalUrl,
  writeClipboardText,
} from "../lib/tauri";
import { summarizeTransfer } from "../lib/transferSummary";
import { useTransferStore, type TransferEntry } from "../stores/transferStore";

interface TransferCardProps {
  transfer: TransferEntry;
  onCancel?: (transferId: string) => void;
  onSendAnother?: () => void;
}

const STAR_CTA_DISMISSED_KEY = "lightning-p2p:star-cta-dismissed";
const STAR_CTA_URL = "https://github.com/Kerim-Sabic/lightning-p2p";

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
    case "mixed":
      return "Mixed";
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
    case "mixed":
      return "border-amber-400/25 bg-amber-500/10 text-amber-100";
    case "unknown":
    default:
      return "border-white/[0.08] bg-white/[0.04] text-slate-300";
  }
}

function strategyLabel(strategy: TransferEntry["strategy"]): string {
  switch (strategy) {
    case "queued_multi_provider":
      return "Multi-provider";
    case "queued_single_provider":
      return "Queued";
    case "swarm_parallel":
      return "Swarm";
    case "unknown":
    default:
      return "Pending";
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

function readStarCtaDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(STAR_CTA_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStarCtaDismissed(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STAR_CTA_DISMISSED_KEY, "1");
  } catch {
    // localStorage may be blocked; CTA simply stays available
  }
}

export function TransferCard({
  transfer,
  onCancel,
  onSendAnother,
}: TransferCardProps) {
  const openDownloadDir = useTransferStore((state) => state.openDownloadDir);
  const startReceive = useTransferStore((state) => state.startReceive);
  const [diagnosticsState, setDiagnosticsState] = useState<
    "idle" | "copied" | "error"
  >("idle");
  const [summaryState, setSummaryState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const [folderState, setFolderState] = useState<"idle" | "error">("idle");
  const [retryState, setRetryState] = useState<"idle" | "started" | "error">(
    "idle",
  );
  const [starCtaDismissed, setStarCtaDismissed] = useState<boolean>(() =>
    readStarCtaDismissed(),
  );
  const hasTotal = transfer.total > 0;
  const percent = hasTotal
    ? Math.min((transfer.bytes / transfer.total) * 100, 100)
    : 0;
  const timestamp = formatTimestamp(transfer.timestamp);
  const isActive =
    transfer.status === "starting" || transfer.status === "running";
  const StatusIcon = statusIcon(transfer);
  const errorHint = transfer.appError?.hint ?? failureHelp(transfer);
  const canRetryReceive =
    transfer.status === "failed" &&
    transfer.direction === "receive" &&
    Boolean(transfer.retryTicket) &&
    (transfer.appError?.retryable ?? true);

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

  const handleCopyDiagnostics = async (): Promise<void> => {
    try {
      const bundle = await collectDiagnosticBundle(transfer.transferId);
      await writeClipboardText(bundle.report);
      setDiagnosticsState("copied");
      window.setTimeout(() => setDiagnosticsState("idle"), 1800);
    } catch {
      setDiagnosticsState("error");
      window.setTimeout(() => setDiagnosticsState("idle"), 2200);
    }
  };

  const handleCopySummary = async (): Promise<void> => {
    try {
      await writeClipboardText(summarizeTransfer(transfer));
      setSummaryState("copied");
      window.setTimeout(() => setSummaryState("idle"), 1800);
    } catch {
      setSummaryState("error");
      window.setTimeout(() => setSummaryState("idle"), 2200);
    }
  };

  const handleOpenFolder = async (): Promise<void> => {
    try {
      await openDownloadDir();
    } catch {
      setFolderState("error");
      window.setTimeout(() => setFolderState("idle"), 2200);
    }
  };

  const handleRetryReceive = async (): Promise<void> => {
    if (!transfer.retryTicket) {
      return;
    }

    setRetryState("idle");
    const transferId = await startReceive(transfer.retryTicket);
    setRetryState(transferId ? "started" : "error");
    window.setTimeout(() => setRetryState("idle"), 2200);
  };

  const handleDismissStarCta = (): void => {
    writeStarCtaDismissed();
    setStarCtaDismissed(true);
  };

  const showCompletionActions =
    transfer.status === "completed" && transfer.direction === "receive";
  const showStarCta = showCompletionActions && !starCtaDismissed;

  useEffect(() => {
    if (showCompletionActions) {
      setStarCtaDismissed(readStarCtaDismissed());
    }
  }, [showCompletionActions]);

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
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] ${routeTone(
                  transfer.routeKind,
                )}`}
              >
                {isActive && (
                  <span aria-hidden className="signal-dot !h-1.5 !w-1.5" />
                )}
                Route {routeLabel(transfer.routeKind)}
              </span>
              <StatusIcon className="h-3.5 w-3.5 text-slate-400" />
              <span className="text-xs text-slate-400">
                {statusLabel(transfer)}
              </span>
            </div>
            <p className="mt-2 truncate text-base font-semibold tracking-[-0.02em] text-white">
              {transfer.name}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <button
              onClick={() => void handleCopyDiagnostics()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-slate-100/85"
            >
              {diagnosticsState === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5 text-emerald-200" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {diagnosticsState === "copied"
                ? "Copied"
                : diagnosticsState === "error"
                  ? "Copy failed"
                  : "Diagnostics"}
            </button>

            {isActive && onCancel ? (
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-400/15 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-100/85"
              >
                <StopCircle className="h-3.5 w-3.5" />
                Cancel
              </button>
            ) : null}
          </div>
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
          <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,rgba(56,189,248,0.95),rgba(16,185,129,0.9))] transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{
                width: hasTotal ? `${percent}%` : "24%",
              }}
            />
            {isActive && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
              >
                <span className="absolute inset-y-0 left-0 w-1/3 -translate-x-full skew-x-[-18deg] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.32),transparent)] [animation:shimmer_1.6s_ease-in-out_infinite]" />
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-3 text-sm text-slate-300/78 sm:grid-cols-2 lg:grid-cols-4">
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
          <div className="stat-card">
            <p className="metric-label">Providers</p>
            <p className="mt-1.5 font-semibold text-white">
              {transfer.providerCount > 0 ? transfer.providerCount : "--"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span>Connect {formatDurationMs(transfer.connectMs)}</span>
          <span>First byte {formatDurationMs(transfer.firstByteMs)}</span>
          <span>Download {formatDurationMs(transfer.downloadMs)}</span>
          <span>Export {formatDurationMs(transfer.exportMs)}</span>
          <span>Strategy {strategyLabel(transfer.strategy)}</span>
          <span>
            Effective{" "}
            {transfer.effectiveMbps > 0
              ? `${transfer.effectiveMbps} Mbps`
              : "--"}
          </span>
        </div>

        {transfer.error ? (
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">
                  {transfer.appError?.title ?? "Transfer failed"}
                </p>
                <p className="mt-1">{transfer.error}</p>
              </div>
            </div>
            {errorHint ? (
              <p className="mt-2 text-xs leading-5 text-rose-100/72">
                {errorHint}
              </p>
            ) : null}
            {transfer.direction === "receive" &&
            (transfer.appError?.retryable ?? true) ? (
              <p className="mt-2 text-[11px] leading-5 text-rose-100/60">
                Tip: retrying uses the same in-memory ticket for this app
                session. Verified chunks already on disk are skipped
                automatically.
              </p>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              {canRetryReceive ? (
                <button
                  type="button"
                  onClick={() => void handleRetryReceive()}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200/20 bg-rose-100/10 px-2 py-1 font-semibold text-rose-50 transition hover:bg-rose-100/16"
                >
                  <TimerReset className="h-3.5 w-3.5" />
                  {retryState === "started"
                    ? "Retry started"
                    : retryState === "error"
                      ? "Retry failed"
                      : "Retry receive"}
                </button>
              ) : null}
              {transfer.appError ? (
                <span className="rounded-full border border-rose-300/15 bg-rose-300/10 px-2 py-1 font-medium text-rose-50/80">
                  {transfer.appError.retryable
                    ? "Retry may help"
                    : "Needs new input"}
                </span>
              ) : null}
              {transfer.appError?.helpUrl ? (
                <a
                  href={transfer.appError.helpUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-rose-50 underline decoration-current/30 underline-offset-4"
                >
                  Help docs
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </div>
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

        {showCompletionActions ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void handleOpenFolder()}
              className="glass-button inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-100"
            >
              <FolderOpen className="h-3.5 w-3.5 text-emerald-200" />
              {folderState === "error" ? "Open failed" : "Open download folder"}
            </button>
            {onSendAnother ? (
              <button
                onClick={onSendAnother}
                className="glass-button inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-100"
              >
                <Send className="h-3.5 w-3.5 text-sky-200" />
                Send another file
              </button>
            ) : null}
            <button
              onClick={() => void handleCopySummary()}
              className="glass-button inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-slate-100"
            >
              {summaryState === "copied" ? (
                <ClipboardCheck className="h-3.5 w-3.5 text-emerald-200" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {summaryState === "copied"
                ? "Summary copied"
                : summaryState === "error"
                  ? "Copy failed"
                  : "Copy transfer summary"}
            </button>
          </div>
        ) : null}

        {showStarCta ? (
          <p className="text-[11px] leading-5 text-slate-400">
            <Star className="mr-1 inline h-3 w-3 align-[-1px] text-amber-200" />
            Nice transfer. If Lightning P2P saved you a cloud upload,{" "}
            <a
              href={STAR_CTA_URL}
              onClick={(event) => {
                event.preventDefault();
                handleDismissStarCta();
                void openExternalUrl(STAR_CTA_URL);
              }}
              className="font-semibold text-slate-200 underline decoration-slate-400 underline-offset-4 hover:text-white"
            >
              star it on GitHub
            </a>
            .{" "}
            <button
              onClick={handleDismissStarCta}
              className="text-slate-500 underline decoration-slate-600 underline-offset-4 hover:text-slate-300"
            >
              Don't show again
            </button>
          </p>
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
