import { create } from "zustand";
import { getNearbyDevices, type NearbyDevice } from "../lib/tauri";

interface NearbyDeviceStore {
  devices: NearbyDevice[];
  refreshDevices: () => Promise<void>;
  applyDevicesUpdated: (devices: NearbyDevice[]) => void;
  clearDevices: () => void;
}

function sameDevices(left: NearbyDevice[], right: NearbyDevice[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((device, index) => {
    const next = right[index];
    if (!next) {
      return false;
    }

    return (
      device.node_id === next.node_id &&
      device.device_name === next.device_name &&
      device.last_seen_unix === next.last_seen_unix &&
      device.transport === next.transport &&
      device.route_hint === next.route_hint &&
      device.direct_address_count === next.direct_address_count &&
      device.has_active_share === next.has_active_share
    );
  });
}

export const useNearbyDeviceStore = create<NearbyDeviceStore>((set) => ({
  devices: [],

  refreshDevices: async () => {
    const devices = await getNearbyDevices();
    set((state) =>
      sameDevices(state.devices, devices) ? state : { devices },
    );
  },

  applyDevicesUpdated: (devices) => {
    set((state) =>
      sameDevices(state.devices, devices) ? state : { devices },
    );
  },

  clearDevices: () => set({ devices: [] }),
}));
