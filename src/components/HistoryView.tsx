import { AnimatePresence, motion } from "framer-motion";
import { Clock3, Copy, Filter, History, RefreshCw, Search } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { formatBytes, formatTimestamp } from "../lib/format";
import { createReceiveHandoffLink } from "../lib/shareLinks";
import { writeClipboardText } from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";

type DirectionFilter = "all" | "send" | "receive";

function directionTone(direction: "send" | "receive"): string {
  return direction === "send"
    ? "border-sky-400/15 bg-sky-500/8 text-sky-200"
    : "border-emerald-400/15 bg-emerald-500/8 text-emerald-200";
}

export function HistoryView() {
  const history = useTransferStore((state) => state.history);
  const reshare = useTransferStore((state) => state.reshare);
  const setError = useTransferStore((state) => state.setError);
  const [directionFilter, setDirectionFilter] =
    useState<DirectionFilter>("all");
  const [query, setQuery] = useState("");
  const [resharedHash, setResharedHash] = useState<string | null>(null);
  const [resharedTicket, setResharedTicket] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "ticket" | null>(null);

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();

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
        ];

        return searchableValues.some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      }),
    [directionFilter, history, normalizedQuery],
  );

  const totals = useMemo(() => {
    let sentCount = 0;
    let receivedCount = 0;
    let totalBytes = 0;

    for (const record of history) {
      totalBytes += record.size;
      if (record.direction === "send") {
        sentCount += 1;
      } else {
        receivedCount += 1;
      }
    }

    return {
      sentCount,
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

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.24fr_0.76fr]">
        <header className="glass-panel hero-panel relative overflow-hidden p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_18%,rgba(56,189,248,0.08),transparent_24%),radial-gradient(circle_at_12%_100%,rgba(148,163,184,0.05),transparent_26%)]" />
          <div className="relative">
            <div className="badge">
              <Clock3 className="h-3 w-3 text-sky-200" />
              History
            </div>
            <h1 className="page-title mt-6 max-w-[12ch]">
              Review what moved and re-share it fast
            </h1>
            <p className="page-copy mt-4 max-w-[60ch]">
              Transfer history is a working surface, not just a log. Filter by
              direction, find past items quickly, and regenerate a ticket for
              any stored send without reimporting the content.
            </p>

            <div className="hero-metrics mt-7 grid gap-3 sm:grid-cols-3">
              <div className="stat-card">
                <p className="metric-label">Sends</p>
                <p className="metric-value">{totals.sentCount}</p>
              </div>
              <div className="stat-card">
                <p className="metric-label">Receives</p>
                <p className="metric-value">{totals.receivedCount}</p>
              </div>
              <div className="stat-card">
                <p className="metric-label">Total volume</p>
                <p className="metric-value">{formatBytes(totals.totalBytes)}</p>
              </div>
            </div>
          </div>
        </header>

        <aside className="glass-panel p-6">
          <div className="flex items-start gap-3">
            <div className="glass-icon h-12 w-12 rounded-2xl">
              <Filter className="h-5 w-5 text-sky-200" />
            </div>
            <div>
              <div className="badge">
                <History className="h-3 w-3 text-sky-200" />
                Searchable log
              </div>
              <h2 className="mt-4 text-[1.55rem] font-semibold leading-tight tracking-[-0.03em] text-white">
                Find the right transfer quickly
              </h2>
              <p className="meta-copy mt-3">
                Search by filename, hash, peer, or direction. Re-share only
                reuses stored content that is already in the local blob store.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search filename, peer, or hash"
                className="glass-input w-full rounded-2xl py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              {(["all", "send", "receive"] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setDirectionFilter(value)}
                  className={`rounded-2xl border px-4 py-2 text-sm transition-all ${
                    directionFilter === value
                      ? "border-sky-300/20 bg-sky-500/14 text-sky-100"
                      : "border-white/10 bg-white/[0.04] text-slate-300"
                  }`}
                >
                  {value === "all"
                    ? "All transfers"
                    : value === "send"
                      ? "Sends only"
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
            className="glass-panel p-6"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  Re-share link ready
                </p>
                <p className="mt-2 break-all rounded-2xl border border-emerald-400/16 bg-emerald-500/[0.08] p-4 font-mono text-xs leading-6 text-emerald-50/90">
                  {createReceiveHandoffLink(resharedTicket)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  onClick={() => void handleCopyShareLink()}
                  className={`glass-button inline-flex items-center gap-2 self-start px-4 py-2 text-sm transition-all duration-200 ${
                    copied === "link"
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                      : "text-slate-100"
                  }`}
                >
                  <Copy className="h-4 w-4" />
                  {copied === "link" ? "Link copied" : "Copy share link"}
                </button>
                <button
                  onClick={() => void handleCopyRawTicket()}
                  className={`glass-button inline-flex items-center gap-2 self-start px-4 py-2 text-sm transition-all duration-200 ${
                    copied === "ticket"
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                      : "text-slate-100"
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
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <History className="h-4 w-4 text-violet-200" />
          Transfer log
        </div>

        {filteredHistory.length === 0 ? (
          <div className="glass-panel px-6 py-14 text-center">
            <p className="text-base font-semibold text-white">
              No matching transfers
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-300/72">
              Adjust the filters or complete a new transfer to populate the
              history.
            </p>
          </div>
        ) : (
          <div className="grid gap-3">
            {filteredHistory.map((record, index) => (
              <motion.article
                key={`${record.timestamp}-${record.hash}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.02, duration: 0.18 }}
                className="glass-panel group p-5 transition-colors duration-200 hover:bg-white/[0.05]"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-[0.22em] ${directionTone(
                          record.direction,
                        )}`}
                      >
                        {record.direction}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </div>

                    <p className="mt-2 text-base font-semibold text-white">
                      {record.filename}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-slate-300/72">
                      <span className="tabular-nums">
                        {formatBytes(record.size)}
                      </span>
                      <span className="font-mono text-[11px] text-slate-400">
                        {record.hash.slice(0, 16)}...
                      </span>
                      {record.peer ? (
                        <span className="truncate font-mono text-[11px] text-slate-400">
                          {record.peer.slice(0, 18)}...
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    onClick={() => void handleReshare(record.hash)}
                    className="glass-button inline-flex shrink-0 items-center gap-2 px-4 py-2 text-sm text-slate-100 opacity-70 transition-opacity duration-200 group-hover:opacity-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Re-share
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
