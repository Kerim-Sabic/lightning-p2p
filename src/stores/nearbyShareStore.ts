import { create } from "zustand";
import { getDiscoveredShares, type NearbyShare } from "../lib/tauri";

interface NearbyShareStore {
  shares: NearbyShare[];
  refreshShares: () => Promise<void>;
  applySharesUpdated: (shares: NearbyShare[]) => void;
  clearShares: () => void;
}

function sameShares(left: NearbyShare[], right: NearbyShare[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((share, index) => {
    const next = right[index];
    if (!next) {
      return false;
    }

    return (
      share.share_id === next.share_id &&
      share.device_name === next.device_name &&
      share.node_id === next.node_id &&
      share.label === next.label &&
      share.size === next.size &&
      share.hash === next.hash &&
      share.route_hint === next.route_hint &&
      share.direct_address_count === next.direct_address_count &&
      share.freshness_seconds === next.freshness_seconds &&
      share.published_at === next.published_at
    );
  });
}

export const useNearbyShareStore = create<NearbyShareStore>((set) => ({
  shares: [],

  refreshShares: async () => {
    const shares = await getDiscoveredShares();
    set((state) => (sameShares(state.shares, shares) ? state : { shares }));
  },

  applySharesUpdated: (shares) => {
    set((state) => (sameShares(state.shares, shares) ? state : { shares }));
  },

  clearShares: () => set({ shares: [] }),
}));
