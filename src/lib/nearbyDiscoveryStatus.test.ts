import { describe, expect, it } from "vitest";
import { getNearbyDiscoveryStatus } from "./nearbyDiscoveryStatus";

describe("getNearbyDiscoveryStatus", () => {
  it("does not blame the network when LAN discovery is inactive", () => {
    expect(
      getNearbyDiscoveryStatus({
        localEnabled: true,
        bluetoothEnabled: false,
        lanActive: false,
        diagnosticState: "likely_blocked",
      }),
    ).toBe("lan_unavailable");
  });

  it("reports a likely network block only after active LAN discovery", () => {
    expect(
      getNearbyDiscoveryStatus({
        localEnabled: true,
        bluetoothEnabled: false,
        lanActive: true,
        diagnosticState: "likely_blocked",
      }),
    ).toBe("network_blocked");
  });

  it("keeps Bluetooth-only and disabled states distinct", () => {
    expect(
      getNearbyDiscoveryStatus({
        localEnabled: false,
        bluetoothEnabled: true,
        lanActive: false,
        diagnosticState: "searching",
      }),
    ).toBe("bluetooth_only");
    expect(
      getNearbyDiscoveryStatus({
        localEnabled: false,
        bluetoothEnabled: false,
        lanActive: false,
        diagnosticState: "searching",
      }),
    ).toBe("disabled");
  });
});
