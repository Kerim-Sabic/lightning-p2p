import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

export async function getNodeId(): Promise<string> {
  return invoke<string>("get_node_id");
}

export async function getNodeStatus(): Promise<NodeStatus> {
  return invoke<NodeStatus>("get_node_status");
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

export async function getDownloadDir(): Promise<string> {
  return invoke<string>("get_download_dir");
}

export async function setDownloadDir(path: string): Promise<void> {
  await invoke("set_download_dir", { path });
}

export function onTransferProgress(
  callback: (event: TransferEvent) => void,
): Promise<UnlistenFn> {
  return listen<TransferEvent>("transfer-progress", ({ payload }) => {
    callback(payload);
  });
}
