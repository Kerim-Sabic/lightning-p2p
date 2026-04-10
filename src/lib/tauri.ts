import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";

export type TransferDirection = "send" | "receive";

export interface NodeStatus {
  online: boolean;
  node_id: string | null;
}

export interface ActiveTransfer {
  transfer_id: string;
  direction: TransferDirection;
  name: string;
  peer: string | null;
  bytes: number;
  total: number;
  speed_bps: number;
}

export interface TransferRecord {
  hash: string;
  filename: string;
  size: number;
  peer: string | null;
  timestamp: number;
  direction: TransferDirection;
}

export interface SharePathInfo {
  path: string;
  name: string;
  size: number;
  is_dir: boolean;
}

export interface AppSettings {
  download_dir: string;
  auto_update_enabled: boolean;
  first_run_complete: boolean;
}

export interface UpdateCheckResult {
  current_version: string;
  available: boolean;
  version: string | null;
  body: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded_bytes: number;
  total_bytes: number | null;
}

export type TransferEvent =
  | {
      type: "started";
      transfer_id: string;
      direction: TransferDirection;
      name: string;
      peer: string | null;
      total: number;
    }
  | {
      type: "progress";
      transfer_id: string;
      bytes: number;
      total: number;
      speed_bps: number;
    }
  | {
      type: "completed";
      transfer_id: string;
      direction: TransferDirection;
      hash: string;
      name: string;
      size: number;
      peer: string | null;
      timestamp: number;
    }
  | {
      type: "failed";
      transfer_id: string;
      error: string;
    };

let pendingUpdate: Update | null = null;

export async function getNodeId(): Promise<string> {
  return invoke<string>("get_node_id");
}

export async function getNodeStatus(): Promise<NodeStatus> {
  return invoke<NodeStatus>("get_node_status");
}

export async function getAppVersion(): Promise<string> {
  return getVersion();
}

export async function createShare(paths: string[]): Promise<string> {
  return invoke<string>("create_share", { paths });
}

export async function describeSharePaths(
  paths: string[],
): Promise<SharePathInfo[]> {
  return invoke<SharePathInfo[]>("describe_share_paths", { paths });
}

export async function getTicket(hash: string): Promise<string> {
  return invoke<string>("get_ticket", { hash });
}

export async function renderTicketQr(ticket: string): Promise<string> {
  return invoke<string>("render_ticket_qr", { ticket });
}

export async function startReceive(
  ticket: string,
  destination: string,
): Promise<string> {
  return invoke<string>("start_receive", { ticket, destination });
}

export async function cancelTransfer(transferId: string): Promise<void> {
  await invoke("cancel_transfer", { transferId });
}

export async function getActiveTransfers(): Promise<ActiveTransfer[]> {
  return invoke<ActiveTransfer[]>("get_active_transfers");
}

export async function getTransferHistory(): Promise<TransferRecord[]> {
  return invoke<TransferRecord[]>("get_transfer_history");
}

export async function getAppSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_app_settings");
}

export async function getDownloadDir(): Promise<string> {
  return invoke<string>("get_download_dir");
}

export async function setDownloadDir(path: string): Promise<AppSettings> {
  return invoke<AppSettings>("set_download_dir", { path });
}

export async function setAutoUpdateEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  return invoke<AppSettings>("set_auto_update_enabled", { enabled });
}

export async function completeFirstRun(): Promise<AppSettings> {
  return invoke<AppSettings>("complete_first_run");
}

export async function openDownloadDir(): Promise<void> {
  await invoke("open_download_dir");
}

export async function pickDirectory(
  defaultPath?: string,
): Promise<string | null> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Choose a download folder",
  });
  return typeof selected === "string" ? selected : null;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  await disposePendingUpdate();
  const currentVersion = await getAppVersion();
  pendingUpdate = await check({ timeout: 30_000 });

  return {
    current_version: currentVersion,
    available: pendingUpdate !== null,
    version: pendingUpdate?.version ?? null,
    body: pendingUpdate?.body ?? null,
    date: pendingUpdate?.date ?? null,
  };
}

export async function installAppUpdate(
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  if (!pendingUpdate) {
    throw new Error("No update is available to install.");
  }

  let downloadedBytes = 0;
  let totalBytes: number | null = null;

  await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
    const snapshot = updateProgressSnapshot(event, downloadedBytes, totalBytes);
    downloadedBytes = snapshot.downloaded_bytes;
    totalBytes = snapshot.total_bytes;
    onProgress?.(snapshot);
  });
  await disposePendingUpdate();
}

export function onTransferProgress(
  callback: (event: TransferEvent) => void,
): Promise<UnlistenFn> {
  return listen<TransferEvent>("transfer-progress", ({ payload }) => {
    callback(payload);
  });
}

async function disposePendingUpdate(): Promise<void> {
  if (!pendingUpdate) {
    return;
  }
  await pendingUpdate.close();
  pendingUpdate = null;
}

function updateProgressSnapshot(
  event: DownloadEvent,
  downloadedBytes: number,
  totalBytes: number | null,
): UpdateProgress {
  if (event.event === "Started") {
    return {
      downloaded_bytes: 0,
      total_bytes: event.data.contentLength ?? null,
    };
  }

  if (event.event === "Progress") {
    return {
      downloaded_bytes: downloadedBytes + event.data.chunkLength,
      total_bytes: totalBytes,
    };
  }

  return {
    downloaded_bytes: downloadedBytes,
    total_bytes: totalBytes,
  };
}
