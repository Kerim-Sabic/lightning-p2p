import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTransfer, TransferEvent } from "../lib/tauri";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return { ...actual, getActiveTransfers: vi.fn() };
});

import * as tauri from "../lib/tauri";
import { useTransferStore } from "./transferStore";

const activeTransfer: ActiveTransfer = {
  transfer_id: "recv-1",
  direction: "receive",
  name: "payload.bin",
  peer: "peer-1",
  bytes: 20,
  total: 100,
  speed_bps: 4,
  route_kind: "relay",
  phase: "downloading",
  failure_category: null,
  output_path: null,
  connect_ms: 10,
  download_ms: 20,
  export_ms: 0,
  provider_count: 1,
  direct_provider_count: 0,
  relay_provider_count: 1,
  strategy: "queued_single_provider",
  first_byte_ms: 12,
  effective_mbps: 0,
};

function progressEvent(bytes: number): TransferEvent {
  return {
    type: "progress",
    transfer_id: "recv-1",
    bytes,
    total: 100,
    speed_bps: 8,
    route_kind: "direct",
    phase: "downloading",
    connect_ms: 10,
    download_ms: 20,
    export_ms: 0,
    provider_count: 1,
    direct_provider_count: 1,
    relay_provider_count: 0,
    strategy: "queued_single_provider",
    first_byte_ms: 12,
    effective_mbps: 0,
  };
}

function completedEvent(): TransferEvent {
  return {
    type: "completed",
    transfer_id: "recv-1",
    direction: "receive",
    hash: "verified-hash",
    name: "payload.bin",
    size: 100,
    peer: "peer-1",
    timestamp: 1,
    route_kind: "direct",
    phase: "completed",
    output_path: "C:/Downloads/payload.bin",
    connect_ms: 10,
    download_ms: 20,
    export_ms: 5,
    provider_count: 1,
    direct_provider_count: 1,
    relay_provider_count: 0,
    strategy: "queued_single_provider",
    first_byte_ms: 12,
    effective_mbps: 30,
  };
}

function receivedTransfer() {
  const transfer = useTransferStore.getState().transfers["recv-1"];
  if (!transfer) throw new Error("expected receive transfer to exist");
  return transfer;
}

describe("active transfer snapshot reconciliation", () => {
  beforeEach(() => {
    useTransferStore.setState({ transfers: {}, error: null, appError: null });
    vi.mocked(tauri.getActiveTransfers).mockReset();
  });

  it("does not let an in-flight snapshot roll back newer progress events", async () => {
    let resolveSnapshot: ((value: ActiveTransfer[]) => void) | undefined;
    vi.mocked(tauri.getActiveTransfers).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );

    const refresh = useTransferStore.getState().refreshActiveTransfers();
    useTransferStore.getState().applyTransferEvent(progressEvent(80));
    resolveSnapshot?.([activeTransfer]);
    await refresh;

    expect(receivedTransfer().bytes).toBe(80);
    expect(receivedTransfer().routeKind).toBe("direct");
  });

  it("keeps a completed event terminal when a snapshot still lists the transfer", async () => {
    vi.mocked(tauri.getActiveTransfers).mockResolvedValue([activeTransfer]);
    useTransferStore.getState().applyTransferEvent(completedEvent());

    await useTransferStore.getState().refreshActiveTransfers();

    expect(receivedTransfer().status).toBe("completed");
    expect(receivedTransfer().bytes).toBe(100);
  });

  it("ignores an older snapshot that resolves after a newer refresh", async () => {
    let resolveOlder: ((value: ActiveTransfer[]) => void) | undefined;
    vi.mocked(tauri.getActiveTransfers)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockResolvedValueOnce([{ ...activeTransfer, bytes: 60 }]);

    const olderRefresh = useTransferStore.getState().refreshActiveTransfers();
    const newerRefresh = useTransferStore.getState().refreshActiveTransfers();
    await newerRefresh;
    resolveOlder?.([{ ...activeTransfer, bytes: 20 }]);
    await olderRefresh;

    expect(receivedTransfer().bytes).toBe(60);
  });
});
