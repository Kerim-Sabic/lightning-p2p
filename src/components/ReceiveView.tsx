import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FolderSymlink,
  Radar,
  ScanSearch,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { isProbablyBlobTicket } from "../lib/format";
import { isDesktopRuntime, type NearbyShare } from "../lib/tauri";
import { useNearbyShareStore } from "../stores/nearbyShareStore";
import { useTransferStore } from "../stores/transferStore";
import { useReceiveTransfers } from "../stores/transferSelectors";
import { NearbyShareCard } from "./NearbyShareCard";
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
      return "Nearby shares can take the fastest local path immediately, and manual tickets still keep WAN fallback available.";
    case "relay_ready":
      return "Nearby discovery still works, but remote sends may rely on relay fallback until direct addresses settle.";
    case "degraded":
      return "Give the node a moment if you want stronger route signals before receiving.";
    case "offline":
      return "Inspect relay and local network state in Settings before trying again.";
    case "starting":
    default:
      return "The node is still starting. You can scan for nearby shares now and paste a manual ticket as a fallback.";
  }
}

export function ReceiveView() {
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const settings = useTransferStore((state) => state.settings);
  const setError = useTransferStore((state) => state.setError);
  const startReceive = useTransferStore((state) => state.startReceive);
  const startReceiveNearbyShare = useTransferStore(
    (state) => state.startReceiveNearbyShare,
  );
  const cancelTransfer = useTransferStore((state) => state.cancelTransfer);
  const receiveTransfers = useReceiveTransfers();
  const nearbyShares = useNearbyShareStore((state) => state.shares);
  const desktopRuntime = isDesktopRuntime();
  const [ticketInput, setTicketInput] = useState("");

  const trimmedTicket = ticketInput.trim();
  const ticketLooksValid = isProbablyBlobTicket(trimmedTicket);
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;

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

  const handleNearbyReceive = async (share: NearbyShare): Promise<void> => {
    await startReceiveNearbyShare(share);
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
              Pull nearby shares without making users trade codes first
            </h1>
            <p className="page-copy mt-4 max-w-[60ch]">
              Lightning P2P now scans the local network for active nearby
              shares. Receive straight from the LAN when possible, then fall
              back to manual tickets when you need WAN reachability.
            </p>

            <div className="hero-metrics mt-7 grid gap-3 sm:grid-cols-3">
              <div className="stat-card">
                <p className="metric-label">Nearby shares</p>
                <p className="metric-value">{nearbyShares.length}</p>
              </div>
              <div className="stat-card">
                <p className="metric-label">Active receives</p>
                <p className="metric-value">{activeReceiveCount}</p>
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
            Nearby discovery is LAN-only in this pass. Manual tickets stay
            available below for internet transfers, clipboard handoff, and
            explicit fallback.
          </p>
        </aside>
      </section>

      <section className="glass-panel p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-white">Nearby shares</p>
            <p className="meta-copy mt-1">
              Same-network senders appear here automatically while they have an
              active share published.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ScanSearch className="h-4 w-4 text-sky-200/80" />
            {localDiscoveryEnabled
              ? "Scanning the local network"
              : "Local discovery is disabled in Settings"}
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {!localDiscoveryEnabled ? (
            <div className="glass-subtle px-6 py-10 text-center">
              <p className="text-base font-semibold text-white">
                Nearby discovery is turned off
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300/72">
                Enable local discovery in Settings if you want nearby senders to
                appear automatically.
              </p>
            </div>
          ) : nearbyShares.length === 0 ? (
            <div className="glass-subtle px-6 py-10 text-center">
              <p className="text-base font-semibold text-white">
                No nearby shares detected yet
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300/72">
                When a sender on this LAN stages a Lightning P2P share, it will
                appear here automatically.
              </p>
            </div>
          ) : (
            nearbyShares.map((share) => (
              <NearbyShareCard
                key={share.share_id}
                share={share}
                disabled={!desktopRuntime || !downloadDir}
                onReceive={(nextShare) => void handleNearbyReceive(nextShare)}
              />
            ))
          )}
        </div>
      </section>

      <section className="glass-panel p-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium text-white">
                Paste a code instead
              </p>
              <p className="meta-copy mt-1">
                Use a Lightning P2P blob ticket when the sender is not on the
                same LAN or when you want the explicit manual path.
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
                Start manual receive
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
                Accept a nearby share above or paste a manual ticket to start
                the first verified receive.
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
