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
  outbound: Record<string, OutboundOfferStatus>;
  pushIncoming: (offer: IncomingOffer) => void;
  dismissIncoming: (offerId: string) => void;
  clearIncoming: () => void;
  recordOutbound: (status: OutboundOfferStatus) => void;
  applyOfferResolved: (resolved: OfferResolved) => void;
  clearOutbound: (offerId: string) => void;
}

export const useIncomingOfferStore = create<IncomingOfferStore>((set) => ({
  queue: [],
  outbound: {},

  pushIncoming: (offer) =>
    set((state) => {
      if (state.queue.some((existing) => existing.offer_id === offer.offer_id)) {
        return state;
      }
      return { queue: [...state.queue, offer] };
    }),

  dismissIncoming: (offerId) =>
    set((state) => ({
      queue: state.queue.filter((offer) => offer.offer_id !== offerId),
    })),

  clearIncoming: () => set({ queue: [] }),

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
