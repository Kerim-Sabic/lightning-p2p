import { create } from "zustand";
import type {
  ActiveTransfer,
  AppSettings,
  NearbyShare,
  NodeStatus,
  RelayMode,
  RouteKind,
  SharePathInfo,
  TransferDirection,
  TransferEvent,
  TransferRecord,
  UpdateCheckResult,
  UpdateProgress,
} from "../lib/tauri";
import * as tauri from "../lib/tauri";
import { useNearbyShareStore } from "./nearbyShareStore";

export type TransferStatus = "starting" | "running" | "completed" | "failed";
export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "upToDate"
  | "downloading"
  | "restartRequired"
  | "error";

type ProgressTransferEvent = Extract<TransferEvent, { type: "progress" }>;

export interface TransferEntry {
  transferId: string;
  direction: TransferDirection;
  name: string;
  peer: string | null;
  bytes: number;
  total: number;
  speedBps: number;
  routeKind: RouteKind;
  connectMs: number;
  downloadMs: number;
  exportMs: number;
  status: TransferStatus;
  hash: string | null;
  size: number | null;
  timestamp: number | null;
  error: string | null;
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string | null;
  availableVersion: string | null;
  body: string | null;
  date: string | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: string | null;
  lastCheckedAt: number | null;
}

interface TransferStore {
  nodeStatus: NodeStatus;
  settings: AppSettings | null;
  downloadDir: string | null;
  updateState: UpdateState;
  transfers: Record<string, TransferEntry>;
  history: TransferRecord[];
  shareSelection: SharePathInfo[];
  shareTicket: string | null;
  isSharing: boolean;
  error: string | null;
  setError: (message: string | null) => void;
  clearError: () => void;
  clearShareSelection: () => void;
  prepareShareSelection: (paths: string[]) => Promise<void>;
  pickShareFiles: () => Promise<void>;
  pickShareFolder: () => Promise<void>;
  refreshNodeStatus: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshDownloadDir: () => Promise<void>;
  refreshActiveTransfers: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  createShare: () => Promise<void>;
  startReceive: (ticket: string) => Promise<string | null>;
  startReceiveNearbyShare: (share: NearbyShare) => Promise<string | null>;
  reshare: (hash: string) => Promise<string | null>;
  cancelTransfer: (transferId: string) => Promise<void>;
  pickDownloadDir: () => Promise<void>;
  openDownloadDir: () => Promise<void>;
  setAutoUpdateEnabled: (enabled: boolean) => Promise<void>;
  setRelayMode: (relayMode: RelayMode) => Promise<void>;
  setCustomRelayUrl: (relayUrl: string | null) => Promise<void>;
  setLocalDiscoveryEnabled: (enabled: boolean) => Promise<void>;
  completeFirstRun: () => Promise<void>;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  applyTransferEvent: (event: TransferEvent) => void;
}

const defaultNodeStatus: NodeStatus = {
  online: false,
  node_id: null,
  relay_connected: false,
  relay_url: null,
  direct_address_count: 0,
  online_state: "starting",
};

const defaultUpdateState: UpdateState = {
  phase: "idle",
  currentVersion: null,
  availableVersion: null,
  body: null,
  date: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  lastCheckedAt: null,
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
    routeKind: "unknown",
    connectMs: 0,
    downloadMs: 0,
    exportMs: 0,
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
    routeKind: transfer.route_kind,
    connectMs: transfer.connect_ms,
    downloadMs: transfer.download_ms,
    exportMs: transfer.export_ms,
    status: current?.status === "starting" ? "starting" : "running",
    hash: current?.hash ?? null,
    size: current?.size ?? null,
    timestamp: current?.timestamp ?? null,
    error: current?.error ?? null,
  };
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function updateFromResult(result: UpdateCheckResult): UpdateState {
  return {
    phase: result.available ? "available" : "upToDate",
    currentVersion: result.current_version,
    availableVersion: result.version,
    body: result.body,
    date: result.date,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    lastCheckedAt: Date.now(),
  };
}

function withSettings(settings: AppSettings) {
  return {
    settings,
    downloadDir: settings.download_dir,
  };
}

async function resolveReceiveDestination(
  settings: AppSettings | null,
  downloadDir: string | null,
): Promise<{ destination: string; settings: AppSettings | null }> {
  if (settings?.download_dir) {
    return {
      destination: settings.download_dir,
      settings,
    };
  }

  if (downloadDir) {
    return {
      destination: downloadDir,
      settings,
    };
  }

  const nextSettings = await tauri.getAppSettings();
  return {
    destination: nextSettings.download_dir,
    settings: nextSettings,
  };
}

function updateDownloadProgress(
  current: UpdateState,
  progress: UpdateProgress,
): UpdateState {
  return {
    ...current,
    phase: "downloading",
    downloadedBytes: progress.downloaded_bytes,
    totalBytes: progress.total_bytes,
    error: null,
  };
}

function sameNodeStatus(left: NodeStatus, right: NodeStatus): boolean {
  return (
    left.online === right.online &&
    left.node_id === right.node_id &&
    left.relay_connected === right.relay_connected &&
    left.relay_url === right.relay_url &&
    left.direct_address_count === right.direct_address_count &&
    left.online_state === right.online_state
  );
}

function sameSettings(left: AppSettings, right: AppSettings): boolean {
  return (
    left.download_dir === right.download_dir &&
    left.auto_update_enabled === right.auto_update_enabled &&
    left.first_run_complete === right.first_run_complete &&
    left.relay_mode === right.relay_mode &&
    left.custom_relay_url === right.custom_relay_url &&
    left.local_discovery_enabled === right.local_discovery_enabled
  );
}

function sameTransferProgress(
  current: TransferEntry,
  event: ProgressTransferEvent,
): boolean {
  return (
    current.bytes === event.bytes &&
    current.total === event.total &&
    current.speedBps === event.speed_bps &&
    current.routeKind === event.route_kind &&
    current.connectMs === event.connect_ms &&
    current.downloadMs === event.download_ms &&
    current.exportMs === event.export_ms &&
    current.status === "running" &&
    current.error === null
  );
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  nodeStatus: defaultNodeStatus,
  settings: null,
  downloadDir: null,
  updateState: defaultUpdateState,
  transfers: {},
  history: [],
  shareSelection: [],
  shareTicket: null,
  isSharing: false,
  error: null,

  setError: (message) => set({ error: message }),
  clearError: () => set({ error: null }),
  clearShareSelection: () => {
    set({
      shareSelection: [],
      shareTicket: null,
      isSharing: false,
    });
    if (tauri.isDesktopRuntime()) {
      void tauri.clearActiveShare().catch((error: unknown) => {
        set({ error: toErrorMessage(error) });
      });
    }
  },

  prepareShareSelection: async (paths) => {
    set({ error: null, shareTicket: null, isSharing: false });
    try {
      if (tauri.isDesktopRuntime()) {
        await tauri.clearActiveShare();
      }
      const shareSelection = await tauri.describeSharePaths(uniquePaths(paths));
      set({ shareSelection });
    } catch (error) {
      set({ error: toErrorMessage(error), shareSelection: [] });
    }
  },

  pickShareFiles: async () => {
    try {
      const files = await tauri.pickShareFiles();
      if (files.length === 0) {
        return;
      }

      await get().prepareShareSelection(files);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  pickShareFolder: async () => {
    try {
      const folder = await tauri.pickShareFolder();
      if (!folder) {
        return;
      }

      await get().prepareShareSelection([folder]);
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshNodeStatus: async () => {
    try {
      const nodeStatus = await tauri.getNodeStatus();
      set((state) =>
        sameNodeStatus(state.nodeStatus, nodeStatus) ? state : { nodeStatus },
      );
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshSettings: async () => {
    try {
      const [settings, currentVersion] = await Promise.all([
        tauri.getAppSettings(),
        tauri.getAppVersion(),
      ]);
      set((state) => {
        const settingsChanged =
          state.settings === null || !sameSettings(state.settings, settings);
        const versionChanged =
          state.updateState.currentVersion !== currentVersion;

        if (!settingsChanged && !versionChanged) {
          return state;
        }

        return {
          ...(settingsChanged ? withSettings(settings) : {}),
          ...(versionChanged
            ? {
                updateState: {
                  ...state.updateState,
                  currentVersion,
                },
              }
            : {}),
        };
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  refreshDownloadDir: async () => {
    try {
      const settings = await tauri.getAppSettings();
      set(withSettings(settings));
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
      const resolved = await resolveReceiveDestination(
        get().settings,
        get().downloadDir,
      );
      if (resolved.settings) {
        set(withSettings(resolved.settings));
      }
      const destination = resolved.destination;
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

  startReceiveNearbyShare: async (share) => {
    set({ error: null });

    try {
      const resolved = await resolveReceiveDestination(
        get().settings,
        get().downloadDir,
      );
      if (resolved.settings) {
        set(withSettings(resolved.settings));
      }
      const destination = resolved.destination;
      const transferId = await tauri.startReceiveDiscoveredShare(
        share.share_id,
        destination,
      );
      set((state) => ({
        transfers: {
          ...state.transfers,
          [transferId]:
            state.transfers[transferId] ??
            createTransferEntry(
              transferId,
              "receive",
              share.label,
              share.node_id,
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

  pickDownloadDir: async () => {
    try {
      const selected = await tauri.pickDirectory(
        get().downloadDir ?? undefined,
      );
      if (!selected) {
        return;
      }

      const settings = await tauri.setDownloadDir(selected);
      set(withSettings(settings));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  openDownloadDir: async () => {
    try {
      await tauri.openDownloadDir();
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setAutoUpdateEnabled: async (enabled) => {
    try {
      const settings = await tauri.setAutoUpdateEnabled(enabled);
      set(withSettings(settings));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setRelayMode: async (relayMode) => {
    try {
      const settings = await tauri.setRelayMode(relayMode);
      set(withSettings(settings));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setCustomRelayUrl: async (relayUrl) => {
    try {
      const settings = await tauri.setCustomRelayUrl(relayUrl);
      set(withSettings(settings));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setLocalDiscoveryEnabled: async (enabled) => {
    try {
      const settings = await tauri.setLocalDiscoveryEnabled(enabled);
      set(withSettings(settings));
      if (!enabled) {
        useNearbyShareStore.getState().clearShares();
      }
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  completeFirstRun: async () => {
    try {
      const settings = await tauri.completeFirstRun();
      set(withSettings(settings));
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  checkForUpdates: async (silent = false) => {
    set((state) => ({
      updateState: {
        ...state.updateState,
        phase: "checking",
        error: null,
      },
    }));

    try {
      const result = await tauri.checkForAppUpdate();
      set({ updateState: updateFromResult(result) });
    } catch (error) {
      if (silent) {
        set((state) => ({
          updateState: {
            ...state.updateState,
            phase: "idle",
            error: null,
          },
        }));
        return;
      }

      set((state) => ({
        updateState: {
          ...state.updateState,
          phase: "error",
          error: toErrorMessage(error),
          lastCheckedAt: Date.now(),
        },
      }));
    }
  },

  installUpdate: async () => {
    set((state) => ({
      updateState: {
        ...state.updateState,
        phase: "downloading",
        error: null,
      },
    }));

    try {
      await tauri.installAppUpdate((progress) => {
        set((state) => ({
          updateState: updateDownloadProgress(state.updateState, progress),
        }));
      });

      set((state) => ({
        updateState: {
          ...state.updateState,
          phase: "restartRequired",
          downloadedBytes:
            state.updateState.totalBytes ?? state.updateState.downloadedBytes,
          error: null,
        },
      }));
    } catch (error) {
      set((state) => ({
        updateState: {
          ...state.updateState,
          phase: "error",
          error: toErrorMessage(error),
        },
      }));
    }
  },

  applyTransferEvent: (event) => {
    set((state) => {
      if (event.type === "started") {
        const transfers = { ...state.transfers };
        transfers[event.transfer_id] = {
          transferId: event.transfer_id,
          direction: event.direction,
          name: event.name,
          peer: event.peer,
          bytes: 0,
          total: event.total,
          speedBps: 0,
          routeKind: event.route_kind,
          connectMs: event.connect_ms,
          downloadMs: event.download_ms,
          exportMs: event.export_ms,
          status: "starting",
          hash: null,
          size: null,
          timestamp: null,
          error: null,
        };
        return { transfers };
      } else if (event.type === "progress") {
        const current =
          state.transfers[event.transfer_id] ??
          createTransferEntry(
            event.transfer_id,
            "receive",
            event.transfer_id,
            null,
          );

        if (
          state.transfers[event.transfer_id] &&
          sameTransferProgress(current, event)
        ) {
          return state;
        }

        return {
          transfers: {
            ...state.transfers,
            [event.transfer_id]: {
              ...current,
              bytes: event.bytes,
              total: event.total,
              speedBps: event.speed_bps,
              routeKind: event.route_kind,
              connectMs: event.connect_ms,
              downloadMs: event.download_ms,
              exportMs: event.export_ms,
              status: "running",
              error: null,
            },
          },
        };
      } else if (event.type === "completed") {
        const transfers = { ...state.transfers };
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
          routeKind: event.route_kind,
          connectMs: event.connect_ms,
          downloadMs: event.download_ms,
          exportMs: event.export_ms,
          status: "completed",
          hash: event.hash,
          size: event.size,
          timestamp: event.timestamp,
          error: null,
        };
        return { transfers };
      } else {
        const transfers = { ...state.transfers };
        const current =
          transfers[event.transfer_id] ??
          createTransferEntry(
            event.transfer_id,
            "receive",
            event.transfer_id,
            null,
          );
        transfers[event.transfer_id] = {
          ...current,
          routeKind: event.route_kind,
          status: "failed",
          error: event.error,
        };
        return { transfers };
      }
    });
  },
}));
