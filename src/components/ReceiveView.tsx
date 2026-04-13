import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Download,
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
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="badge">
          <Download className="h-3 w-3 text-emerald-300" />
          Receive
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Receive files
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-slate-400">
          Paste a FastDrop ticket to stream verified files into your download
          folder.
        </p>
      </header>

      {/* Ticket input */}
      <section className="glass-panel p-5">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">BlobTicket</p>
              <p className="mt-1 text-[13px] text-slate-500">
                FastDrop tickets start with{" "}
                <span className="rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-slate-300">
                  blob
                </span>
              </p>
            </div>
            <button
              onClick={() => void handlePaste()}
              className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-200"
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste
            </button>
          </div>

          <div className="relative">
            <textarea
              value={ticketInput}
              onChange={(event) => setTicketInput(event.target.value)}
              rows={3}
              placeholder="Paste a blob ticket..."
              className={`glass-input w-full resize-none rounded-xl px-4 py-3.5 pr-12 font-mono text-sm text-slate-100 placeholder:text-slate-600 ${
                trimmedTicket.length === 0
                  ? ""
                  : ticketLooksValid
                    ? "border-emerald-400/25 ring-1 ring-emerald-400/10"
                    : "border-red-400/20 ring-1 ring-red-400/8"
              }`}
            />
            <div className="absolute right-3.5 top-3.5">
              <AnimatePresence mode="wait">
                {trimmedTicket.length === 0 ? null : ticketLooksValid ? (
                  <motion.div
                    key="valid"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="invalid"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <XCircle className="h-5 w-5 text-red-300/70" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Destination
              </p>
              <p className="break-all font-mono text-sm text-slate-300">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>

            <button
              onClick={() => void handleReceive()}
              disabled={!ticketLooksValid || !downloadDir}
              className="btn-success"
            >
              <span className="relative inline-flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4" />
                Download
              </span>
            </button>
          </div>
        </div>
      </section>

      {/* Active receives */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <ArrowDownToLine className="h-4 w-4 text-emerald-300" />
          Active receives
        </div>

        <AnimatePresence mode="popLayout">
          {receiveTransfers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel px-6 py-14 text-center text-sm text-slate-500"
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
