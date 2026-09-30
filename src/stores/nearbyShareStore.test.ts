import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NearbyShare } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  getDiscoveredShares: vi.fn(),
}));

import { getDiscoveredShares } from "../lib/tauri";
import { useNearbyShareStore } from "./nearbyShareStore";

const olderShare: NearbyShare = {
  share_id: "share-old",
  device_name: "Old snapshot",
  node_id: "peer-1",
  label: "old.bin",
  size: 1,
  hash: "old-hash",
  route_hint: "direct",
  direct_address_count: 1,
  freshness_seconds: 10,
  published_at: 1,
};

const newerShare: NearbyShare = {
  ...olderShare,
  share_id: "share-new",
  label: "current.bin",
  hash: "new-hash",
  freshness_seconds: 1,
  published_at: 2,
};

describe("nearby share snapshot reconciliation", () => {
  beforeEach(() => {
    useNearbyShareStore.setState({ shares: [] });
    vi.mocked(getDiscoveredShares).mockReset();
  });

  it("keeps a discovery event received during a refresh", async () => {
    let resolveSnapshot: ((shares: NearbyShare[]) => void) | undefined;
    vi.mocked(getDiscoveredShares).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const refresh = useNearbyShareStore.getState().refreshShares();
    useNearbyShareStore.getState().applySharesUpdated([newerShare]);
    resolveSnapshot?.([olderShare]);
    await refresh;

    expect(useNearbyShareStore.getState().shares).toEqual([newerShare]);
  });

  it("does not restore shares after the cache is cleared", async () => {
    let resolveSnapshot: ((shares: NearbyShare[]) => void) | undefined;
    vi.mocked(getDiscoveredShares).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const refresh = useNearbyShareStore.getState().refreshShares();
    useNearbyShareStore.getState().clearShares();
    resolveSnapshot?.([olderShare]);
    await refresh;

    expect(useNearbyShareStore.getState().shares).toEqual([]);
  });
});
