import type { NearbyDevice } from "./tauri";

export interface NearbyDeviceGroups {
  myDevices: NearbyDevice[];
  nearbyDevices: NearbyDevice[];
}

/** Keeps discovered targets in their input order while separating saved peers. */
export function groupNearbyDevices(
  devices: readonly NearbyDevice[],
  verifiedNodeIds: ReadonlySet<string>,
): NearbyDeviceGroups {
  const myDevices: NearbyDevice[] = [];
  const nearbyDevices: NearbyDevice[] = [];

  for (const device of devices) {
    (verifiedNodeIds.has(device.node_id) ? myDevices : nearbyDevices).push(
      device,
    );
  }

  return { myDevices, nearbyDevices };
}
