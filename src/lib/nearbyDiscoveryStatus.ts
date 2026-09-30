import type { NearbyDiagnosticState } from "./tauri";

export type NearbyDiscoveryStatus =
  | "disabled"
  | "bluetooth_only"
  | "lan_unavailable"
  | "searching"
  | "network_blocked";

export function getNearbyDiscoveryStatus(input: {
  localEnabled: boolean;
  bluetoothEnabled: boolean;
  lanActive: boolean;
  diagnosticState: NearbyDiagnosticState;
}): NearbyDiscoveryStatus {
  if (!input.localEnabled && !input.bluetoothEnabled) return "disabled";
  if (!input.localEnabled) return "bluetooth_only";
  if (!input.lanActive) return "lan_unavailable";
  if (
    input.diagnosticState === "likely_blocked" &&
    !input.bluetoothEnabled
  ) {
    return "network_blocked";
  }
  return "searching";
}
