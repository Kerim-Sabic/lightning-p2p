import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NearbyDevice } from "../lib/tauri";

vi.mock("../lib/tauri", () => ({
  getNearbyDevices: vi.fn(),
}));

import { getNearbyDevices } from "../lib/tauri";
import { useNearbyDeviceStore } from "./nearbyDeviceStore";

const olderDevice: NearbyDevice = {
  node_id: "peer-old",
  device_name: "Old snapshot",
  last_seen_unix: 1,
  transport: "wifi_mdns",
  route_hint: "direct",
  direct_address_count: 1,
  has_active_share: false,
};

const newerDevice: NearbyDevice = {
  ...olderDevice,
  node_id: "peer-new",
  device_name: "Current device",
  last_seen_unix: 2,
};

describe("nearby device snapshot reconciliation", () => {
  beforeEach(() => {
    useNearbyDeviceStore.setState({ devices: [] });
    vi.mocked(getNearbyDevices).mockReset();
  });

  it("keeps a discovery event received during a refresh", async () => {
    let resolveSnapshot: ((devices: NearbyDevice[]) => void) | undefined;
    vi.mocked(getNearbyDevices).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const refresh = useNearbyDeviceStore.getState().refreshDevices();
    useNearbyDeviceStore.getState().applyDevicesUpdated([newerDevice]);
    resolveSnapshot?.([olderDevice]);
    await refresh;

    expect(useNearbyDeviceStore.getState().devices).toEqual([newerDevice]);
  });

  it("ignores an older refresh that resolves after a newer one", async () => {
    let resolveOlder: ((devices: NearbyDevice[]) => void) | undefined;
    vi.mocked(getNearbyDevices)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockResolvedValueOnce([newerDevice]);

    const olderRefresh = useNearbyDeviceStore.getState().refreshDevices();
    await useNearbyDeviceStore.getState().refreshDevices();
    resolveOlder?.([olderDevice]);
    await olderRefresh;

    expect(useNearbyDeviceStore.getState().devices).toEqual([newerDevice]);
  });

  it("does not repopulate devices after the cache is cleared", async () => {
    let resolveSnapshot: ((devices: NearbyDevice[]) => void) | undefined;
    vi.mocked(getNearbyDevices).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const refresh = useNearbyDeviceStore.getState().refreshDevices();
    useNearbyDeviceStore.getState().clearDevices();
    resolveSnapshot?.([olderDevice]);
    await refresh;

    expect(useNearbyDeviceStore.getState().devices).toEqual([]);
  });
});
