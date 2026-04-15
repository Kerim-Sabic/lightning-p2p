import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FolderSymlink,
  Radar,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { isProbablyBlobTicket } from "../lib/format";
import { isDesktopRuntime } from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";
import { useReceiveTransfers } from "../stores/transferSelectors";
import { TransferCard } from "./TransferCard";

function readinessLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Fast path is available";
    case "relay_ready":
      return "Relay fallback is available";
    case "degraded":
      return "Route still warming";
    case "offline":
      return "Node unavailable";
    case "starting":
    default:
      return "Node is starting";
  }
}

function readinessCopy(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "If the sender is also reachable directly, this receive can take the fastest end-to-end route.";
    case "relay_ready":
      return "The transfer can still complete now, but speeds may be lower if the path stays relay-assisted.";
    case "degraded":
      return "Wait a moment if you want discovery to publish a better route before starting the receive.";
    case "offline":
      return "Open Settings and inspect the relay or local network state before trying again.";
    case "starting":
    default:
      return "You can prepare the ticket now and start as soon as the node is ready.";
  }
}

export function ReceiveView() {
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const setError = useTransferStore((state) => state.setError);
  const startReceive = useTransferStore((state) => state.startReceive);
  const cancelTransfer = useTransferStore((state) => state.cancelTransfer);
  const receiveTransfers = useReceiveTransfers();
  const desktopRuntime = isDesktopRuntime();
  const [ticketInput, setTicketInput] = useState("");

  const trimmedTicket = ticketInput.trim();
  const ticketLooksValid = isProbablyBlobTicket(trimmedTicket);

  const activeReceiveCount = useMemo(
    () =>
      receiveTransfers.filter(
        (transfer) =>
          transfer.status === "starting" || transfer.status === "running",
      ).length,
    [receiveTransfers],
  );

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
    try {
      const clipboardText = await navigator.clipboard.readText();
      setTicketInput(clipboardText);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Paste failed");
    }
  };

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <header className="glass-panel p-6">
          <div className="badge">
            <Download className="h-3 w-3 text-emerald-200" />
            Receive
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
            Pull verified data straight to disk
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300/80">
            Paste a Lightning P2P blob ticket to connect to the sender, stream
            the content through iroh, and export only verified bytes into your
            chosen receive folder.
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Active receives
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
                {activeReceiveCount}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Direct addresses
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
                {nodeStatus.direct_address_count}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Destination
              </p>
              <p className="mt-1.5 truncate text-sm font-semibold text-white">
                {downloadDir ? "Configured" : "Resolving"}
              </p>
            </div>
          </div>
        </header>

        <aside className="glass-panel p-6">
          <div className="flex items-start gap-3">
            <div className="glass-icon h-12 w-12 rounded-2xl">
              <Radar className="h-5 w-5 text-sky-200" />
            </div>
            <div>
              <div className="badge">
                <CheckCircle2 className="h-3 w-3 text-sky-200" />
                Route readiness
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">
                {readinessLabel(nodeStatus.online_state)}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300/80">
                {readinessCopy(nodeStatus.online_state)}
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-white/8 bg-black/25 p-4">
            <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
              Receive folder
            </p>
            <div className="mt-3 flex items-start gap-3">
              <div className="glass-icon h-11 w-11 rounded-2xl">
                <FolderSymlink className="h-4 w-4 text-emerald-200" />
              </div>
              <p className="break-all font-mono text-[13px] leading-6 text-slate-100/88">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm leading-6 text-slate-300/72">
            Direct paths are the speed path. Relay paths are still secure and
            verified, but they are there for reachability first and speed
            second.
          </p>
        </aside>
      </section>

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-white">Blob ticket</p>
              <p className="mt-1 text-[13px] leading-6 text-slate-300/72">
                Lightning P2P blob tickets usually begin with{" "}
                <span className="rounded-md border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[11px] text-slate-100">
                  blob
                </span>
                . Paste the full string to recover the sender address, relay,
                and hash.
              </p>
            </div>
            <button
              onClick={() => void handlePaste()}
              className="glass-button inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate-100"
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste from clipboard
            </button>
          </div>

          <div className="relative">
            <textarea
              value={ticketInput}
              onChange={(event) => setTicketInput(event.target.value)}
              rows={4}
              placeholder="Paste a blob ticket..."
              className={`glass-input w-full resize-none rounded-2xl px-4 py-3.5 pr-12 font-mono text-sm leading-6 text-slate-100 placeholder:text-slate-500 ${
                trimmedTicket.length === 0
                  ? ""
                  : ticketLooksValid
                    ? "border-emerald-400/25 ring-1 ring-emerald-400/10"
                    : "border-rose-400/20 ring-1 ring-rose-400/8"
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
                    <CheckCircle2 className="h-5 w-5 text-emerald-200" />
                  </motion.div>
                ) : (
                  <motion.div
                    key="invalid"
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <XCircle className="h-5 w-5 text-rose-200/80" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-500">
                Export destination
              </p>
              <p className="mt-2 break-all font-mono text-sm leading-6 text-slate-100/88">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>

            <button
              onClick={() => void handleReceive()}
              disabled={!ticketLooksValid || !downloadDir || !desktopRuntime}
              className="btn-success"
            >
              <span className="relative inline-flex items-center gap-2">
                <ArrowDownToLine className="h-4 w-4" />
                Start receive
              </span>
            </button>
          </div>
          {!desktopRuntime ? (
            <p className="text-xs leading-6 text-slate-400">
              Receiving transfers requires the native Lightning P2P desktop app
              runtime.
            </p>
          ) : null}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <ArrowDownToLine className="h-4 w-4 text-emerald-200" />
          Active receives
        </div>

        <AnimatePresence mode="popLayout">
          {receiveTransfers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="glass-panel px-6 py-14 text-center"
            >
              <p className="text-base font-semibold text-white">
                No receive transfers yet
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300/72">
                Paste a blob ticket above to start the first verified receive.
              </p>
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
    </div>
  );
}
