import { AnimatePresence, motion } from "framer-motion";
import {
  Clock3,
  Copy,
  Filter,
  History,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { formatBytes, formatTimestamp } from "../lib/format";
import { safeDisplayText } from "../lib/safeDisplayText";
import { createReceiveHandoffLink } from "../lib/shareLinks";
import { writeClipboardText } from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";
import { EmptyState } from "./EmptyState";

type DirectionFilter = "all" | "send" | "receive";
const HISTORY_PAGE_SIZE = 40;

function directionTone(
  direction: "send" | "receive",
  status: "completed" | "share_prepared",
): string {
  if (status === "share_prepared") {
    return "border-[var(--proof-amber)]/30 bg-[var(--proof-amber)]/10 text-[var(--proof-amber)]";
  }
  return direction === "send"
    ? "border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-primary)]"
    : "border-[var(--state-success)]/30 bg-[var(--state-success)]/10 text-[var(--state-success)]";
}

export function HistoryView() {
  const history = useTransferStore((state) => state.history);
  const reshare = useTransferStore((state) => state.reshare);
  const clearTransferHistory = useTransferStore(
    (state) => state.clearTransferHistory,
  );
  const setError = useTransferStore((state) => state.setError);
  const [directionFilter, setDirectionFilter] =
    useState<DirectionFilter>("all");
  const [query, setQuery] = useState("");
  const [resharedHash, setResharedHash] = useState<string | null>(null);
  const [resharedTicket, setResharedTicket] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "ticket" | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [visibleHistoryCount, setVisibleHistoryCount] =
    useState(HISTORY_PAGE_SIZE);

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();

  useEffect(() => {
    setVisibleHistoryCount(HISTORY_PAGE_SIZE);
  }, [directionFilter, normalizedQuery]);

  const filteredHistory = useMemo(
    () =>
      history.filter((record) => {
        if (directionFilter !== "all" && record.direction !== directionFilter) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        const searchableValues = [
          record.filename,
          record.hash,
          record.peer ?? "",
          record.direction,
          record.status,
        ];

        return searchableValues.some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      }),
    [directionFilter, history, normalizedQuery],
  );
  const visibleHistory = filteredHistory.slice(0, visibleHistoryCount);

  const totals = useMemo(() => {
    let sharesPreparedCount = 0;
    let receivedCount = 0;
    let totalBytes = 0;

    for (const record of history) {
      totalBytes += record.size;
      if (record.status === "share_prepared") {
        sharesPreparedCount += 1;
      } else if (record.direction === "receive") {
        receivedCount += 1;
      }
    }

    return {
      sharesPreparedCount,
      receivedCount,
      totalBytes,
    };
  }, [history]);

  const handleReshare = async (hash: string): Promise<void> => {
    const ticket = await reshare(hash);
    if (!ticket) {
      return;
    }
    setResharedHash(hash);
    setResharedTicket(ticket);
    setCopied(null);
  };

  const handleCopyShareLink = async (): Promise<void> => {
    if (!resharedTicket) {
      return;
    }

    try {
      await writeClipboardText(createReceiveHandoffLink(resharedTicket));
      setCopied("link");
      window.setTimeout(() => setCopied(null), 1800);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy failed");
    }
  };

  const handleCopyRawTicket = async (): Promise<void> => {
    if (!resharedTicket) {
      return;
    }

    try {
      await writeClipboardText(resharedTicket);
      setCopied("ticket");
      window.setTimeout(() => setCopied(null), 1800);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy failed");
    }
  };

  const handleClearHistory = async (): Promise<void> => {
    if (history.length === 0) {
      return;
    }
    if (!window.confirm("Clear all transfer history on this device?")) {
      return;
    }
    setClearingHistory(true);
    try {
      await clearTransferHistory();
    } finally {
      setClearingHistory(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.24fr_0.76fr]">
        <header className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-6 shadow-sm sm:p-8">
          <div>
            <div className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 text-xs font-semibold text-[var(--fg-secondary)]">
              <Clock3 className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
              History
            </div>
            <h1 className="mt-4 max-w-[18ch] text-2xl font-semibold tracking-[-0.03em] text-[var(--fg-primary)] sm:text-3xl">
              Review saved files and prepared shares
            </h1>
            <p className="mt-3 max-w-[60ch] text-sm leading-6 text-[var(--fg-secondary)]">
              Received files are marked complete after verification and saving.
              Outgoing shares stay marked as prepared until delivery is
              confirmed, and can be shared again from here.
            </p>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                <p className="text-sm font-medium text-[var(--fg-secondary)]">
                  Shares prepared
                </p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
                  {totals.sharesPreparedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                <p className="text-sm font-medium text-[var(--fg-secondary)]">
                  Receives
                </p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
                  {totals.receivedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
                <p className="text-sm font-medium text-[var(--fg-secondary)]">
                  Total volume
                </p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-[var(--fg-primary)]">
                  {formatBytes(totals.totalBytes)}
                </p>
              </div>
            </div>
          </div>
        </header>

        <aside className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-2)]">
              <Filter className="h-5 w-5 text-[var(--accent-primary)]" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[var(--fg-primary)]">
                Find the right item quickly
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">
                Search by filename, hash, peer, direction, or state. Re-share
                only uses content still stored on this device.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-muted)]" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search transfer activity"
                placeholder="Search filename, peer, or hash"
                className="min-h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] py-2.5 pl-10 pr-4 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {(["all", "send", "receive"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={directionFilter === value}
                  onClick={() => setDirectionFilter(value)}
                  className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                    directionFilter === value
                      ? "border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-primary)]"
                      : "border-[var(--border-strong)] bg-[var(--surface-1)] text-[var(--fg-secondary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  {value === "all"
                    ? "All transfers"
                    : value === "send"
                      ? "Shares"
                      : "Receives only"}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <AnimatePresence>
        {resharedHash && resharedTicket ? (
          <motion.section
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <p className="text-base font-semibold text-[var(--fg-primary)]">
                  Re-share link ready
                </p>
                <p className="mt-2 break-all rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] p-4 font-mono text-sm leading-6 text-[var(--fg-primary)]">
                  {createReceiveHandoffLink(resharedTicket)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyShareLink()}
                  className={`inline-flex min-h-11 items-center gap-2 self-start rounded-xl border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                    copied === "link"
                      ? "border-[var(--state-success)]/30 bg-[var(--state-success)]/10 text-[var(--state-success)]"
                      : "border-[var(--border-strong)] bg-[var(--surface-1)] text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <Copy className="h-4 w-4" />
                  {copied === "link" ? "Link copied" : "Copy share link"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleCopyRawTicket()}
                  className={`inline-flex min-h-11 items-center gap-2 self-start rounded-xl border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                    copied === "ticket"
                      ? "border-[var(--state-success)]/30 bg-[var(--state-success)]/10 text-[var(--state-success)]"
                      : "border-[var(--border-strong)] bg-[var(--surface-1)] text-[var(--fg-primary)] hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <Copy className="h-4 w-4" />
                  {copied === "ticket" ? "Ticket copied" : "Raw ticket"}
                </button>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-[var(--fg-primary)]">
            <History className="h-4 w-4 text-[var(--accent-primary)]" />
            Recent activity
          </div>
          <button
            type="button"
            onClick={() => void handleClearHistory()}
            disabled={history.length === 0 || clearingHistory}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear history
          </button>
        </div>

        {filteredHistory.length > 0 ? (
          <p className="text-sm text-[var(--fg-muted)]" aria-live="polite">
            Showing {visibleHistory.length} of {filteredHistory.length} records
          </p>
        ) : null}

        {filteredHistory.length === 0 ? (
          <EmptyState
            icon={history.length === 0 ? Clock3 : Search}
            title={
              history.length === 0
                ? "No activity yet"
                : "No matching transfers"
            }
            copy={
              history.length === 0
                ? "Completed receives and prepared outgoing shares show up here."
                : "Adjust the filters or complete a new transfer to populate the history."
            }
          />
        ) : (
          <div className="grid gap-3">
            {visibleHistory.map((record, index) => (
              <motion.article
                key={`${record.timestamp}-${record.hash}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 8) * 0.012, duration: 0.18 }}
                className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-5 shadow-sm transition-colors duration-200 hover:bg-[var(--surface-hover)]"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold ${directionTone(
                          record.direction,
                          record.status,
                        )}`}
                      >
                        {record.status === "share_prepared"
                          ? "Share prepared"
                          : record.direction}
                      </span>
                      <span className="text-sm text-[var(--fg-muted)]">
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </div>

                    <p className="mt-2 text-base font-semibold text-[var(--fg-primary)]">
                      {safeDisplayText(record.filename, "Shared file")}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--fg-secondary)]">
                      <span className="tabular-nums">
                        {formatBytes(record.size)}
                      </span>
                      <span className="font-mono text-xs text-[var(--fg-muted)]">
                        {record.hash.slice(0, 16)}...
                      </span>
                      {record.peer ? (
                        <span className="truncate font-mono text-xs text-[var(--fg-muted)]">
                          {record.peer.slice(0, 18)}...
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleReshare(record.hash)}
                    className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-4 py-2 text-sm font-medium text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-share
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        )}
        {visibleHistory.length < filteredHistory.length ? (
          <button
            type="button"
            onClick={() =>
              setVisibleHistoryCount((count) =>
                Math.min(count + HISTORY_PAGE_SIZE, filteredHistory.length),
              )
            }
            className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-4 text-sm font-medium text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
          >
            Load {Math.min(HISTORY_PAGE_SIZE, filteredHistory.length - visibleHistory.length)} more
          </button>
        ) : null}
      </section>
    </div>
  );
}
