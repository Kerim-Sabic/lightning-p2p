import { AnimatePresence, motion } from "framer-motion";
import { Copy, History, RefreshCw, Sparkles } from "lucide-react";
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
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.32em] text-slate-400">
          <Sparkles className="h-3 w-3 text-sky-300" />
          History
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Transfer history
        </h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Review past transfers and re-share stored content.
        </p>
      </header>

      <AnimatePresence>
        {resharedHash && resharedTicket ? (
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            className="glass-panel p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-white">
                  Re-share ticket ready
                </p>
                <p className="mt-2 break-all rounded-2xl border border-white/10 bg-black/30 p-4 font-mono text-xs text-sky-100">
                  {resharedTicket}
                </p>
              </div>
              <button
                onClick={() => void handleCopy()}
                className="glass-button inline-flex items-center gap-2 self-start px-4 py-2 text-sm text-slate-100"
              >
                <Copy className="h-4 w-4" />
                {copied ? "Copied" : "Copy ticket"}
              </button>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <History className="h-4 w-4 text-sky-300" />
          Transfer log
        </div>

        {history.length === 0 ? (
          <div className="glass-panel px-6 py-12 text-center text-sm text-slate-500">
            No completed transfers yet.
          </div>
        ) : (
          <div className="grid gap-3">
            {history.map((record) => (
              <motion.article
                key={`${record.timestamp}-${record.hash}`}
                initial={{ opacity: 0, y: 12, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 24 }}
                className="glass-panel p-5"
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-slate-300">
                        {record.direction}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatTimestamp(record.timestamp)}
                      </span>
                    </div>
                    <p className="mt-3 text-base font-medium text-white">
                      {record.filename}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-300">
                      <span>{formatBytes(record.size)}</span>
                      {record.peer ? (
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-400">
                          {record.peer.slice(0, 16)}...
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-3 break-all font-mono text-[11px] text-slate-500">
                      {record.hash}
                    </p>
                  </div>

                  <button
                    onClick={() => void handleReshare(record.hash)}
                    className="glass-button inline-flex items-center gap-2 self-start px-4 py-2 text-sm text-slate-100"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Re-share
                  </button>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </section>

      {error ? (
        <div className="glass-panel border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
