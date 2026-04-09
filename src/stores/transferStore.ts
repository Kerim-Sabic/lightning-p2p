import { create } from "zustand";
import type {
  ActiveTransfer,
  NodeStatus,
  SharePathInfo,
  TransferDirection,
  TransferEvent,
  TransferRecord,
} from "../lib/tauri";
import * as tauri from "../lib/tauri";

export type TransferStatus = "starting" | "running" | "completed" | "failed";

export interface TransferEntry {
  transferId: string;
  direction: TransferDirection;
  name: string;
  peer: string | null;
  bytes: number;
  total: number;
  speedBps: number;
  status: TransferStatus;
  hash: string | null;
  size: number | null;
  timestamp: number | null;
  error: string | null;
}

interface TransferStore {
  nodeStatus: NodeStatus;
  downloadDir: string | null;
  transfers: Record<string, TransferEntry>;
  history: TransferRecord[];
  shareSelection: SharePathInfo[];
  shareTicket: string | null;
  isSharing: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  clearError: () => void;
  prepareShareSelection: (paths: string[]) => Promise<void>;
  refreshNodeStatus: () => Promise<void>;
  refreshDownloadDir: () => Promise<void>;
  refreshActiveTransfers: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  createShare: () => Promise<void>;
  startReceive: (ticket: string) => Promise<string | null>;
  reshare: (hash: string) => Promise<string | null>;
  cancelTransfer: (transferId: string) => Promise<void>;
  applyTransferEvent: (event: TransferEvent) => void;
}

const defaultNodeStatus: NodeStatus = {
  online: false,
  node_id: null,
};

function toErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unexpected error";
}

function isNodePendingError(message: string): boolean {
  return message.includes("Node not initialized yet");
}

function createTransferEntry(
  transferId: string,
  direction: TransferDirection,
  name: string,
  peer: string | null,
): TransferEntry {
  return {
    transferId,
    direction,
    name,
    peer,
    bytes: 0,
    total: 0,
    speedBps: 0,
    status: "starting",
    hash: null,
    size: null,
    timestamp: null,
    error: null,
  };
}

function mergeActiveTransfer(
  current: TransferEntry | undefined,
  transfer: ActiveTransfer,
): TransferEntry {
  return {
    transferId: transfer.transfer_id,
    direction: transfer.direction,
    name: transfer.name,
    peer: transfer.peer,
    bytes: transfer.bytes,
    total: transfer.total,
    speedBps: transfer.speed_bps,
    status: current?.status === "starting" ? "starting" : "running",
    hash: current?.hash ?? null,
    size: current?.size ?? null,
    timestamp: current?.timestamp ?? null,
    error: current?.error ?? null,
  };
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  nodeStatus: defaultNodeStatus,
  downloadDir: null,
  transfers: {},
  history: [],
  shareSelection: [],
  shareTicket: null,
  isSharing: false,
  error: null,

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),

  prepareShareSelection: async (paths) => {
    set({ error: null, shareTicket: null, isSharing: false });
    try {
      const shareSelection = await tauri.describeSharePaths(paths);
      set({ shareSelection });
    } catch (error) {
      set({ error: toErrorMessage(error), shareSelection: [] });
    }
  },

  refreshNodeStatus: async () => {
    try {
      const nodeStatus = await tauri.getNodeStatus();
      set({ nodeStatus });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshDownloadDir: async () => {
    try {
      const downloadDir = await tauri.getDownloadDir();
      set({ downloadDir });
    } catch (error) {
      const message = toErrorMessage(error);
      if (!isNodePendingError(message)) {
        set({ error: message });
      }
    }
  },

  refreshActiveTransfers: async () => {
    try {
      const activeTransfers = await tauri.getActiveTransfers();
      set((state) => {
        const transfers = { ...state.transfers };
        for (const transfer of activeTransfers) {
          transfers[transfer.transfer_id] = mergeActiveTransfer(
            transfers[transfer.transfer_id],
            transfer,
          );
        }
        return { transfers };
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshHistory: async () => {
    try {
      const history = await tauri.getTransferHistory();
      set({ history });
    } catch (error) {
      const message = toErrorMessage(error);
      if (!isNodePendingError(message)) {
        set({ error: message });
      }
    }
  },

  createShare: async () => {
    const paths = get().shareSelection.map((item) => item.path);
    if (paths.length === 0) {
      return;
    }

    set({
      error: null,
      isSharing: true,
      shareTicket: null,
    });

    try {
      const shareTicket = await tauri.createShare(paths);
      set({ shareTicket });
      await get().refreshHistory();
    } catch (error) {
      set({ error: toErrorMessage(error) });
    } finally {
      set({ isSharing: false });
    }
  },

  startReceive: async (ticket) => {
    set({ error: null });

    try {
      let destination = get().downloadDir;
      if (!destination) {
        destination = await tauri.getDownloadDir();
        set({ downloadDir: destination });
      }

      const transferId = await tauri.startReceive(ticket, destination);
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]:
            state.transfers[transferId] ??
            createTransferEntry(
              transferId,
              "receive",
              "Preparing download",
              null,
            ),
        },
      }));
      return transferId;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return null;
    }
  },

  reshare: async (hash) => {
    set({ error: null });

    try {
      const shareTicket = await tauri.getTicket(hash);
      set({ shareTicket });
      return shareTicket;
    } catch (error) {
      set({ error: toErrorMessage(error) });
      return null;
    }
  },

  cancelTransfer: async (transferId) => {
    try {
      await tauri.cancelTransfer(transferId);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  applyTransferEvent: (event) => {
    set((state) => {
      const transfers = { ...state.transfers };

      if (event.type === "started") {
        transfers[event.transfer_id] = {
          transferId: event.transfer_id,
          direction: event.direction,
          name: event.name,
          peer: event.peer,
          bytes: 0,
          total: event.total,
          speedBps: 0,
          status: "starting",
          hash: null,
          size: null,
          timestamp: null,
          error: null,
        };
      } else if (event.type === "progress") {
        const current =
          transfers[event.transfer_id] ??
          createTransferEntry(event.transfer_id, "receive", event.transfer_id, null);
        transfers[event.transfer_id] = {
          ...current,
          bytes: event.bytes,
          total: event.total,
          speedBps: event.speed_bps,
          status: "running",
          error: null,
        };
      } else if (event.type === "completed") {
        const current =
          transfers[event.transfer_id] ??
          createTransferEntry(
            event.transfer_id,
            event.direction,
            event.name,
            event.peer,
          );
        transfers[event.transfer_id] = {
          ...current,
          direction: event.direction,
          name: event.name,
          peer: event.peer,
          bytes: event.size,
          total: event.size,
          speedBps: current.speedBps,
          status: "completed",
          hash: event.hash,
          size: event.size,
          timestamp: event.timestamp,
          error: null,
        };
      } else {
        const current =
          transfers[event.transfer_id] ??
          createTransferEntry(event.transfer_id, "receive", event.transfer_id, null);
        transfers[event.transfer_id] = {
          ...current,
          status: "failed",
          error: event.error,
        };
      }

      return { transfers };
    });
  },
}));
