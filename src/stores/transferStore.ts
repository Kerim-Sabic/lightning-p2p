import { create } from "zustand";
import {
  messageFromAppError,
  normalizeAppError,
  type AppError,
} from "../lib/appErrors";
import type {
  ActiveTransfer,
  AppSettings,
  BleDiscoveryStatus,
  NearbyShare,
  NodeSupervisorStatus,
  NodeStatus,
  RelayMode,
  RouteKind,
  SharePathInfo,
  TransferDirection,
  TransferEvent,
  TransferStrategy,
  FailureCategory,
  PlatformProfile,
  TransferPhase,
  TransferRecord,
  UpdateCheckResult,
  UpdateProgress,
} from "../lib/tauri";
import * as tauri from "../lib/tauri";
import { useNearbyDeviceStore } from "./nearbyDeviceStore";
import { useNearbyShareStore } from "./nearbyShareStore";
import { mergeFailedTransferEvent } from "./transferEventMapping";

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
  phase: TransferPhase;
  failureCategory: FailureCategory | null;
  outputPath: string | null;
  connectMs: number;
  downloadMs: number;
  exportMs: number;
  providerCount: number;
  directProviderCount: number;
  relayProviderCount: number;
  strategy: TransferStrategy;
  firstByteMs: number;
  effectiveMbps: number;
  status: TransferStatus;
  hash: string | null;
  size: number | null;
  timestamp: number | null;
  error: string | null;
  appError: AppError | null;
  retryTicket: string | null;
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
  nodeSupervisorStatus: NodeSupervisorStatus;
  bleDiscoveryStatus: BleDiscoveryStatus;
  platformProfile: PlatformProfile;
  settings: AppSettings | null;
  downloadDir: string | null;
  updateState: UpdateState;
  transfers: Record<string, TransferEntry>;
  history: TransferRecord[];
  shareSelection: SharePathInfo[];
  shareTicket: string | null;
  isSharing: boolean;
  isPreparingSelection: boolean;
  error: string | null;
  appError: AppError | null;
  errorQueue: AppError[];
  pendingReceiveTicket: string | null;
  setPendingReceiveTicket: (ticket: string | null) => void;
  consumePendingReceiveTicket: () => string | null;
  setError: (message: string | null) => void;
  setAppError: (error: unknown | null) => void;
  clearError: () => void;
  clearShareSelection: () => void;
  prepareShareSelection: (paths: string[]) => Promise<void>;
  pickShareFiles: () => Promise<void>;
  pickShareFolder: () => Promise<void>;
  refreshNodeStatus: () => Promise<void>;
  refreshNodeSupervisorStatus: () => Promise<void>;
  refreshBleDiscoveryStatus: () => Promise<void>;
  refreshPlatformProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  refreshDownloadDir: () => Promise<void>;
  refreshActiveTransfers: () => Promise<void>;
  refreshHistory: () => Promise<void>;
  clearTransferHistory: () => Promise<void>;
  clearPeerCache: () => Promise<void>;
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
  setBluetoothDiscoveryEnabled: (enabled: boolean) => Promise<void>;
  setTransferMode: (mode: tauri.TransferMode) => Promise<void>;
  setExperimentalSwarmReceive: (enabled: boolean) => Promise<void>;
  completeFirstRun: () => Promise<void>;
  checkForUpdates: (silent?: boolean) => Promise<void>;
  installUpdate: () => Promise<void>;
  applyTransferEvent: (event: TransferEvent) => void;
  applyNodeSupervisorStatus: (status: NodeSupervisorStatus) => void;
}

const defaultNodeStatus: NodeStatus = {
  online: false,
  node_id: null,
  relay_connected: false,
  relay_url: null,
  direct_address_count: 0,
  lan_discovery_active: false,
  online_state: "starting",
};

const defaultNodeSupervisorStatus: NodeSupervisorStatus = {
  phase: "starting",
  last_reason: "app_startup",
  last_error: null,
  last_changed_unix: 0,
};

const defaultBleDiscoveryStatus: BleDiscoveryStatus = {
  supported: false,
  enabled: false,
  permission_state: "unknown",
  adapter_state: "unknown",
  scanning: false,
  advertising: false,
  last_error: null,
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

function errorState(error: unknown): { error: string; appError: AppError } {
  const appError = normalizeAppError(error);
  return {
    error: messageFromAppError(appError),
    appError,
  };
}

function isNodePendingError(message: string, appError: AppError): boolean {
  return (
    appError.code === "node_not_ready" ||
    message.includes("Node not initialized yet")
  );
}

function createTransferEntry(
  transferId: string,
  direction: TransferDirection,
  name: string,
  peer: string | null,
  retryTicket: string | null = null,
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
    phase: direction === "receive" ? "connecting" : "preparing",
    failureCategory: null,
    outputPath: null,
    connectMs: 0,
    downloadMs: 0,
    exportMs: 0,
    providerCount: 0,
    directProviderCount: 0,
    relayProviderCount: 0,
    strategy: "unknown",
    firstByteMs: 0,
    effectiveMbps: 0,
    status: "starting",
    hash: null,
    size: null,
    timestamp: null,
    error: null,
    appError: null,
    retryTicket,
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
    phase:
      transfer.phase ??
      current?.phase ??
      (transfer.direction === "receive" ? "connecting" : "preparing"),
    failureCategory:
      transfer.failure_category ?? current?.failureCategory ?? null,
    outputPath: transfer.output_path ?? current?.outputPath ?? null,
    connectMs: transfer.connect_ms,
    downloadMs: transfer.download_ms,
    exportMs: transfer.export_ms,
    providerCount: transfer.provider_count,
    directProviderCount: transfer.direct_provider_count,
    relayProviderCount: transfer.relay_provider_count,
    strategy: transfer.strategy,
    firstByteMs: transfer.first_byte_ms,
    effectiveMbps: transfer.effective_mbps,
    status: current?.status === "starting" ? "starting" : "running",
    hash: current?.hash ?? null,
    size: current?.size ?? null,
    timestamp: current?.timestamp ?? null,
    error: current?.error ?? null,
    appError: current?.appError ?? null,
    retryTicket: current?.retryTicket ?? null,
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
    left.lan_discovery_active === right.lan_discovery_active &&
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
    left.local_discovery_enabled === right.local_discovery_enabled &&
    left.bluetooth_discovery_enabled === right.bluetooth_discovery_enabled &&
    left.transfer_mode === right.transfer_mode
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
    current.phase === (event.phase ?? "downloading") &&
    current.connectMs === event.connect_ms &&
    current.downloadMs === event.download_ms &&
    current.exportMs === event.export_ms &&
    current.providerCount === event.provider_count &&
    current.directProviderCount === event.direct_provider_count &&
    current.relayProviderCount === event.relay_provider_count &&
    current.strategy === event.strategy &&
    current.firstByteMs === event.first_byte_ms &&
    current.effectiveMbps === event.effective_mbps &&
    current.status === "running" &&
    current.error === null &&
    current.appError === null
  );
}

export const useTransferStore = create<TransferStore>((set, get) => ({
  nodeStatus: defaultNodeStatus,
  nodeSupervisorStatus: defaultNodeSupervisorStatus,
  bleDiscoveryStatus: defaultBleDiscoveryStatus,
  platformProfile: tauri.browserPlatformProfile,
  settings: null,
  downloadDir: null,
  updateState: defaultUpdateState,
  transfers: {},
  history: [],
  shareSelection: [],
  shareTicket: null,
  isSharing: false,
  isPreparingSelection: false,
  error: null,
  appError: null,
  errorQueue: [],
  pendingReceiveTicket: null,

  setError: (message) =>
    set((state) => {
      if (message === null) {
        return { error: null, appError: null, errorQueue: [] };
      }
      const next = normalizeAppError(message);
      if (state.appError) {
        return { errorQueue: [...state.errorQueue, next] };
      }
      return { error: message, appError: next };
    }),
  setAppError: (error) =>
    set((state) => {
      if (error === null) {
        return { error: null, appError: null, errorQueue: [] };
      }
      const next = errorState(error);
      if (state.appError) {
        return { errorQueue: [...state.errorQueue, next.appError] };
      }
      return next;
    }),
  clearError: () =>
    set((state) => {
      if (state.errorQueue.length === 0) {
        return { error: null, appError: null };
      }
      const [head, ...rest] = state.errorQueue;
      return {
        appError: head,
        error: head ? messageFromAppError(head) : null,
        errorQueue: rest,
      };
    }),
  setPendingReceiveTicket: (ticket) => set({ pendingReceiveTicket: ticket }),
  consumePendingReceiveTicket: () => {
    const current = get().pendingReceiveTicket;
    if (current) {
      set({ pendingReceiveTicket: null });
    }
    return current;
  },
  clearShareSelection: () => {
    set({
      shareSelection: [],
      shareTicket: null,
      isSharing: false,
      isPreparingSelection: false,
    });
    if (tauri.isDesktopRuntime()) {
      void tauri.clearActiveShare().catch((error: unknown) => {
        set(errorState(error));
      });
    }
  },

  prepareShareSelection: async (paths) => {
    set({
      error: null,
      appError: null,
      errorQueue: [],
      shareTicket: null,
      isSharing: false,
      isPreparingSelection: true,
    });
    try {
      if (tauri.isDesktopRuntime()) {
        await tauri.clearActiveShare();
      }
      const shareSelection = await tauri.describeSharePaths(uniquePaths(paths));
      set({ shareSelection, isPreparingSelection: false });
    } catch (error) {
      set({
        ...errorState(error),
        shareSelection: [],
        isPreparingSelection: false,
      });
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
      set(errorState(error));
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
      set(errorState(error));
    }
  },

  refreshNodeStatus: async () => {
    try {
      const nodeStatus = await tauri.getNodeStatus();
      set((state) =>
        sameNodeStatus(state.nodeStatus, nodeStatus) ? state : { nodeStatus },
      );
    } catch (error) {
      set(errorState(error));
    }
  },

  refreshNodeSupervisorStatus: async () => {
    try {
      const nodeSupervisorStatus = await tauri.getNodeSupervisorStatus();
      set({ nodeSupervisorStatus });
    } catch (error) {
      set(errorState(error));
    }
  },

  refreshBleDiscoveryStatus: async () => {
    try {
      const bleDiscoveryStatus = await tauri.getBleDiscoveryStatus();
      set({ bleDiscoveryStatus });
    } catch (error) {
      set(errorState(error));
    }
  },

  refreshPlatformProfile: async () => {
    try {
      const platformProfile = await tauri.getPlatformProfile();
      set({ platformProfile });
    } catch (error) {
      set(errorState(error));
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
      set(errorState(error));
    }
  },

  refreshDownloadDir: async () => {
    try {
      const settings = await tauri.getAppSettings();
      set(withSettings(settings));
    } catch (error) {
      const appError = normalizeAppError(error);
      const message = messageFromAppError(appError);
      if (!isNodePendingError(message, appError)) {
        set({ error: message, appError });
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
      set(errorState(error));
    }
  },

  refreshHistory: async () => {
    try {
      const history = await tauri.getTransferHistory();
      set({ history });
    } catch (error) {
      const appError = normalizeAppError(error);
      const message = messageFromAppError(appError);
      if (!isNodePendingError(message, appError)) {
        set({ error: message, appError });
      }
    }
  },

  clearTransferHistory: async () => {
    try {
      await tauri.clearTransferHistory();
      set({ history: [] });
    } catch (error) {
      set(errorState(error));
    }
  },

  clearPeerCache: async () => {
    try {
      await tauri.clearPeerCache();
      useNearbyShareStore.getState().clearShares();
      useNearbyDeviceStore.getState().clearDevices();
    } catch (error) {
      set(errorState(error));
    }
  },

  createShare: async () => {
    const paths = get().shareSelection.map((item) => item.path);
    if (paths.length === 0) {
      return;
    }

    set({
      error: null,
      appError: null,
      isSharing: true,
      shareTicket: null,
    });

    try {
      const shareTicket = await tauri.createShare(paths);
      set({ shareTicket });
      await get().refreshHistory();
    } catch (error) {
      set(errorState(error));
    } finally {
      set({ isSharing: false });
    }
  },

  startReceive: async (ticket) => {
    set({ error: null, appError: null });

    try {
      if (!get().settings) {
        set(withSettings(await tauri.getAppSettings()));
      }
      const transferId = await tauri.startReceive(ticket);
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
              ticket,
            ),
        },
      }));
      return transferId;
    } catch (error) {
      set(errorState(error));
      return null;
    }
  },

  startReceiveNearbyShare: async (share) => {
    set({ error: null, appError: null });

    try {
      if (!get().settings) {
        set(withSettings(await tauri.getAppSettings()));
      }
      const transferId = await tauri.startReceiveDiscoveredShare(
        share.share_id,
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
      set(errorState(error));
      return null;
    }
  },

  reshare: async (hash) => {
    set({ error: null, appError: null });

    try {
      const shareTicket = await tauri.getTicket(hash);
      set({ shareTicket });
      return shareTicket;
    } catch (error) {
      set(errorState(error));
      return null;
    }
  },

  cancelTransfer: async (transferId) => {
    try {
      await tauri.cancelTransfer(transferId);
    } catch (error) {
      set(errorState(error));
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
      set(errorState(error));
    }
  },

  openDownloadDir: async () => {
    try {
      await tauri.openDownloadDir();
    } catch (error) {
      set(errorState(error));
    }
  },

  setAutoUpdateEnabled: async (enabled) => {
    try {
      const settings = await tauri.setAutoUpdateEnabled(enabled);
      set(withSettings(settings));
    } catch (error) {
      set(errorState(error));
    }
  },

  setRelayMode: async (relayMode) => {
    try {
      const settings = await tauri.setRelayMode(relayMode);
      set(withSettings(settings));
      await get().refreshNodeSupervisorStatus();
      await get().refreshNodeStatus();
    } catch (error) {
      set(errorState(error));
    }
  },

  setCustomRelayUrl: async (relayUrl) => {
    try {
      const settings = await tauri.setCustomRelayUrl(relayUrl);
      set(withSettings(settings));
      await get().refreshNodeSupervisorStatus();
      await get().refreshNodeStatus();
    } catch (error) {
      set(errorState(error));
    }
  },

  setLocalDiscoveryEnabled: async (enabled) => {
    try {
      const settings = await tauri.setLocalDiscoveryEnabled(enabled);
      set(withSettings(settings));
      if (!enabled) {
        useNearbyShareStore.getState().clearShares();
      }
      await get().refreshNodeSupervisorStatus();
      await get().refreshNodeStatus();
    } catch (error) {
      set(errorState(error));
    }
  },

  setBluetoothDiscoveryEnabled: async (enabled) => {
    try {
      const settings = await tauri.setBluetoothDiscoveryEnabled(enabled);
      if (enabled) {
        const nodeId = get().nodeStatus.node_id ?? (await tauri.getNodeId());
        const started = await tauri.startBleDiscovery(nodeId);
        if (!started) {
          set({
            error:
              "Bluetooth discovery did not start. Check Bluetooth permissions, OS privacy settings, and adapter support.",
            appError: normalizeAppError(
              "Bluetooth discovery did not start. Check Bluetooth permissions, OS privacy settings, and adapter support.",
            ),
          });
        }
      } else {
        await tauri.stopBleDiscovery();
      }
      set(withSettings(settings));
      await get().refreshBleDiscoveryStatus();
    } catch (error) {
      set(errorState(error));
    }
  },

  setTransferMode: async (mode) => {
    try {
      const settings = await tauri.setTransferMode(mode);
      set(withSettings(settings));
    } catch (error) {
      set(errorState(error));
    }
  },

  setExperimentalSwarmReceive: async (enabled) => {
    try {
      const settings = await tauri.setExperimentalSwarmReceive(enabled);
      set(withSettings(settings));
    } catch (error) {
      set(errorState(error));
    }
  },

  completeFirstRun: async () => {
    try {
      const settings = await tauri.completeFirstRun();
      set(withSettings(settings));
    } catch (error) {
      set(errorState(error));
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

      const appError = normalizeAppError(error);
      set((state) => ({
        updateState: {
          ...state.updateState,
          phase: "error",
          error: messageFromAppError(appError),
          lastCheckedAt: Date.now(),
        },
        appError,
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
      const appError = normalizeAppError(error);
      set((state) => ({
        updateState: {
          ...state.updateState,
          phase: "error",
          error: messageFromAppError(appError),
        },
        appError,
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
          phase:
            event.phase ??
            (event.direction === "receive" ? "connecting" : "preparing"),
          failureCategory: null,
          outputPath: null,
          connectMs: event.connect_ms,
          downloadMs: event.download_ms,
          exportMs: event.export_ms,
          providerCount: event.provider_count,
          directProviderCount: event.direct_provider_count,
          relayProviderCount: event.relay_provider_count,
          strategy: event.strategy,
          firstByteMs: event.first_byte_ms,
          effectiveMbps: event.effective_mbps,
          status: "starting",
          hash: null,
          size: null,
          timestamp: null,
          error: null,
          appError: null,
          retryTicket: state.transfers[event.transfer_id]?.retryTicket ?? null,
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
              phase: event.phase ?? "downloading",
              failureCategory: null,
              connectMs: event.connect_ms,
              downloadMs: event.download_ms,
              exportMs: event.export_ms,
              providerCount: event.provider_count,
              directProviderCount: event.direct_provider_count,
              relayProviderCount: event.relay_provider_count,
              strategy: event.strategy,
              firstByteMs: event.first_byte_ms,
              effectiveMbps: event.effective_mbps,
              status: "running",
              error: null,
              appError: null,
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
          phase: event.phase ?? "completed",
          failureCategory: null,
          outputPath: event.output_path ?? null,
          connectMs: event.connect_ms,
          downloadMs: event.download_ms,
          exportMs: event.export_ms,
          providerCount: event.provider_count,
          directProviderCount: event.direct_provider_count,
          relayProviderCount: event.relay_provider_count,
          strategy: event.strategy,
          firstByteMs: event.first_byte_ms,
          effectiveMbps: event.effective_mbps,
          status: "completed",
          hash: event.hash,
          size: event.size,
          timestamp: event.timestamp,
          error: null,
          appError: null,
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
        transfers[event.transfer_id] = mergeFailedTransferEvent(current, event);
        return { transfers };
      }
    });
  },

  applyNodeSupervisorStatus: (status) => {
    set({ nodeSupervisorStatus: status });
  },
}));
