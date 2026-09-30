import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { formatBytes, formatSpeed } from "../lib/format";
import { safeDisplayText } from "../lib/safeDisplayText";
import { useTransferStore, type TransferEntry } from "../stores/transferStore";

interface TransferTrayProps {
  mobileRuntime: boolean;
  onNavigateActivity: () => void;
}

function isOngoing(transfer: TransferEntry): boolean {
  return (
    transfer.status === "starting" ||
    transfer.status === "running" ||
    transfer.status === "paused"
  );
}

function phaseLabel(transfer: TransferEntry): string {
  if (transfer.status === "paused") return "Paused";
  switch (transfer.phase) {
    case "preparing":
      return "Preparing";
    case "connecting":
      return "Connecting";
    case "retrying":
      return "Reconnecting";
    case "downloading":
      return transfer.direction === "receive" ? "Receiving" : "Sending";
    case "verifying":
      return "Verifying";
    case "saving":
      return "Saving";
    case "paused":
      return "Paused";
    case "completed":
      return "Complete";
    case "failed":
      return "Needs attention";
    case "cancelled":
      return "Cancelled";
    default:
      return transfer.direction === "receive" ? "Receiving" : "Preparing";
  }
}

function TransferRow({ transfer }: { transfer: TransferEntry }) {
  const name = safeDisplayText(transfer.name, "File transfer");
  const progress =
    transfer.total > 0
      ? Math.min(100, Math.max(0, (transfer.bytes / transfer.total) * 100))
      : null;
  const Icon =
    transfer.direction === "receive" ? ArrowDownToLine : ArrowUpFromLine;
  const status = phaseLabel(transfer);

  return (
    <li className="min-w-0 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <Icon
          className="h-4 w-4 shrink-0 text-[var(--accent-primary)]"
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--fg-primary)]">
          {name}
        </p>
        <span className="shrink-0 text-xs text-[var(--fg-muted)]">{status}</span>
      </div>
      {progress === null ? (
        <p className="ml-[26px] mt-1 text-xs text-[var(--fg-muted)]">
          {formatBytes(transfer.bytes)}
        </p>
      ) : (
        <div className="ml-[26px] mt-1.5 flex items-center gap-2">
          <div
            className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/10"
            role="progressbar"
            aria-label={`${name} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.floor(progress)}
          >
            <div
              className="h-full rounded-full bg-[var(--accent-primary)]"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 text-xs tabular-nums text-[var(--fg-muted)]">
            {formatBytes(transfer.bytes)} / {formatBytes(transfer.total)}
          </span>
          {transfer.speedBps > 0 ? (
            <span className="hidden shrink-0 text-xs tabular-nums text-[var(--fg-muted)] sm:inline">
              {formatSpeed(transfer.speedBps)}
            </span>
          ) : null}
        </div>
      )}
    </li>
  );
}

export function TransferTray({
  mobileRuntime,
  onNavigateActivity,
}: TransferTrayProps) {
  const [expanded, setExpanded] = useState(false);
  const transfersById = useTransferStore((state) => state.transfers);
  const transfers = Object.values(transfersById).filter(isOngoing);
  if (transfers.length === 0) return null;

  const visibleTransfers = expanded ? transfers : transfers.slice(0, 1);

  return (
    <aside
      aria-label="Transfers"
      className={`fixed z-40 ${
        mobileRuntime
          ? "inset-x-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))]"
          : "bottom-4 left-[244px] right-4"
      }`}
    >
      <div className="mx-auto max-w-[1040px] rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-2.5 shadow-[0_12px_36px_rgba(0,0,0,0.22)]">
        <div className="flex items-center gap-2 px-1 pb-2">
          <p className="min-w-0 flex-1 text-sm font-semibold text-[var(--fg-primary)]">
            {transfers.length} transfer{transfers.length === 1 ? "" : "s"}
          </p>
          {transfers.length > 1 ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[var(--fg-muted)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] dark:hover:bg-white/5"
            >
              {expanded ? "Show less" : `Show all ${transfers.length}`}
              {expanded ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onNavigateActivity}
            className="min-h-11 rounded-lg px-2 text-sm font-semibold text-[var(--accent-primary)] hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] dark:hover:bg-white/5"
          >
            Activity
          </button>
        </div>
        <ul className="grid max-h-[35vh] gap-2 overflow-y-auto">
          {visibleTransfers.map((transfer) => (
            <TransferRow key={transfer.transferId} transfer={transfer} />
          ))}
        </ul>
      </div>
    </aside>
  );
}
