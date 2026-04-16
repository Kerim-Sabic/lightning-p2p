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
      <section className="grid gap-4 xl:grid-cols-[1.24fr_0.76fr]">
        <header className="glass-panel hero-panel relative overflow-hidden p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_84%_18%,rgba(56,189,248,0.1),transparent_22%),radial-gradient(circle_at_14%_100%,rgba(16,185,129,0.06),transparent_24%)]" />
          <div className="relative">
          <div className="badge">
            <Download className="h-3 w-3 text-emerald-200" />
            Receive
          </div>
          <h1 className="page-title mt-6 max-w-[13ch]">
            Pull verified data straight to disk
          </h1>
          <p className="page-copy mt-4 max-w-[60ch]">
            Paste a Lightning P2P blob ticket to connect to the sender, stream
            the content through iroh, and export only verified bytes into your
            chosen receive folder.
          </p>

          <div className="hero-metrics mt-7 grid gap-3 sm:grid-cols-3">
            <div className="stat-card">
              <p className="metric-label">Active receives</p>
              <p className="metric-value">
                {activeReceiveCount}
              </p>
            </div>
            <div className="stat-card">
              <p className="metric-label">Direct addresses</p>
              <p className="metric-value">
                {nodeStatus.direct_address_count}
              </p>
            </div>
            <div className="stat-card">
              <p className="metric-label">Destination</p>
              <p className="mt-2 truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
                {downloadDir ? "Configured" : "Resolving"}
              </p>
            </div>
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
              <h2 className="mt-4 text-[1.55rem] font-semibold leading-tight tracking-[-0.03em] text-white">
                {readinessLabel(nodeStatus.online_state)}
              </h2>
              <p className="meta-copy mt-3">
                {readinessCopy(nodeStatus.online_state)}
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-[24px] border border-white/[0.08] bg-black/20 p-4">
            <p className="metric-label">Receive folder</p>
            <div className="mt-3 flex items-start gap-3">
              <div className="glass-icon h-11 w-11 rounded-2xl">
                <FolderSymlink className="h-4 w-4 text-emerald-200" />
              </div>
              <p className="break-all font-mono text-[13px] leading-6 text-slate-100/88">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>
          </div>

          <p className="meta-copy mt-5">
            Direct paths are the speed path. Relay paths are still secure and
            verified, but they are there for reachability first and speed
            second.
          </p>
        </aside>
      </section>

      <section className="glass-panel p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-white">Blob ticket</p>
              <p className="meta-copy mt-1">
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
              className={`glass-input w-full resize-none rounded-[24px] px-4 py-4 pr-12 font-mono text-sm leading-6 text-slate-100 placeholder:text-slate-500 ${
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
              <p className="metric-label">Export destination</p>
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
