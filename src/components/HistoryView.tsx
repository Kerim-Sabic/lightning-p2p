import { AnimatePresence, motion } from "framer-motion";
import { Clock3, Copy, History, RefreshCw } from "lucide-react";
import { useState } from "react";
import { formatBytes, formatTimestamp } from "../lib/format";
import { useTransferStore } from "../stores/transferStore";

export function HistoryView() {
  const history = useTransferStore((state) => state.history);
  const error = useTransferStore((state) => state.error);
  const reshare = useTransferStore((state) => state.reshare);
  const [resharedHash, setResharedHash] = useState<string | null>(null);
  const [resharedTicket, setResharedTicket] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleReshare = async (hash: string): Promise<void> => {
    const ticket = await reshare(hash);
    if (!ticket) {
      return;
    }
    setResharedHash(hash);
    setResharedTicket(ticket);
    setCopied(false);
  };

  const handleCopy = async (): Promise<void> => {
    if (!resharedTicket) {
      return;
    }
    await navigator.clipboard.writeText(resharedTicket);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="badge">
          <Clock3 className="h-3 w-3 text-violet-300" />
          History
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Transfer history
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-slate-400">
          Review past transfers and re-share stored content.
        </p>
      </header>

      {/* Re-share ticket */}
      <AnimatePresence>
        {resharedHash && resharedTicket ? (
          <motion.section
            initial={{ opacity: 0, y: 14, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            className="glass-panel p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  Re-share ticket ready
                </p>
                <p className="mt-2 break-all rounded-xl border border-white/[0.06] bg-black/40 p-4 font-mono text-xs text-sky-100/80">
                  {resharedTicket}
                </p>
              </div>
              <button
                onClick={() => void handleCopy()}
                className={`glass-button inline-flex items-center gap-2 self-start px-4 py-2 text-sm transition-all duration-200 ${
                  copied
                    ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                    : "text-slate-200"
                }`}
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied!" : "Copy ticket"}
              </button>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* Transfer log */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <History className="h-4 w-4 text-violet-300" />
          Transfer log
        </div>

        {history.length === 0 ? (
          <div className="glass-panel px-6 py-14 text-center text-sm text-slate-500">
            No completed transfers yet.
          </div>
        ) : (
          <div className="grid gap-2">
            {history.map((record, index) => (
              <motion.article
                key={`${record.timestamp}-${record.hash}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03, duration: 0.2 }}
                className="glass-panel group p-4 transition-colors duration-200 hover:bg-white/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
                          record.direction === "send"
                            ? "border-sky-400/15 bg-sky-500/8 text-sky-300"
                            : "border-emerald-400/15 bg-emerald-500/8 text-emerald-300"
                        }`}
                      >
                        {record.direction}
                      </span>
                      <span className="text-xs text-slate-600">
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm font-medium text-white">
                      {record.filename}
                    </p>
                    <div className="mt-1 flex items-center gap-3 text-[13px] text-slate-500">
                      <span className="tabular-nums">
                        {formatBytes(record.size)}
                      </span>
                      {record.peer ? (
                        <span className="truncate font-mono text-[10px] text-slate-600">
                          {record.peer.slice(0, 16)}...
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <button
                    onClick={() => void handleReshare(record.hash)}
                    className="glass-button inline-flex shrink-0 items-center gap-2 px-3 py-1.5 text-sm text-slate-300 opacity-60 transition-opacity duration-200 group-hover:opacity-100"
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

      {/* Error */}
      {error ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </motion.div>
      ) : null}
    </div>
  );
}
