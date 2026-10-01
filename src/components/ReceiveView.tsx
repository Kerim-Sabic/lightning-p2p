import {
  ArrowDownToLine,
  CheckCircle2,
  ClipboardPaste,
  Download,
  FolderSymlink,
  ScanSearch,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { extractBlobTicket } from "../lib/format";
import { appErrorFromCode } from "../lib/appErrors";
import {
  isDesktopRuntime,
  isMobileRuntime,
  prewarmTicket,
  readClipboardText,
  scanReceiveTicketQr,
  type NearbyShare,
} from "../lib/tauri";
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

interface ReceiveViewProps {
  onNavigateSend?: () => void;
}

export function ReceiveView({ onNavigateSend }: ReceiveViewProps = {}) {
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const settings = useTransferStore((state) => state.settings);
  const platformProfile = useTransferStore((state) => state.platformProfile);
  const smartRouting = platformProfile.capabilities.smart_routing;
  const setError = useTransferStore((state) => state.setError);
  const setAppError = useTransferStore((state) => state.setAppError);
  const startReceive = useTransferStore((state) => state.startReceive);
  const startReceiveNearbyShare = useTransferStore(
    (state) => state.startReceiveNearbyShare,
  );
  const cancelTransfer = useTransferStore((state) => state.cancelTransfer);
  const pauseTransfer = useTransferStore((state) => state.pauseTransfer);
  const resumeTransfer = useTransferStore((state) => state.resumeTransfer);
  const pendingReceiveTicket = useTransferStore(
    (state) => state.pendingReceiveTicket,
  );
  const consumePendingReceiveTicket = useTransferStore(
    (state) => state.consumePendingReceiveTicket,
  );
  const receiveTransfers = useReceiveTransfers();
  const nearbyShares = useNearbyShareStore((state) => state.shares);
  const nativeRuntime = isDesktopRuntime();
  const mobileRuntime = isMobileRuntime();
  const [ticketInput, setTicketInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [clipboardSuggestion, setClipboardSuggestion] = useState<string | null>(
    null,
  );

  const trimmedTicket = ticketInput.trim();
  const normalizedTicket = extractBlobTicket(trimmedTicket);
  const ticketLooksValid = normalizedTicket !== null;
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;

  const probeClipboardForTicket = useCallback(async (): Promise<void> => {
    if (!nativeRuntime) {
      return;
    }
    try {
      const text = (await readClipboardText()).trim();
      const ticket = extractBlobTicket(text);
      if (!ticket) {
        setClipboardSuggestion(null);
        return;
      }
      setClipboardSuggestion((previous) => {
        if (previous === ticket) {
          return previous;
        }
        return ticket;
      });
    } catch {
      // Clipboard access can fail when the window isn't focused or on first
      // read; silently ignore - the user can still paste manually.
    }
  }, [nativeRuntime]);

  useEffect(() => {
    void probeClipboardForTicket();
    const handleFocus = (): void => {
      void probeClipboardForTicket();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [probeClipboardForTicket]);

  useEffect(() => {
    if (!clipboardSuggestion) {
      return;
    }
    if (trimmedTicket === clipboardSuggestion) {
      setClipboardSuggestion(null);
    }
  }, [clipboardSuggestion, trimmedTicket]);

  useEffect(() => {
    if (!pendingReceiveTicket) {
      return;
    }
    const ticket = consumePendingReceiveTicket();
    if (ticket) {
      setTicketInput(ticket);
    }
  }, [pendingReceiveTicket, consumePendingReceiveTicket]);

  // As soon as the field holds a valid ticket, pre-dial the sender in the
  // background so holepunching and the QUIC handshake are already done when
  // the user presses Receive. Debounced so keystrokes don't stack dials.
  useEffect(() => {
    if (!nativeRuntime || !normalizedTicket) {
      return;
    }
    const timer = window.setTimeout(() => {
      void prewarmTicket(normalizedTicket);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [nativeRuntime, normalizedTicket]);

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

    if (!normalizedTicket) {
      setAppError(appErrorFromCode("malformed_receive_link"));
      return;
    }

    const transferId = await startReceive(normalizedTicket);
    if (transferId) {
      setTicketInput("");
    }
  };

  const handleNearbyReceive = async (share: NearbyShare): Promise<void> => {
    await startReceiveNearbyShare(share);
  };

  const handlePaste = async (): Promise<void> => {
    try {
      const clipboardText = await readClipboardText();
      setTicketInput(extractBlobTicket(clipboardText) ?? clipboardText);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Paste failed");
    }
  };

  const handleScanQr = async (): Promise<void> => {
    setIsScanning(true);
    try {
      const ticket = await scanReceiveTicketQr();
      setTicketInput(ticket);
      setClipboardSuggestion(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "QR scan failed");
    } finally {
      setIsScanning(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="grid h-12 w-12 place-items-center rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-subtle)]">
              <Download className="h-5 w-5 text-[var(--accent-primary)]" />
            </div>
            <p className="page-eyebrow mt-5">Receive</p>
            <h1 className="mt-2 text-[clamp(1.65rem,1.5rem+0.7vw,2.1rem)] font-semibold tracking-[-0.035em] text-[var(--fg-primary)]">
              Receive from nearby senders first
            </h1>
            <p className="mt-3 max-w-[58ch] text-sm leading-6 text-[var(--fg-secondary)]">
              {mobileRuntime
                ? "Receive links, QR scans, and nearby shares work in the foreground. Keep this app open until the transfer finishes."
                : "Nearby shares should appear automatically on the same LAN. Receive links and raw tickets stay available when discovery is unavailable."}
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--fg-secondary)]">
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1">
                Network {networkLabel(nodeStatus.online_state)}
              </span>
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1">
                {localDiscoveryEnabled
                  ? "Nearby discovery enabled"
                  : "Nearby discovery disabled"}
              </span>
              <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-1">
                {activeReceiveCount} active receive
              </span>
            </div>
          </div>

          <div className="flex w-full max-w-[340px] flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
              {mobileRuntime ? "Android receive storage" : "Receive folder"}
            </p>
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)]">
                <FolderSymlink className="h-4 w-4 text-[var(--accent-primary)]" />
              </div>
              <p className="break-all font-mono text-[13px] leading-6 text-[var(--fg-primary)]">
                {downloadDir ?? "Resolving download directory..."}
              </p>
            </div>
            {mobileRuntime ? (
              <p className="text-sm leading-6 text-[var(--fg-secondary)]">
                Single-file receives publish to Pictures, Movies, Music, or
                Downloads by type. Folder receives stay app-private in this
                build.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {mobileRuntime ? (
        <section className="rounded-2xl border border-[var(--amber-border)] bg-[var(--amber-bg)] p-4">
          <p className="text-sm font-semibold text-[var(--proof-amber)]">
            Foreground transfer alpha
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
            Keep the screen awake, keep Lightning P2P open, and keep the sender
            online. Android may pause or stop this alpha if the app is
            backgrounded for too long.
          </p>
        </section>
      ) : null}

      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-base font-semibold text-[var(--fg-primary)]">
              Nearby shares
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">
              Active share details appear here only for verified devices. New
              senders can send you an offer or a receive link.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-[var(--fg-secondary)]">
            <ScanSearch className="h-4 w-4 text-[var(--accent-primary)]" />
            {localDiscoveryEnabled
              ? "Scanning the local network"
              : "Turn on nearby discovery in Settings"}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!localDiscoveryEnabled ? (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-8 text-center">
              <p className="text-base font-semibold text-[var(--fg-primary)]">
                Nearby discovery is off
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
                Enable local discovery in Settings if you want nearby senders to
                appear automatically.
              </p>
            </div>
          ) : nearbyShares.length === 0 ? (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-5 py-8 text-center">
              <p className="text-base font-semibold text-[var(--fg-primary)]">
                No verified nearby shares yet
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
                Pair your device to see its active shares. For a new device,
                ask the sender to send an offer or use a receive link below.
              </p>
            </div>
          ) : (
            nearbyShares.map((share) => (
              <NearbyShareCard
                key={share.share_id}
                share={share}
                disabled={!nativeRuntime}
                onReceive={(nextShare) => void handleNearbyReceive(nextShare)}
              />
            ))
          )}
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-base font-semibold text-[var(--fg-primary)]">
              Paste a receive link instead
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--fg-secondary)]">
              Use this when the sender is not visible on the LAN or when you
              want the explicit manual path.
            </p>
          </div>
          <div
            className={`flex flex-wrap gap-2 ${mobileRuntime ? "w-full" : ""}`}
          >
            {mobileRuntime ? (
              <button
                type="button"
                onClick={() => void handleScanQr()}
                disabled={isScanning}
                className="mobile-hero-cta flex-1"
              >
                <ScanSearch className="h-5 w-5" />
                {isScanning ? "Scanning..." : "Scan QR"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handlePaste()}
              className={
                mobileRuntime
                  ? "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-4 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  : "inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-4 py-2.5 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              }
            >
              <ClipboardPaste className="h-4 w-4" />
              Paste link
            </button>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          {clipboardSuggestion ? (
            <button
              type="button"
              onClick={() => {
                setTicketInput(clipboardSuggestion);
                setClipboardSuggestion(null);
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-4 py-2.5 text-left text-sm text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            >
              <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent-primary)]" />
              <span className="min-w-0 flex-1 truncate">
                Receive link found on clipboard - tap to use it
              </span>
              <span className="shrink-0 font-mono text-xs text-[var(--fg-muted)]">
                {clipboardSuggestion.slice(0, 10)}...
              </span>
            </button>
          ) : null}
          <div className="relative">
            <textarea
              value={ticketInput}
              onChange={(event) => setTicketInput(event.target.value)}
              rows={4}
              aria-label="Receive link or raw ticket"
              aria-invalid={trimmedTicket.length > 0 && !ticketLooksValid}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste a receive link or raw blob ticket..."
              className={`w-full resize-none rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-4 py-4 pr-12 font-mono text-sm leading-6 text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${
                trimmedTicket.length === 0
                  ? ""
                  : ticketLooksValid
                    ? "border-[var(--state-success)] ring-1 ring-[var(--state-success)]/15"
                    : "border-[var(--danger-border)] ring-1 ring-[var(--danger-border)]/20"
              }`}
            />
            <div className="absolute right-3.5 top-3.5">
              {trimmedTicket.length === 0 ? null : ticketLooksValid ? (
                <CheckCircle2 className="h-5 w-5 text-[var(--state-success)]" />
              ) : (
                <XCircle className="h-5 w-5 text-[var(--danger-copy)]" />
              )}
            </div>
          </div>
          {trimmedTicket.length > 0 ? (
            <p
              role="status"
              aria-live="polite"
              className={`text-sm ${ticketLooksValid ? "text-[var(--state-success)]" : "text-[var(--danger-copy)]"}`}
            >
              {ticketLooksValid
                ? "Receive link recognized. Review the destination, then start the receive."
                : "This does not look like a valid receive link or ticket yet."}
            </p>
          ) : null}

          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--fg-muted)]">
                {smartRouting ? "Where files land" : "Export destination"}
              </p>
              {smartRouting ? (
                <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
                  Pictures save to Pictures, video to Movies, audio to Music,
                  and other files to Downloads. Each lands in a "Lightning P2P"
                  subfolder.
                </p>
              ) : (
                <p className="mt-2 break-all font-mono text-sm leading-6 text-[var(--fg-primary)]">
                  {downloadDir ?? "Resolving download directory..."}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleReceive()}
              disabled={!ticketLooksValid || !nativeRuntime}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent-primary)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[var(--accent-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-0)] disabled:cursor-not-allowed disabled:opacity-50"
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
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--fg-primary)]">
          <ArrowDownToLine className="h-4 w-4 text-[var(--accent-primary)]" />
          Active receives
        </div>

        {receiveTransfers.length === 0 ? (
          <div className="rounded-3xl border border-[var(--border-subtle)] bg-[var(--surface-0)] px-5 py-10 text-center">
            <p className="text-base font-semibold text-[var(--fg-primary)]">
              No receive transfers yet
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]">
              Accept a nearby share above or paste a receive link to begin.
            </p>
          </div>
        ) : (
          receiveTransfers.map((transfer) => (
            <TransferCard
              key={transfer.transferId}
              transfer={transfer}
              onCancel={(transferId) => void cancelTransfer(transferId)}
              onPause={(transferId) => void pauseTransfer(transferId)}
              onResume={(transferId) => void resumeTransfer(transferId)}
              onSendAnother={onNavigateSend}
            />
          ))
        )}
      </section>
    </div>
  );
}
