import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { isProbablyBlobTicket } from "../lib/format";
import { useTransferStore } from "../stores/transferStore";
import { TransferCard } from "./TransferCard";

export function ReceiveView() {
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const transfers = useTransferStore((state) => state.transfers);
  const error = useTransferStore((state) => state.error);
  const startReceive = useTransferStore((state) => state.startReceive);
  const cancelTransfer = useTransferStore((state) => state.cancelTransfer);
  const [ticketInput, setTicketInput] = useState("");

  const receiveTransfers = useMemo(
    () =>
      Object.values(transfers)
        .filter((transfer) => transfer.direction === "receive")
        .sort((left, right) => right.transferId.localeCompare(left.transferId)),
    [transfers],
  );

  const trimmedTicket = ticketInput.trim();
  const ticketLooksValid = isProbablyBlobTicket(trimmedTicket);

  const handleReceive = async (): Promise<void> => {
    if (!trimmedTicket) {
      return;
    }

    const transferId = await startReceive(trimmedTicket);
    if (transferId) {
      setTicketInput("");
    }
  };

  const handlePaste = async (): Promise<void> => {
    const clipboardText = await navigator.clipboard.readText();
    setTicketInput(clipboardText);
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.32em] text-slate-400">
          <Sparkles className="h-3 w-3 text-emerald-300" />
          Receive
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Receive files
        </h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Paste a FastDrop ticket to stream verified files into your download
          folder.
        </p>
      </header>

      <section className="glass-panel p-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">BlobTicket</p>
              <p className="mt-1 text-sm text-slate-400">
                FastDrop tickets start with the{" "}
                <span className="font-mono text-slate-200">blob</span> prefix.
              </p>
            </div>
            <button
              onClick={() => void handlePaste()}
              className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-100"
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste
            </button>
          </div>

          <div className="relative">
            <textarea
              value={ticketInput}
              onChange={(event) => setTicketInput(event.target.value)}
              rows={4}
              placeholder="Paste a blob ticket..."
              className={`glass-subtle w-full resize-none rounded-[24px] px-4 py-4 pr-14 font-mono text-sm text-slate-100 outline-none transition-all placeholder:text-slate-600 ${
                trimmedTicket.length === 0
                  ? "border-white/10"
                  : ticketLooksValid
                    ? "border-emerald-400/30 shadow-[0_0_0_1px_rgba(34,197,94,0.1)]"
                    : "border-red-400/25 shadow-[0_0_0_1px_rgba(248,113,113,0.08)]"
              }`}
            />
            <div className="absolute right-4 top-4">
              {trimmedTicket.length === 0 ? null : ticketLooksValid ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-300" />
              ) : (
                <XCircle className="h-5 w-5 text-red-300" />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">
                Destination
              </p>
              <p className="break-all font-mono text-sm text-slate-200">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>

            <button
              onClick={() => void handleReceive()}
              disabled={!ticketLooksValid || !downloadDir}
              className="group relative inline-flex overflow-hidden rounded-xl border border-emerald-400/20 bg-emerald-500/15 px-5 py-3 text-sm font-medium text-emerald-50 shadow-[0_18px_50px_rgba(34,197,94,0.16)] transition-all hover:border-emerald-300/35 hover:bg-emerald-500/18 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.2),transparent_55%)] opacity-0 transition-opacity duration-200 group-active:opacity-100" />
              <span className="relative inline-flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4" />
                Download
              </span>
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <ArrowDownToLine className="h-4 w-4 text-emerald-300" />
          Active receives
        </div>

        <AnimatePresence mode="popLayout">
          {receiveTransfers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="glass-panel px-6 py-12 text-center text-sm text-slate-500"
            >
              No receive transfers yet.
            </motion.div>
          ) : (
            receiveTransfers.map((transfer) => (
              <TransferCard
                key={transfer.transferId}
                transfer={transfer}
                onCancel={(transferId) => void cancelTransfer(transferId)}
              />
            ))
          )}
        </AnimatePresence>
      </section>

      {error ? (
        <div className="glass-panel border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
