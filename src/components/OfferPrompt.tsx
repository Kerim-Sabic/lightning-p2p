import { Check, File, Inbox, LaptopMinimal, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { attachAsyncUnlisten } from "../hooks/asyncSubscription";
import {
  arrivalDirectionFromSenderFlick,
  type FlickDirection,
} from "../lib/flickGesture";
import { formatBytes } from "../lib/format";
import { safeDisplayText } from "../lib/safeDisplayText";
import {
  listPairedDevices,
  onPairedDevicesUpdated,
  respondToOffer,
  setNearbyPeerBlocked,
  type PairedDevice,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useTransferStore } from "../stores/transferStore";

const FLICK_ARRIVAL_OFFSETS: Record<FlickDirection, [number, number]> = {
  right: [36, 0],
  down_right: [26, 26],
  down: [0, 36],
  down_left: [-26, 26],
  left: [-36, 0],
  up_left: [-26, -26],
  up: [0, -36],
  up_right: [26, -26],
};

function arrivalLabel(direction: FlickDirection): string {
  const labels: Record<FlickDirection, string> = {
    right: "from the right",
    down_right: "from the lower right",
    down: "from below",
    down_left: "from the lower left",
    left: "from the left",
    up_left: "from the upper left",
    up: "from above",
    up_right: "from the upper right",
  };
  return labels[direction];
}

export function OfferPrompt() {
  const queue = useIncomingOfferStore((state) => state.queue);
  const dismissIncoming = useIncomingOfferStore(
    (state) => state.dismissIncoming,
  );
  const dismissFromPeer = useIncomingOfferStore(
    (state) => state.dismissFromPeer,
  );
  const setError = useTransferStore((state) => state.setError);
  const downloadDir = useTransferStore((state) => state.downloadDir);
  const [pending, setPending] = useState(false);
  const [pairedLookup, setPairedLookup] = useState<{
    offerKey: string;
    devices: PairedDevice[] | null;
    failed: boolean;
  } | null>(null);
  const autoCatchStarted = useRef<string | null>(null);
  const pairedLookupRevision = useRef(0);
  const dialogRef = useRef<HTMLElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const offer = queue[0];
  const offerKey = offer
    ? JSON.stringify([offer.sender_node_id, offer.offer_id])
    : undefined;
  const readyToCatch = offer?.ready_to_catch ?? false;

  useEffect(
    () =>
      attachAsyncUnlisten(
        onPairedDevicesUpdated((devices) => {
          pairedLookupRevision.current += 1;
          setPairedLookup((current) =>
            current ? { ...current, devices, failed: false } : current,
          );
        }),
        (error: unknown) =>
          setError(
            error instanceof Error
              ? error.message
              : "Could not subscribe to saved device updates",
          ),
      ),
    [setError],
  );

  useEffect(() => {
    if (offerKey) {
      if (
        previousFocusRef.current === null &&
        document.activeElement instanceof HTMLElement
      ) {
        previousFocusRef.current = document.activeElement;
      }
      const acceptButton = acceptButtonRef.current;
      if (readyToCatch || pending || acceptButton?.disabled) {
        dialogRef.current?.focus();
      } else {
        (acceptButton ?? dialogRef.current)?.focus();
      }
      return;
    }

    previousFocusRef.current?.focus();
    previousFocusRef.current = null;
  }, [offerKey, pending, readyToCatch]);

  useEffect(() => {
    if (!offerKey) return;
    let active = true;
    const revision = pairedLookupRevision.current;
    void listPairedDevices().then(
      (devices) => {
        if (active && revision === pairedLookupRevision.current) {
          setPairedLookup({ offerKey, devices, failed: false });
        }
      },
      () => {
        if (active && revision === pairedLookupRevision.current) {
          setPairedLookup({ offerKey, devices: null, failed: true });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [offerKey]);

  useEffect(() => {
    if (!offer?.ready_to_catch || autoCatchStarted.current === offerKey) {
      return;
    }
    autoCatchStarted.current = offerKey ?? null;
    setPending(true);
    void respondToOffer(offer.offer_id, offer.sender_node_id, true, true)
      .then(() => dismissIncoming(offer.offer_id, offer.sender_node_id))
      .catch((error: unknown) => {
        setError(
          error instanceof Error
            ? error.message
            : "Ready to Catch could not receive this offer",
        );
        dismissIncoming(offer.offer_id, offer.sender_node_id);
      })
      .finally(() => {
        setPending(false);
        window.dispatchEvent(
          new CustomEvent("lightning-ready-to-catch-consumed", {
            detail: { nodeId: offer.sender_node_id },
          }),
        );
      });
  }, [dismissIncoming, offer, offerKey, setError]);

  if (!offer) {
    return null;
  }

  const currentPairedLookup =
    pairedLookup?.offerKey === offerKey ? pairedLookup : null;
  const pairedDevices = currentPairedLookup?.devices ?? null;
  const pairedSender =
    pairedDevices?.find((device) => device.node_id === offer.sender_node_id) ??
    null;
  const trustLabel =
    !currentPairedLookup
      ? "Checking device trust"
      : currentPairedLookup.failed
        ? "Trust status unavailable"
        : pairedSender
          ? "Verified device"
          : "Unverified sender";
  const senderName = safeDisplayText(
    pairedSender?.name || offer.sender_device_name,
    "Nearby device",
  );
  const offerLabel = safeDisplayText(offer.label, "Shared item");
  const fileCountLabel =
    offer.file_count != null && offer.file_count > 0
      ? `${offer.file_count} file${offer.file_count === 1 ? "" : "s"}`
      : "File count unknown";
  const folderName = downloadDir
    ?.replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();
  const flickDirection = offer.flick_direction ?? null;
  const flickArrivalDirection = flickDirection
    ? arrivalDirectionFromSenderFlick(flickDirection)
    : null;
  const flickOffset = flickArrivalDirection
    ? FLICK_ARRIVAL_OFFSETS[flickArrivalDirection]
    : null;
  const flickArrivalStyle = flickOffset
    ? ({
        "--flick-arrival-x": `${flickOffset[0]}px`,
        "--flick-arrival-y": `${flickOffset[1]}px`,
      } as CSSProperties)
    : undefined;

  const handleRespond = async (accept: boolean): Promise<void> => {
    setPending(true);
    try {
      await respondToOffer(offer.offer_id, offer.sender_node_id, accept);
      dismissIncoming(offer.offer_id, offer.sender_node_id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not respond to offer";
      setError(message);
      // The Rust side already cleared the offer; clear locally too so the
      // user isn't stuck on a stale modal.
      dismissIncoming(offer.offer_id, offer.sender_node_id);
    } finally {
      setPending(false);
    }
  };

  const handleBlock = async (): Promise<void> => {
    setPending(true);
    try {
      await setNearbyPeerBlocked(offer.sender_node_id, true);
      dismissFromPeer(offer.sender_node_id);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not block sender",
      );
    } finally {
      setPending(false);
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!pending && !offer.ready_to_catch) void handleRespond(false);
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offer-prompt-title"
    >
      <article
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className="glass-panel w-full max-w-md p-5 shadow-2xl"
      >
        <header className="flex items-start gap-3">
          <div className="glass-icon h-12 w-12 rounded-[18px]">
            <Inbox className="h-5 w-5 text-emerald-200" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="page-eyebrow">
              {offer.ready_to_catch
                ? "Ready to Catch · receiving"
                : "Incoming offer"}
            </p>
            <h2
              id="offer-prompt-title"
              className="mt-1 truncate text-lg font-semibold text-white"
            >
              {senderName} wants to share
            </h2>
            <p
              className={`mt-1.5 inline-flex min-h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold ${
                pairedSender
                  ? "border-[color:var(--signal-green)]/30 bg-[color:var(--signal-green)]/10 text-[var(--signal-green)]"
                  : "border-[color:var(--proof-amber)]/30 bg-[color:var(--proof-amber)]/10 text-[var(--proof-amber)]"
              }`}
              role="status"
            >
              {trustLabel}
            </p>
          </div>
        </header>

        <div className="glass-subtle mt-4 flex items-start gap-3 p-4">
          <div className="glass-icon h-10 w-10 shrink-0">
            <LaptopMinimal className="h-4 w-4 text-sky-200" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {offerLabel}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Sender estimates {fileCountLabel} · {formatBytes(offer.size)}
              <br />
              Save to {folderName || "your configured receive folder"}
              <br />
              Offer details are supplied by sender · Peer{" "}
              <span className="font-mono">
                {offer.sender_node_id.slice(0, 12)}…
              </span>
            </p>
          </div>
        </div>

        {flickArrivalDirection ? (
          <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
            <span
              className="flick-arrival-file grid h-7 w-7 place-items-center rounded-lg border border-sky-300/20 bg-sky-300/10 text-sky-100"
              style={flickArrivalStyle}
              aria-hidden="true"
            >
              <File className="h-3.5 w-3.5" />
            </span>
            <span className="text-center">
              <span className="block font-medium text-slate-200">
                Arriving {arrivalLabel(flickArrivalDirection)} · approximate
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-500">
                The flick hints at the sender’s side; no location data is
                used.
              </span>
            </span>
          </div>
        ) : null}

        {queue.length > 1 ? (
          <p className="mt-3 text-[12px] text-slate-400">
            {queue.length - 1} more offer{queue.length - 1 === 1 ? "" : "s"}{" "}
            waiting after this one.
          </p>
        ) : null}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => void handleBlock()}
            disabled={pending || offer.ready_to_catch}
            className="min-h-11 rounded-xl px-3 text-sm font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline disabled:opacity-55"
          >
            Block this sender
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              ref={acceptButtonRef}
              type="button"
              onClick={() => void handleRespond(false)}
              disabled={pending || offer.ready_to_catch}
              className="glass-button inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-slate-100"
            >
              <X className="h-4 w-4" />
              Decline
            </button>
            <button
              type="button"
              onClick={() => void handleRespond(true)}
              disabled={pending || offer.ready_to_catch}
              className="btn-success inline-flex items-center justify-center gap-2 px-4 py-2.5"
            >
              <Check className="h-4 w-4" />
              {pending ? "Accepting..." : "Accept"}
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">
          Accepting starts the download into your usual receive folder.
        </p>
      </article>
    </div>
  );
}
