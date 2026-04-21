import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import {
  Format,
  checkPermissions as checkBarcodePermissions,
  requestPermissions as requestBarcodePermissions,
  scan as scanBarcode,
} from "@tauri-apps/plugin-barcode-scanner";
import {
  readText as readClipboardTextNative,
  writeText as writeClipboardTextNative,
} from "@tauri-apps/plugin-clipboard-manager";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { platform as nativePlatform } from "@tauri-apps/plugin-os";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import {
  getCurrentWindow,
  type DragDropEvent,
} from "@tauri-apps/api/window";
import { extractBlobTicket } from "./format";
import { DEEP_LINK_SCHEME, RECEIVE_PATH, SITE_URL } from "./shareLinks";

export type RuntimeKind = "desktop" | "android" | "ios" | "browser";
export type TransferDirection = "send" | "receive";
export type NodeOnlineState =
  | "starting"
  | "direct_ready"
  | "relay_ready"
  | "degraded"
  | "offline";
export type RouteKind = "unknown" | "direct" | "relay";
export type TransferPhase =
  | "preparing"
  | "connecting"
  | "downloading"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled";
export type FailureCategory =
  | "invalid_ticket"
  | "destination"
  | "unreachable"
  | "interrupted"
  | "cancelled"
  | "disk_space"
  | "export"
  | "unknown";
export type NearbyRouteHint = "unknown" | "direct" | "relay" | "mixed";
export type RelayMode = "public" | "custom";

export interface NodeStatus {
  online: boolean;
  node_id: string | null;
  relay_connected: boolean;
  relay_url: string | null;
  direct_address_count: number;
  lan_discovery_active: boolean;
  online_state: NodeOnlineState;
}

export interface ActiveTransfer {
  transfer_id: string;
  direction: TransferDirection;
  name: string;
  peer: string | null;
  bytes: number;
  total: number;
  speed_bps: number;
  route_kind: RouteKind;
  phase?: TransferPhase;
  failure_category?: FailureCategory | null;
  output_path?: string | null;
  connect_ms: number;
  download_ms: number;
  export_ms: number;
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
  relay_mode: RelayMode;
  custom_relay_url: string | null;
  local_discovery_enabled: boolean;
}

export interface DownloadDirectoryDiagnostics {
  exists: boolean;
  is_dir: boolean;
  writable: boolean;
  status: string;
}

export interface NetworkDiagnostics {
  app_version: string;
  node_id: string | null;
  online: boolean;
  online_state: NodeOnlineState;
  relay_mode: RelayMode;
  relay_connected: boolean;
  relay_url: string | null;
  direct_address_count: number;
  lan_discovery_active: boolean;
  local_discovery_enabled: boolean;
  download_dir_status: DownloadDirectoryDiagnostics;
  latest_route_kind: RouteKind;
}

export interface NearbyShare {
  share_id: string;
  device_name: string;
  node_id: string;
  label: string;
  size: number;
  hash: string;
  route_hint: NearbyRouteHint;
  direct_address_count: number;
  freshness_seconds: number;
  published_at: number;
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

export interface DesktopWindowState {
  focused: boolean;
  maximized: boolean;
}

export type TransferEvent =
  | {
      type: "started";
      transfer_id: string;
      direction: TransferDirection;
      name: string;
      peer: string | null;
      total: number;
      route_kind: RouteKind;
      phase?: TransferPhase;
      connect_ms: number;
      download_ms: number;
      export_ms: number;
    }
  | {
      type: "progress";
      transfer_id: string;
      bytes: number;
      total: number;
      speed_bps: number;
      route_kind: RouteKind;
      phase?: TransferPhase;
      connect_ms: number;
      download_ms: number;
      export_ms: number;
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
      route_kind: RouteKind;
      phase?: TransferPhase;
      output_path?: string | null;
      connect_ms: number;
      download_ms: number;
      export_ms: number;
    }
  | {
      type: "failed";
      transfer_id: string;
      error: string;
      route_kind: RouteKind;
      phase?: TransferPhase;
      failure_category?: FailureCategory | null;
    };

let pendingUpdate: Update | null = null;

const browserNodeStatus: NodeStatus = {
  online: false,
  node_id: null,
  relay_connected: false,
  relay_url: null,
  direct_address_count: 0,
  lan_discovery_active: false,
  online_state: "offline",
};

const browserSettings: AppSettings = {
  download_dir: "Desktop app runtime required",
  auto_update_enabled: false,
  first_run_complete: true,
  relay_mode: "public",
  custom_relay_url: null,
  local_discovery_enabled: true,
};

const browserNetworkDiagnostics: NetworkDiagnostics = {
  app_version: "web-preview",
  node_id: null,
  online: false,
  online_state: "offline",
  relay_mode: "public",
  relay_connected: false,
  relay_url: null,
  direct_address_count: 0,
  lan_discovery_active: false,
  local_discovery_enabled: false,
  download_dir_status: {
    exists: false,
    is_dir: false,
    writable: false,
    status: "desktop_runtime_required",
  },
  latest_route_kind: "unknown",
};

function runtimeKindFromUserAgent(): RuntimeKind {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("android")) {
    return "android";
  }
  if (/(iphone|ipad|ipod)/.test(userAgent)) {
    return "ios";
  }
  return "desktop";
}

export function getRuntimeKind(): RuntimeKind {
  if (!isTauri()) {
    return "browser";
  }

  try {
    const platform = nativePlatform();
    if (platform === "android" || platform === "ios") {
      return platform;
    }
  } catch {
    return runtimeKindFromUserAgent();
  }

  return "desktop";
}

export function isNativeRuntime(): boolean {
  return isTauri();
}

export function isDesktopPlatform(): boolean {
  return getRuntimeKind() === "desktop";
}

export function isMobileRuntime(): boolean {
  const kind = getRuntimeKind();
  return kind === "android" || kind === "ios";
}

export function isDesktopRuntime(): boolean {
  return isNativeRuntime();
}

export function desktopRuntimeMessage(feature = "This feature"): string {
  return `${feature} requires the native Lightning P2P app runtime. Use \`pnpm tauri dev\`, the installed Windows app, or an Android alpha build instead of the browser preview.`;
}

function requireNativeRuntime(feature: string): void {
  if (!isNativeRuntime()) {
    throw new Error(desktopRuntimeMessage(feature));
  }
}

function runtimeError(feature: string, error: unknown): Error {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unexpected native runtime error";
  return new Error(`${feature} failed: ${message}`);
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isNativeRuntime()) {
    await writeClipboardTextNative(text);
    return;
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard write is unavailable in this browser.");
  }
  await navigator.clipboard.writeText(text);
}

export async function readClipboardText(): Promise<string> {
  if (isNativeRuntime()) {
    return readClipboardTextNative();
  }

  if (!navigator.clipboard?.readText) {
    throw new Error("Clipboard read is unavailable in this browser.");
  }
  return navigator.clipboard.readText();
}

export async function scanReceiveTicketQr(): Promise<string> {
  requireNativeRuntime("QR scanning");
  if (!isMobileRuntime()) {
    throw new Error("QR scanning is available only in the mobile app runtime.");
  }

  let permission = await checkBarcodePermissions();
  if (permission !== "granted") {
    permission = await requestBarcodePermissions();
  }
  if (permission !== "granted") {
    throw new Error("Camera permission is required to scan a receive QR code.");
  }

  const scanned = await scanBarcode({
    cameraDirection: "back",
    formats: [Format.QRCode],
  });
  const ticket = extractBlobTicket(scanned.content) ?? scanned.content.trim();
  if (!ticket) {
    throw new Error("The QR code did not contain a receive ticket.");
  }
  return ticket;
}

async function runDesktopWindowAction(
  feature: string,
  action: () => Promise<void>,
): Promise<void> {
  if (!isDesktopPlatform()) {
    throw new Error(`${feature} is available only in the desktop window.`);
  }
  try {
    await action();
  } catch (error) {
    throw runtimeError(feature, error);
  }
}

export async function getNodeId(): Promise<string> {
  if (!isDesktopRuntime()) {
    return "desktop-runtime-required";
  }
  return invoke<string>("get_node_id");
}

export async function getNodeStatus(): Promise<NodeStatus> {
  if (!isDesktopRuntime()) {
    return browserNodeStatus;
  }
  return invoke<NodeStatus>("get_node_status");
}

export async function getAppVersion(): Promise<string> {
  if (!isDesktopRuntime()) {
    return "web-preview";
  }
  return getVersion();
}

export async function createShare(paths: string[]): Promise<string> {
  requireNativeRuntime("Share creation");
  return invoke<string>("create_share", { paths });
}

export async function describeSharePaths(
  paths: string[],
): Promise<SharePathInfo[]> {
  requireNativeRuntime("Share staging");
  return invoke<SharePathInfo[]>("describe_share_paths", { paths });
}

export async function getTicket(hash: string): Promise<string> {
  requireNativeRuntime("Ticket generation");
  return invoke<string>("get_ticket", { hash });
}

export async function renderTicketQr(ticket: string): Promise<string> {
  requireNativeRuntime("QR rendering");
  return invoke<string>("render_ticket_qr", { ticket });
}

export async function startReceive(
  ticket: string,
  destination: string,
): Promise<string> {
  requireNativeRuntime("Receiving transfers");
  return invoke<string>("start_receive", { ticket, destination });
}

export async function startReceiveDiscoveredShare(
  shareId: string,
  destination: string,
): Promise<string> {
  requireNativeRuntime("Receiving nearby shares");
  return invoke<string>("start_receive_discovered_share", {
    shareId,
    destination,
  });
}

export async function cancelTransfer(transferId: string): Promise<void> {
  requireNativeRuntime("Transfer cancellation");
  await invoke("cancel_transfer", { transferId });
}

export async function getActiveTransfers(): Promise<ActiveTransfer[]> {
  if (!isDesktopRuntime()) {
    return [];
  }
  return invoke<ActiveTransfer[]>("get_active_transfers");
}

export async function getDiscoveredShares(): Promise<NearbyShare[]> {
  if (!isDesktopRuntime()) {
    return [];
  }
  return invoke<NearbyShare[]>("get_discovered_shares");
}

export async function getTransferHistory(): Promise<TransferRecord[]> {
  if (!isDesktopRuntime()) {
    return [];
  }
  return invoke<TransferRecord[]>("get_transfer_history");
}

export async function getAppSettings(): Promise<AppSettings> {
  if (!isDesktopRuntime()) {
    return browserSettings;
  }
  return invoke<AppSettings>("get_app_settings");
}

export async function getNetworkDiagnostics(): Promise<NetworkDiagnostics> {
  if (!isDesktopRuntime()) {
    return browserNetworkDiagnostics;
  }
  return invoke<NetworkDiagnostics>("get_network_diagnostics");
}

export async function getDownloadDir(): Promise<string> {
  if (!isDesktopRuntime()) {
    return browserSettings.download_dir;
  }
  return invoke<string>("get_download_dir");
}

export async function setDownloadDir(path: string): Promise<AppSettings> {
  requireNativeRuntime("Changing the download folder");
  return invoke<AppSettings>("set_download_dir", { path });
}

export async function setAutoUpdateEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  requireNativeRuntime("Changing update settings");
  return invoke<AppSettings>("set_auto_update_enabled", { enabled });
}

export async function setRelayMode(relayMode: RelayMode): Promise<AppSettings> {
  requireNativeRuntime("Changing relay mode");
  return invoke<AppSettings>("set_relay_mode", { relayMode });
}

export async function setCustomRelayUrl(
  relayUrl: string | null,
): Promise<AppSettings> {
  requireNativeRuntime("Saving a custom relay URL");
  return invoke<AppSettings>("set_custom_relay_url", { relayUrl });
}

export async function setLocalDiscoveryEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  requireNativeRuntime("Changing local discovery settings");
  return invoke<AppSettings>("set_local_discovery_enabled", { enabled });
}

export async function completeFirstRun(): Promise<AppSettings> {
  requireNativeRuntime("Completing setup");
  return invoke<AppSettings>("complete_first_run");
}

export async function openDownloadDir(): Promise<void> {
  requireNativeRuntime("Opening the download folder");
  await invoke("open_download_dir");
}

export async function clearActiveShare(): Promise<void> {
  requireNativeRuntime("Clearing the active share");
  await invoke("clear_active_share");
}

export async function pickDirectory(
  defaultPath?: string,
): Promise<string | null> {
  requireNativeRuntime("Choosing a folder");
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Choose a download folder",
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickShareFiles(defaultPath?: string): Promise<string[]> {
  requireNativeRuntime("Choosing files");
  const selected = await openDialog({
    directory: false,
    multiple: true,
    defaultPath,
    title: "Choose files to share",
  });

  if (typeof selected === "string") {
    return [selected];
  }

  return Array.isArray(selected) ? selected : [];
}

export async function pickShareFolder(
  defaultPath?: string,
): Promise<string | null> {
  requireNativeRuntime("Choosing a folder");
  const selected = await openDialog({
    directory: true,
    multiple: false,
    defaultPath,
    title: "Choose a folder to share",
  });

  return typeof selected === "string" ? selected : null;
}

export async function checkForAppUpdate(): Promise<UpdateCheckResult> {
  requireNativeRuntime("Checking for updates");
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
  requireNativeRuntime("Installing updates");
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
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<TransferEvent>("transfer-progress", ({ payload }) => {
    callback(payload);
  });
}

export function onDiscoveredSharesUpdated(
  callback: (shares: NearbyShare[]) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<NearbyShare[]>("discovered-shares-updated", ({ payload }) => {
    callback(payload);
  });
}

export { DEEP_LINK_SCHEME };

export function extractTicketFromDeepLink(url: string): string | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
    const siteUrl = new URL(SITE_URL);
    const normalizedPath = parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
    const webReceiveLink =
      parsed.protocol === siteUrl.protocol &&
      parsed.hostname === siteUrl.hostname &&
      normalizedPath === RECEIVE_PATH;
    if (!webReceiveLink) {
      return null;
    }
    return extractBlobTicket(url);
  }
  return extractBlobTicket(url);
}

export function onDeepLinkOpened(
  callback: (ticket: string) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<string[]>("deep-link://new-url", ({ payload }) => {
    for (const url of payload ?? []) {
      const ticket = extractTicketFromDeepLink(url);
      if (ticket) {
        callback(ticket);
        return;
      }
    }
  });
}

export async function getDesktopWindowState(): Promise<DesktopWindowState> {
  if (!isDesktopPlatform()) {
    return {
      focused: true,
      maximized: false,
    };
  }

  const currentWindow = getCurrentWindow();
  const [focused, maximized] = await Promise.all([
    currentWindow.isFocused(),
    currentWindow.isMaximized(),
  ]);

  return {
    focused,
    maximized,
  };
}

export function onDesktopWindowResized(
  callback: () => void,
): Promise<UnlistenFn> {
  if (!isDesktopPlatform()) {
    return Promise.resolve(() => {});
  }

  return getCurrentWindow().onResized(() => {
    callback();
  });
}

export function onDesktopWindowFocusChanged(
  callback: (focused: boolean) => void,
): Promise<UnlistenFn> {
  if (!isDesktopPlatform()) {
    return Promise.resolve(() => {});
  }

  return getCurrentWindow().onFocusChanged(({ payload }) => {
    callback(payload);
  });
}

export function onWindowDragDropEvent(
  callback: (event: DragDropEvent) => void,
): Promise<UnlistenFn> {
  if (!isDesktopPlatform()) {
    return Promise.resolve(() => {});
  }

  return getCurrentWindow().onDragDropEvent((event) => {
    callback(event.payload);
  });
}

export async function minimizeDesktopWindow(): Promise<void> {
  await runDesktopWindowAction("Window minimize", async () => {
    await getCurrentWindow().minimize();
  });
}

export async function toggleDesktopWindowMaximize(): Promise<void> {
  await runDesktopWindowAction("Window maximize", async () => {
    await getCurrentWindow().toggleMaximize();
  });
}

export async function closeDesktopWindow(): Promise<void> {
  await runDesktopWindowAction("Window close", async () => {
    await getCurrentWindow().close();
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
