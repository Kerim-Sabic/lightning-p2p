import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActiveTransfer,
  NodeStatus,
  SharePathInfo,
  TransferEvent,
  TransferRecord,
} from "../lib/tauri";

vi.mock("../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/tauri")>();
  return {
    ...actual,
    getActiveTransfers: vi.fn(),
    getNodeStatus: vi.fn(),
    getTransferHistory: vi.fn(),
    clearTransferHistory: vi.fn(),
    describeSharePaths: vi.fn(),
    cancelSharePathScan: vi.fn().mockResolvedValue(true),
  };
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

const savedHistoryRecord: TransferRecord = {
  hash: "history-hash",
  filename: "payload.txt",
  size: 10,
  peer: "peer-1",
  timestamp: 1,
  direction: "receive",
  status: "completed",
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

function sharePath(path: string): SharePathInfo {
  return {
    path,
    name: path.split(/[\\/]/u).at(-1) ?? path,
    size: 10,
    is_dir: false,
  };
}

describe("active transfer snapshot reconciliation", () => {
  beforeEach(() => {
    useTransferStore.setState({
      transfers: {},
      error: null,
      appError: null,
      shareSelection: [],
      shareTicket: null,
      isPreparingSelection: false,
    });
    vi.mocked(tauri.getActiveTransfers).mockReset();
    vi.mocked(tauri.getTransferHistory).mockReset();
    vi.mocked(tauri.clearTransferHistory).mockReset();
    vi.mocked(tauri.describeSharePaths).mockReset();
    vi.mocked(tauri.cancelSharePathScan).mockReset();
    vi.mocked(tauri.cancelSharePathScan).mockResolvedValue(true);
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

  it("ignores late progress after a transfer completes", () => {
    useTransferStore.getState().applyTransferEvent(completedEvent());
    useTransferStore.getState().applyTransferEvent(progressEvent(40));

    expect(receivedTransfer().status).toBe("completed");
    expect(receivedTransfer().bytes).toBe(100);
  });

  it("keeps cancelled share preparation distinct from receiver completion", () => {
    useTransferStore.getState().applyTransferEvent({
      type: "started",
      transfer_id: "send-1",
      direction: "send",
      name: "Photos",
      peer: null,
      total: 100,
      route_kind: "unknown",
      phase: "preparing",
      connect_ms: 0,
      download_ms: 0,
      export_ms: 0,
      provider_count: 0,
      direct_provider_count: 0,
      relay_provider_count: 0,
      strategy: "unknown",
      first_byte_ms: 0,
      effective_mbps: 0,
    });
    useTransferStore.getState().applyTransferEvent({
      type: "failed",
      transfer_id: "send-1",
      error: "Transfer cancelled",
      route_kind: "unknown",
      phase: "cancelled",
      failure_category: "cancelled",
      error_payload: null,
    });

    const transfer = useTransferStore.getState().transfers["send-1"];
    expect(transfer?.direction).toBe("send");
    expect(transfer?.status).toBe("failed");
    expect(transfer?.phase).toBe("cancelled");
    expect(transfer?.failureCategory).toBe("cancelled");
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

  it("ignores an older refresh failure after a newer snapshot succeeds", async () => {
    let rejectOlder: ((reason: Error) => void) | undefined;
    vi.mocked(tauri.getActiveTransfers)
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOlder = reject;
        }),
      )
      .mockResolvedValueOnce([]);

    const olderRefresh = useTransferStore.getState().refreshActiveTransfers();
    await useTransferStore.getState().refreshActiveTransfers();
    rejectOlder?.(new Error("stale request failed"));
    await olderRefresh;

    expect(useTransferStore.getState().error).toBeNull();
  });
});

describe("node status snapshot reconciliation", () => {
  const directStatus: NodeStatus = {
    online: true,
    node_id: "node-1",
    relay_connected: false,
    relay_url: null,
    direct_address_count: 1,
    lan_discovery_active: true,
    online_state: "direct_ready",
  };
  const offlineStatus: NodeStatus = {
    ...directStatus,
    online: false,
    direct_address_count: 0,
    lan_discovery_active: false,
    online_state: "offline",
  };

  it("ignores an older status snapshot that resolves after a newer refresh", async () => {
    let resolveOlder: ((value: NodeStatus) => void) | undefined;
    vi.mocked(tauri.getNodeStatus)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOlder = resolve;
        }),
      )
      .mockResolvedValueOnce(directStatus);

    const olderRefresh = useTransferStore.getState().refreshNodeStatus();
    const newerRefresh = useTransferStore.getState().refreshNodeStatus();
    await newerRefresh;
    resolveOlder?.(offlineStatus);
    await olderRefresh;

    expect(useTransferStore.getState().nodeStatus).toEqual(directStatus);
  });
});

describe("transfer history snapshot reconciliation", () => {
  it("does not restore a stale snapshot after history is cleared", async () => {
    let resolveHistory: ((records: TransferRecord[]) => void) | undefined;
    vi.mocked(tauri.getTransferHistory).mockReturnValue(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    vi.mocked(tauri.clearTransferHistory).mockResolvedValue(undefined);
    useTransferStore.setState({ history: [savedHistoryRecord] });

    const staleRefresh = useTransferStore.getState().refreshHistory();
    await useTransferStore.getState().clearTransferHistory();
    resolveHistory?.([savedHistoryRecord]);
    await staleRefresh;

    expect(useTransferStore.getState().history).toEqual([]);
  });
});

describe("share selection editing", () => {
  beforeEach(() => {
    useTransferStore.setState({
      shareSelection: [],
      shareTicket: null,
      isPreparingSelection: false,
    });
    vi.mocked(tauri.describeSharePaths).mockReset();
  });

  it("appends unique paths and removes only the requested item", async () => {
    vi.mocked(tauri.describeSharePaths).mockImplementation(async (paths) =>
      paths.map(sharePath),
    );
    await useTransferStore.getState().prepareShareSelection(["first.txt"]);
    await useTransferStore
      .getState()
      .prepareShareSelection(["second.txt", "first.txt"], "append");

    expect(
      useTransferStore.getState().shareSelection.map((item) => item.path),
    ).toEqual(["first.txt", "second.txt"]);

    useTransferStore.getState().removeShareSelectionItem("first.txt");
    expect(
      useTransferStore.getState().shareSelection.map((item) => item.path),
    ).toEqual(["second.txt"]);
  });

  it("ignores an older file description after selection is cleared", async () => {
    let resolveDescription: ((items: SharePathInfo[]) => void) | undefined;
    vi.mocked(tauri.describeSharePaths).mockReturnValue(
      new Promise((resolve) => {
        resolveDescription = resolve;
      }),
    );

    const preparation = useTransferStore
      .getState()
      .prepareShareSelection(["stale.txt"]);
    const requestId = vi.mocked(tauri.describeSharePaths).mock.calls[0]?.[1];
    useTransferStore.getState().clearShareSelection();
    resolveDescription?.([sharePath("stale.txt")]);
    await preparation;

    expect(useTransferStore.getState().shareSelection).toEqual([]);
    expect(useTransferStore.getState().isPreparingSelection).toBe(false);
    expect(requestId).toBeDefined();
    expect(tauri.cancelSharePathScan).toHaveBeenCalledWith(requestId);
  });
});
