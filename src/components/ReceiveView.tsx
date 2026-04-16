import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FolderSymlink,
  ScanSearch,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { isProbablyBlobTicket } from "../lib/format";
import { isDesktopRuntime, type NearbyShare } from "../lib/tauri";
import { useNearbyShareStore } from "../stores/nearbyShareStore";
import { useReceiveTransfers } from "../stores/transferSelectors";
import { useTransferStore } from "../stores/transferStore";
import { NearbyShareCard } from "./NearbyShareCard";
import { TransferCard } from "./TransferCard";

function networkLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay ready";
    case "degraded":
      return "Warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Starting";
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
    <div className="space-y-4">
      <section className="glass-panel p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="glass-icon h-14 w-14 rounded-[20px]">
              <Download className="h-6 w-6 text-emerald-200" />
            </div>
            <p className="page-eyebrow mt-5">Receive</p>
            <h1 className="mt-2 text-[clamp(1.8rem,1.6rem+0.8vw,2.4rem)] font-semibold tracking-[-0.04em] text-white">
              Receive from nearby senders first
            </h1>
            <p className="meta-copy mt-3 max-w-[58ch]">
              Nearby shares should appear automatically on the same LAN. Manual
              code entry stays available when discovery is unavailable.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="chrome-pill">
                Network {networkLabel(nodeStatus.online_state)}
              </span>
              <span className="chrome-pill">
                {localDiscoveryEnabled
                  ? "Nearby discovery enabled"
                  : "Nearby discovery disabled"}
              </span>
              <span className="chrome-pill">{activeReceiveCount} active receive</span>
            </div>
          </div>

          <div className="glass-subtle flex w-full max-w-[340px] flex-col gap-3 px-4 py-4">
            <p className="metric-label">Receive folder</p>
            <div className="flex items-start gap-3">
              <div className="glass-icon h-10 w-10 shrink-0">
                <FolderSymlink className="h-4 w-4 text-emerald-200" />
              </div>
              <p className="break-all font-mono text-[13px] leading-6 text-slate-100/88">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Nearby shares</p>
            <p className="meta-copy mt-1">
              Same-network senders with an active share should appear here.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ScanSearch className="h-4 w-4 text-sky-200/80" />
            {localDiscoveryEnabled
              ? "Scanning the local network"
              : "Turn on nearby discovery in Settings"}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!localDiscoveryEnabled ? (
            <div className="glass-subtle px-5 py-8 text-center">
              <p className="text-base font-semibold text-white">
                Nearby discovery is off
              </p>
              <p className="meta-copy mt-2">
                Enable local discovery in Settings if you want nearby senders to
                appear automatically.
              </p>
            </div>
          ) : nearbyShares.length === 0 ? (
            <div className="glass-subtle px-5 py-8 text-center">
              <p className="text-base font-semibold text-white">
                No nearby shares detected yet
              </p>
              <p className="meta-copy mt-2">
                If a sender is active on this LAN and still does not appear,
                fall back to a manual code below.
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

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Paste a code instead</p>
            <p className="meta-copy mt-1">
              Use this when the sender is not visible on the LAN or when you
              want the explicit manual path.
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

        <div className="mt-4 space-y-4">
          <div className="relative">
            <textarea
              value={ticketInput}
              onChange={(event) => setTicketInput(event.target.value)}
              rows={4}
              placeholder="Paste a blob ticket..."
              className={`glass-input w-full resize-none rounded-[20px] px-4 py-4 pr-12 font-mono text-sm leading-6 text-slate-100 placeholder:text-slate-500 ${
                trimmedTicket.length === 0
                  ? ""
                  : ticketLooksValid
                    ? "border-emerald-400/25 ring-1 ring-emerald-400/10"
                    : "border-rose-400/20 ring-1 ring-rose-400/8"
              }`}
            />
            <div className="absolute right-3.5 top-3.5">
              {trimmedTicket.length === 0 ? null : ticketLooksValid ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-200" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-200/80" />
              )}
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
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <ArrowDownToLine className="h-4 w-4 text-emerald-200" />
          Active receives
        </div>

        {receiveTransfers.length === 0 ? (
          <div className="glass-panel px-5 py-10 text-center">
            <p className="text-base font-semibold text-white">
              No receive transfers yet
            </p>
            <p className="meta-copy mt-2">
              Accept a nearby share above or paste a manual code to begin.
            </p>
          </div>
        ) : (
          receiveTransfers.map((transfer) => (
            <TransferCard
              key={transfer.transferId}
              transfer={transfer}
              onCancel={(transferId) => void cancelTransfer(transferId)}
            />
          ))
        )}
      </section>
    </div>
  );
}
