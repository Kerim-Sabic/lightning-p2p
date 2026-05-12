import { Check, Inbox, LaptopMinimal, X } from "lucide-react";
import { useState } from "react";
import { formatBytes } from "../lib/format";
import { respondToOffer } from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useTransferStore } from "../stores/transferStore";

export function OfferPrompt() {
  const queue = useIncomingOfferStore((state) => state.queue);
  const dismissIncoming = useIncomingOfferStore(
    (state) => state.dismissIncoming,
  );
  const setError = useTransferStore((state) => state.setError);
  const [pending, setPending] = useState(false);

  const offer = queue[0];

  if (!offer) {
    return null;
  }

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
            <p className="page-eyebrow">Incoming offer</p>
            <h2
              id="offer-prompt-title"
              className="mt-1 truncate text-lg font-semibold text-white"
            >
              {offer.sender_device_name} wants to send you a file
            </h2>
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
              {formatBytes(offer.size)} | from{" "}
              <span className="font-mono">
                {offer.sender_node_id.slice(0, 12)}...
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

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => void handleRespond(false)}
            disabled={pending}
            className="glass-button inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm text-slate-100"
          >
            <X className="h-4 w-4" />
            Decline
          </button>
          <button
            type="button"
            onClick={() => void handleRespond(true)}
            disabled={pending}
            className="btn-success inline-flex items-center justify-center gap-2 px-4 py-2.5"
          >
            <Check className="h-4 w-4" />
            {pending ? "Accepting..." : "Accept"}
          </button>
        </div>

        <p className="mt-3 text-[11px] text-slate-500">
          Accepting starts the download into your usual receive folder.
        </p>
      </article>
    </div>
  );
}
