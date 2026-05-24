import type { TransferEntry } from "../stores/transferStore";

/**
 * Build a privacy-safe transfer summary the user can paste into bug reports
 * or share publicly. Includes route + timing metadata only — never the
 * filename, peer node id, hash, or output path, since those can identify
 * specific transfers.
 */
export function summarizeTransfer(transfer: TransferEntry): string {
  const lines = [
    "Lightning P2P transfer summary",
    `direction: ${transfer.direction}`,
    `route: ${transfer.routeKind}`,
    `providers: ${transfer.providerCount} (${transfer.directProviderCount} direct / ${transfer.relayProviderCount} relay)`,
    `strategy: ${transfer.strategy}`,
    `bytes: ${transfer.bytes}`,
    transfer.total > 0 ? `total: ${transfer.total}` : null,
    `connect_ms: ${transfer.connectMs}`,
    `first_byte_ms: ${transfer.firstByteMs}`,
    `download_ms: ${transfer.downloadMs}`,
    `export_ms: ${transfer.exportMs}`,
    transfer.effectiveMbps > 0
      ? `effective_mbps: ${transfer.effectiveMbps}`
      : null,
    `status: ${transfer.status}`,
    transfer.phase ? `phase: ${transfer.phase}` : null,
  ];
  return lines.filter((line): line is string => line !== null).join("\n");
}
