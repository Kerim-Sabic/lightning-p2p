import { describe, expect, it } from "vitest";
import type { TransferEntry } from "../stores/transferStore";
import { summarizeTransfer } from "./transferSummary";

function buildTransfer(overrides: Partial<TransferEntry> = {}): TransferEntry {
  return {
    transferId: "tx-1",
    direction: "receive",
    name: "ultra-secret-design.psd",
    peer: "node-abc123",
    bytes: 1_073_741_824,
    total: 1_073_741_824,
    speedBps: 0,
    routeKind: "direct",
    phase: "completed",
    failureCategory: null,
    outputPath: "C:/Users/kerim/Downloads/ultra-secret-design.psd",
    connectMs: 412,
    downloadMs: 18_733,
    exportMs: 642,
    providerCount: 1,
    directProviderCount: 1,
    relayProviderCount: 0,
    strategy: "queued_single_provider",
    firstByteMs: 188,
    effectiveMbps: 458,
    status: "completed",
    hash: "blake3:abc",
    size: 1_073_741_824,
    timestamp: 1_716_000_000,
    error: null,
    appError: null,
    retryTicket: "fd2:secret-retry-ticket",
    ...overrides,
  };
}

describe("summarizeTransfer", () => {
  it("includes route, providers, timing, and status", () => {
    const summary = summarizeTransfer(buildTransfer());

    expect(summary).toContain("direction: receive");
    expect(summary).toContain("route: direct");
    expect(summary).toContain("providers: 1 (1 direct / 0 relay)");
    expect(summary).toContain("strategy: queued_single_provider");
    expect(summary).toContain("first_byte_ms: 188");
    expect(summary).toContain("effective_mbps: 458");
    expect(summary).toContain("status: completed");
    expect(summary).toContain("phase: completed");
  });

  it("never leaks filename, peer id, hash, or output path", () => {
    const transfer = buildTransfer();
    const summary = summarizeTransfer(transfer);

    expect(summary).not.toContain(transfer.name);
    expect(summary).not.toContain(transfer.peer as string);
    expect(summary).not.toContain(transfer.hash as string);
    expect(summary).not.toContain(transfer.outputPath as string);
    expect(summary).not.toContain(transfer.retryTicket as string);
  });

  it("omits effective_mbps when not measured", () => {
    const summary = summarizeTransfer(
      buildTransfer({ effectiveMbps: 0, total: 0 }),
    );
    expect(summary).not.toContain("effective_mbps");
    expect(summary).not.toContain("total:");
  });
});
