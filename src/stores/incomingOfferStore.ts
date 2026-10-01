import { create } from "zustand";
import { type IncomingOffer, type OfferResolved } from "../lib/tauri";

interface OutboundOfferStatus {
  offerId: string;
  receiverNodeId: string | null;
  status: "pending" | "accepted" | "rejected" | "expired" | "error";
  message: string | null;
  updatedAt: number;
}

interface IncomingOfferStore {
  // FIFO queue of inbound offers awaiting a user decision. We show one at a
  // time — the head of the queue — so a burst of offers from a malicious or
  // confused sender cannot drown the UI.
  queue: IncomingOffer[];
  dismissedOfferKeys: Record<string, number>;
  outbound: Record<string, OutboundOfferStatus>;
  pushIncoming: (offer: IncomingOffer) => void;
  applyIncomingSnapshot: (offers: readonly IncomingOffer[]) => void;
  dismissIncoming: (offerId: string, senderNodeId: string) => void;
  dismissFromPeer: (nodeId: string) => void;
  clearIncoming: () => void;
  recordOutbound: (status: OutboundOfferStatus) => void;
  applyOfferResolved: (resolved: OfferResolved) => void;
  clearOutbound: (offerId: string) => void;
}

const DISMISSED_OFFER_TTL_MS = 60_000;
const MAX_DISMISSED_OFFER_KEYS = 128;

function incomingOfferKey(offerId: string, senderNodeId: string): string {
  return JSON.stringify([senderNodeId, offerId]);
}

function pruneDismissedKeys(
  keys: Record<string, number>,
  now: number,
): Record<string, number> {
  const retained = Object.entries(keys).filter(([, expiresAt]) => expiresAt > now);
  return Object.fromEntries(retained.slice(-MAX_DISMISSED_OFFER_KEYS));
}

function rememberDismissedKeys(
  existing: Record<string, number>,
  keys: readonly string[],
  now: number,
): Record<string, number> {
  const next = pruneDismissedKeys(existing, now);
  for (const key of keys) next[key] = now + DISMISSED_OFFER_TTL_MS;
  return pruneDismissedKeys(next, now);
}

export const useIncomingOfferStore = create<IncomingOfferStore>((set) => ({
  queue: [],
  dismissedOfferKeys: {},
  outbound: {},

  pushIncoming: (offer) =>
    set((state) => {
      const now = Date.now();
      const dismissedOfferKeys = pruneDismissedKeys(
        state.dismissedOfferKeys,
        now,
      );
      if (
        dismissedOfferKeys[incomingOfferKey(offer.offer_id, offer.sender_node_id)]
      ) {
        return { dismissedOfferKeys };
      }
      if (
        state.queue.some(
          (existing) =>
            existing.offer_id === offer.offer_id &&
            existing.sender_node_id === offer.sender_node_id,
        )
      ) {
        return Object.keys(dismissedOfferKeys).length ===
          Object.keys(state.dismissedOfferKeys).length
          ? state
          : { dismissedOfferKeys };
      }
      return { queue: [...state.queue, offer], dismissedOfferKeys };
    }),

  applyIncomingSnapshot: (offers) =>
    set((state) => {
      const now = Date.now();
      const dismissedOfferKeys = pruneDismissedKeys(
        state.dismissedOfferKeys,
        now,
      );
      const known = new Set(
        state.queue.map((item) => incomingOfferKey(item.offer_id, item.sender_node_id)),
      );
      const reconciled = [...state.queue];
      for (const offer of [...offers].sort(
        (left, right) => left.received_at_unix - right.received_at_unix,
      )) {
        const key = incomingOfferKey(offer.offer_id, offer.sender_node_id);
        if (dismissedOfferKeys[key] || known.has(key)) continue;
        known.add(key);
        reconciled.push(offer);
      }
      return { queue: reconciled, dismissedOfferKeys };
    }),

  dismissIncoming: (offerId, senderNodeId) =>
    set((state) => {
      const key = incomingOfferKey(offerId, senderNodeId);
      return {
        queue: state.queue.filter(
          (offer) =>
            offer.offer_id !== offerId || offer.sender_node_id !== senderNodeId,
        ),
        dismissedOfferKeys: rememberDismissedKeys(
          state.dismissedOfferKeys,
          [key],
          Date.now(),
        ),
      };
    }),

  dismissFromPeer: (nodeId) =>
    set((state) => {
      const dismissed = state.queue
        .filter((offer) => offer.sender_node_id === nodeId)
        .map((offer) => incomingOfferKey(offer.offer_id, offer.sender_node_id));
      return {
        queue: state.queue.filter((offer) => offer.sender_node_id !== nodeId),
        dismissedOfferKeys: rememberDismissedKeys(
          state.dismissedOfferKeys,
          dismissed,
          Date.now(),
        ),
      };
    }),

  clearIncoming: () => set({ queue: [], dismissedOfferKeys: {} }),

  recordOutbound: (status) =>
    set((state) => ({
      outbound: { ...state.outbound, [status.offerId]: status },
    })),

  applyOfferResolved: (resolved) =>
    set((state) => {
      const existing = state.outbound[resolved.offer_id];
      return {
        outbound: {
          ...state.outbound,
          [resolved.offer_id]: {
            offerId: resolved.offer_id,
            receiverNodeId: resolved.receiver_node_id,
            status: resolved.outcome,
            message: existing?.message ?? null,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearOutbound: (offerId) =>
    set((state) => {
      if (!state.outbound[offerId]) {
        return state;
      }
      const next = Object.fromEntries(
        Object.entries(state.outbound).filter(([key]) => key !== offerId),
      );
      return { outbound: next };
    }),
}));
