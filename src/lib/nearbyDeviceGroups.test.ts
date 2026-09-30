import { describe, expect, it } from "vitest";
import type { NearbyDevice } from "./tauri";
import { groupNearbyDevices } from "./nearbyDeviceGroups";

const device = (node_id: string): NearbyDevice => ({
  node_id,
  device_name: node_id,
  last_seen_unix: 1,
  transport: "wifi_mdns",
  route_hint: "direct",
  direct_address_count: 1,
  has_active_share: false,
});

describe("groupNearbyDevices", () => {
  it("separates saved peers without changing order within either group", () => {
    const devices = [device("nearby-a"), device("my-b"), device("my-a"), device("nearby-b")];

    const groups = groupNearbyDevices(
      devices,
      new Set(["my-a", "my-b", "offline-saved-device"]),
    );

    expect(groups.myDevices.map(({ node_id }) => node_id)).toEqual([
      "my-b",
      "my-a",
    ]);
    expect(groups.nearbyDevices.map(({ node_id }) => node_id)).toEqual([
      "nearby-a",
      "nearby-b",
    ]);
  });

  it("does not classify a discovered peer as saved without verified identity", () => {
    const groups = groupNearbyDevices([device("unverified")], new Set());

    expect(groups.myDevices).toEqual([]);
    expect(groups.nearbyDevices).toHaveLength(1);
  });
});
