import { Check, Inbox, LaptopMinimal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatBytes } from "../lib/format";
import {
  listPairedDevices,
  respondToOffer,
  setNearbyPeerBlocked,
  type PairedDevice,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useTransferStore } from "../stores/transferStore";

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
    offerId: string;
    devices: PairedDevice[] | null;
    failed: boolean;
  } | null>(null);
  const autoCatchStarted = useRef<string | null>(null);

  const offer = queue[0];
  const offerId = offer?.offer_id;

  useEffect(() => {
    if (!offerId) return;
    let active = true;
    void listPairedDevices().then(
      (devices) => {
        if (active) {
          setPairedLookup({ offerId, devices, failed: false });
        }
      },
      () => {
        if (active) {
          setPairedLookup({ offerId, devices: null, failed: true });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [offerId]);

  useEffect(() => {
    if (!offer?.ready_to_catch || autoCatchStarted.current === offer.offer_id) {
      return;
    }
    autoCatchStarted.current = offer.offer_id;
    setPending(true);
    void respondToOffer(offer.offer_id, true, true)
      .then(() => dismissIncoming(offer.offer_id))
      .catch((error: unknown) => {
        setError(
          error instanceof Error
            ? error.message
            : "Ready to Catch could not receive this offer",
        );
        dismissIncoming(offer.offer_id);
      })
      .finally(() => {
        setPending(false);
        window.dispatchEvent(
          new CustomEvent("lightning-ready-to-catch-consumed", {
            detail: { nodeId: offer.sender_node_id },
          }),
        );
      });
  }, [dismissIncoming, offer, setError]);

  if (!offer) {
    return null;
  }

  const pairedDevices =
    pairedLookup?.offerId === offer.offer_id ? pairedLookup.devices : null;
  const pairedSender =
    pairedDevices?.find((device) => device.node_id === offer.sender_node_id) ??
    null;
  const trustLabel =
    pairedLookup?.offerId !== offer.offer_id
      ? "Checking device trust"
      : pairedLookup.failed
        ? "Trust status unavailable"
        : pairedSender
          ? "Verified device"
          : "Unverified sender";
  const senderName =
    pairedSender?.name || offer.sender_device_name || "Nearby device";
  const fileCountLabel =
    offer.file_count != null && offer.file_count > 0
      ? `${offer.file_count} file${offer.file_count === 1 ? "" : "s"}`
      : "File count unknown";
  const folderName = downloadDir
    ?.replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();

  const handleRespond = async (accept: boolean): Promise<void> => {
    setPending(true);
    try {
      await respondToOffer(offer.offer_id, accept);
      dismissIncoming(offer.offer_id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not respond to offer";
      setError(message);
      // The Rust side already cleared the offer; clear locally too so the
      // user isn't stuck on a stale modal.
      dismissIncoming(offer.offer_id);
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

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offer-prompt-title"
    >
      <article className="glass-panel w-full max-w-md p-5 shadow-2xl">
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
              {offer.label}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Sender estimates {fileCountLabel} · {formatBytes(offer.size)}
              <br />
              Save to {folderName || "your configured receive folder"}
              <br />
              {pairedSender
                ? "Name verified by your saved device pairing"
                : "Sender name is self-reported and may be spoofed"}
              · Peer{" "}
              <span className="font-mono">
                {offer.sender_node_id.slice(0, 12)}…
              </span>
            </p>
          </div>
        </div>

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
