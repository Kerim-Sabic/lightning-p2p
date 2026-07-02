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
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import {
  check,
  type DownloadEvent,
  type Update,
} from "@tauri-apps/plugin-updater";
import { getCurrentWindow, type DragDropEvent } from "@tauri-apps/api/window";
import { extractBlobTicket } from "./format";
import { normalizeAppError, type BackendAppErrorPayload } from "./appErrors";
import { DEEP_LINK_SCHEME, RECEIVE_PATH, SITE_URL } from "./shareLinks";
export type {
  AppError,
  AppErrorCategory,
  AppErrorCode,
  AppErrorSeverity,
  BackendAppErrorPayload,
} from "./appErrors";

export type RuntimeKind = "desktop" | "android" | "ios" | "browser";
export type NativePlatformKind =
  | "windows"
  | "macos"
  | "linux"
  | "android"
  | "ios"
  | "unknown";
export type PlatformKind = NativePlatformKind | "browser";
export type RuntimeFamily = "desktop" | "android" | "ios" | "browser";
export type StorageModel = "user_selected" | "app_private" | "handoff_only";
export type ReleaseSupport =
  | "public_windows"
  | "source_build"
  | "android_alpha"
  | "ios_prepared"
  | "unsupported"
  | "web_handoff_only";
export type TransferDirection = "send" | "receive";
export type NodeOnlineState =
  | "starting"
  | "direct_ready"
  | "relay_ready"
  | "degraded"
  | "offline";
export type RouteKind = "unknown" | "direct" | "relay" | "mixed";
export type TransferStrategy =
  | "unknown"
  | "queued_single_provider"
  | "queued_multi_provider";
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
export type NearbyTransport = "wifi_mdns" | "ble" | "both";
export type OfferDecision = "accepted" | "rejected" | "expired";
export type WireBlobFormat = "raw" | "hash_seq";
export type RelayMode = "public" | "custom";
export type NodeSupervisorPhase =
  | "idle"
  | "starting"
  | "restarting"
  | "blocked_active_transfers"
  | "failed";
export type BlePermissionState =
  | "unsupported"
  | "not_requested"
  | "granted"
  | "denied"
  | "unknown";
export type BleAdapterState =
  | "unsupported"
  | "unknown"
  | "unavailable"
  | "available";

export interface NodeStatus {
  online: boolean;
  node_id: string | null;
  relay_connected: boolean;
  relay_url: string | null;
  direct_address_count: number;
  lan_discovery_active: boolean;
  online_state: NodeOnlineState;
}

export interface NodeSupervisorStatus {
  phase: NodeSupervisorPhase;
  last_reason: string | null;
  last_error: string | null;
  last_changed_unix: number;
}

export interface BleDiscoveryStatus {
  supported: boolean;
  enabled: boolean;
  permission_state: BlePermissionState;
  adapter_state: BleAdapterState;
  scanning: boolean;
  advertising: boolean;
  last_error: string | null;
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
  provider_count: number;
  direct_provider_count: number;
  relay_provider_count: number;
  strategy: TransferStrategy;
  first_byte_ms: number;
  effective_mbps: number;
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

export type TransferMode =
  | "standard"
  | "fast"
  | "extreme"
  | "lan_beast"
  | "battery_safe";

export const TRANSFER_MODES: TransferMode[] = [
  "standard",
  "fast",
  "extreme",
  "lan_beast",
  "battery_safe",
];

export interface TransferModeDescriptor {
  /** Wire value sent to the backend. */
  value: TransferMode;
  /** Short label shown in pickers and badges. */
  label: string;
  /** One-line description used in tooltips and the Settings copy. */
  description: string;
  /** True if the mode is only meaningful on Android. */
  androidOnly?: boolean;
}

export const TRANSFER_MODE_DESCRIPTORS: Record<
  TransferMode,
  TransferModeDescriptor
> = {
  standard: {
    value: "standard",
    label: "Standard",
    description:
      "Safe default. Moderate parallelism and conservative QUIC windows.",
  },
  fast: {
    value: "fast",
    label: "Fast",
    description:
      "Full parallelism, same QUIC windows as Standard. Aimed at typical LAN.",
  },
  extreme: {
    value: "extreme",
    label: "Extreme",
    description:
      "Larger windows, more streams, slower UI emit. Aimed at fast LAN to multi-GbE.",
  },
  lan_beast: {
    value: "lan_beast",
    label: "LAN Beast",
    description:
      "Maximum windows and permissive timeouts. For sustained large transfers on local networks.",
  },
  battery_safe: {
    value: "battery_safe",
    label: "Battery Safe",
    description:
      "Small parallelism and slow UI emit. Reduces RAM and CPU pressure on Android.",
    androidOnly: true,
  },
};

export interface AppSettings {
  download_dir: string;
  auto_update_enabled: boolean;
  first_run_complete: boolean;
  relay_mode: RelayMode;
  custom_relay_url: string | null;
  local_discovery_enabled: boolean;
  bluetooth_discovery_enabled: boolean;
  transfer_mode: TransferMode;
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
  bluetooth_discovery_enabled: boolean;
  download_dir_status: DownloadDirectoryDiagnostics;
  latest_route_kind: RouteKind;
  node_supervisor: NodeSupervisorStatus;
  ble_status: BleDiscoveryStatus;
}

export interface DiagnosticBundle {
  generated_at_unix: number;
  report: string;
}

export interface PlatformCapabilities {
  native_runtime: boolean;
  send_files: boolean;
  send_folders: boolean;
  receive_files: boolean;
  scan_receive_qr: boolean;
  local_discovery: boolean;
  bluetooth_discovery: boolean;
  nfc_ticket_handoff: boolean;
  relay_fallback: boolean;
  custom_relay: boolean;
  custom_receive_dir: boolean;
  public_downloads_export: boolean;
  smart_routing: boolean;
  auto_update: boolean;
  deep_link_receive: boolean;
  web_handoff_receive: boolean;
  background_transfer: boolean;
  browser_transfer: boolean;
  benchmark_required_for_speed_claims: boolean;
}

export interface PlatformGuidance {
  storage_notice: string;
  transfer_notice: string;
  online_notice: string;
  release_notice: string;
  benchmark_notice: string;
}

export interface PlatformProfile {
  platform_kind: PlatformKind;
  runtime_family: RuntimeFamily;
  target_os: string;
  transfer_engine: string;
  online_handoff_model: string;
  storage_model: StorageModel;
  release_support: ReleaseSupport;
  capabilities: PlatformCapabilities;
  guidance: PlatformGuidance;
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

export interface NearbyDevice {
  node_id: string;
  device_name: string;
  last_seen_unix: number;
  transport: NearbyTransport;
  route_hint: NearbyRouteHint;
  direct_address_count: number;
  has_active_share: boolean;
}

export type NearbyDiagnosticState =
  | "searching"
  | "devices_visible"
  | "likely_blocked";

export interface IncomingOffer {
  offer_id: string;
  sender_node_id: string;
  sender_device_name: string;
  label: string;
  size: number;
  blob_hash: string;
  blob_format: WireBlobFormat;
  received_at_unix: number;
}

export interface OfferResolved {
  offer_id: string;
  outcome: OfferDecision;
  receiver_node_id: string;
}

export interface LocalDeviceIdentity {
  device_name: string;
  short_node_id: string;
  node_id: string;
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
      provider_count: number;
      direct_provider_count: number;
      relay_provider_count: number;
      strategy: TransferStrategy;
      first_byte_ms: number;
      effective_mbps: number;
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
      provider_count: number;
      direct_provider_count: number;
      relay_provider_count: number;
      strategy: TransferStrategy;
      first_byte_ms: number;
      effective_mbps: number;
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
      provider_count: number;
      direct_provider_count: number;
      relay_provider_count: number;
      strategy: TransferStrategy;
      first_byte_ms: number;
      effective_mbps: number;
    }
  | {
      type: "failed";
      transfer_id: string;
      error: string;
      route_kind: RouteKind;
      phase?: TransferPhase;
      failure_category?: FailureCategory | null;
      error_payload?: BackendAppErrorPayload | null;
    };

let pendingUpdate: Update | null = null;
const EXTERNAL_URL_PROTOCOLS = new Set(["https:", "http:"]);

const browserNodeStatus: NodeStatus = {
  online: false,
  node_id: null,
  relay_connected: false,
  relay_url: null,
  direct_address_count: 0,
  lan_discovery_active: false,
  online_state: "offline",
};

const browserNodeSupervisorStatus: NodeSupervisorStatus = {
  phase: "failed",
  last_reason: "browser_preview",
  last_error: "Native runtime required",
  last_changed_unix: 0,
};

const browserBleDiscoveryStatus: BleDiscoveryStatus = {
  supported: false,
  enabled: false,
  permission_state: "unsupported",
  adapter_state: "unsupported",
  scanning: false,
  advertising: false,
  last_error: "Native Android runtime required",
};

const browserSettings: AppSettings = {
  download_dir: "Desktop app runtime required",
  auto_update_enabled: false,
  first_run_complete: true,
  relay_mode: "public",
  custom_relay_url: null,
  local_discovery_enabled: true,
  bluetooth_discovery_enabled: false,
  transfer_mode: "standard",
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
  bluetooth_discovery_enabled: false,
  download_dir_status: {
    exists: false,
    is_dir: false,
    writable: false,
    status: "desktop_runtime_required",
  },
  latest_route_kind: "unknown",
  node_supervisor: browserNodeSupervisorStatus,
  ble_status: browserBleDiscoveryStatus,
};

export const browserPlatformProfile: PlatformProfile = {
  platform_kind: "browser",
  runtime_family: "browser",
  target_os: "browser",
  transfer_engine: "native iroh app required",
  online_handoff_model: "web_handoff_to_native_iroh",
  storage_model: "handoff_only",
  release_support: "web_handoff_only",
  capabilities: {
    native_runtime: false,
    send_files: false,
    send_folders: false,
    receive_files: false,
    scan_receive_qr: false,
    local_discovery: false,
    bluetooth_discovery: false,
    nfc_ticket_handoff: false,
    relay_fallback: false,
    custom_relay: false,
    custom_receive_dir: false,
    public_downloads_export: false,
    smart_routing: false,
    auto_update: false,
    deep_link_receive: false,
    web_handoff_receive: true,
    background_transfer: false,
    browser_transfer: false,
    benchmark_required_for_speed_claims: true,
  },
  guidance: {
    storage_notice:
      "The browser page only preserves receive tickets and points users to the native app.",
    transfer_notice:
      "Browser preview cannot send or receive files because transfers stay inside native Tauri IPC and Rust.",
    online_notice:
      "Online sharing is a handoff link into the native iroh app. No WebRTC, HTTP transfer server, or WebSocket transfer path is used.",
    release_notice:
      "Use the Windows app or Android 10+ sideload build for real transfers.",
    benchmark_notice:
      "Do not claim speed leadership until repeatable benchmark results are published.",
  },
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
  return `${feature} requires the native Lightning P2P app runtime. Use \`pnpm tauri dev\`, the installed Windows app, or the Android 10+ sideload build instead of the browser preview.`;
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

export async function getLocalDeviceIdentity(): Promise<LocalDeviceIdentity | null> {
  if (!isDesktopRuntime()) {
    return null;
  }
  return invoke<LocalDeviceIdentity>("get_local_device_identity");
}

export async function getNodeStatus(): Promise<NodeStatus> {
  if (!isDesktopRuntime()) {
    return browserNodeStatus;
  }
  return invoke<NodeStatus>("get_node_status");
}

export async function getNodeSupervisorStatus(): Promise<NodeSupervisorStatus> {
  if (!isDesktopRuntime()) {
    return browserNodeSupervisorStatus;
  }
  return invoke<NodeSupervisorStatus>("get_node_supervisor_status");
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

export async function startReceive(ticket: string): Promise<string> {
  requireNativeRuntime("Receiving transfers");
  return invoke<string>("start_receive", { ticket });
}

export async function startReceiveDiscoveredShare(
  shareId: string,
): Promise<string> {
  requireNativeRuntime("Receiving nearby shares");
  return invoke<string>("start_receive_discovered_share", { shareId });
}

export async function getNearbyDevices(): Promise<NearbyDevice[]> {
  if (!isDesktopRuntime()) {
    return [];
  }
  return invoke<NearbyDevice[]>("get_nearby_devices");
}

export async function offerShareToPeer(
  nodeId: string,
  paths: string[],
): Promise<string> {
  requireNativeRuntime("Sending a nearby offer");
  return invoke<string>("offer_share_to_peer", { nodeId, paths });
}

export async function respondToOffer(
  offerId: string,
  accept: boolean,
): Promise<string | null> {
  requireNativeRuntime("Responding to a nearby offer");
  return invoke<string | null>("respond_to_offer", { offerId, accept });
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

export async function clearTransferHistory(): Promise<void> {
  requireNativeRuntime("Clearing transfer history");
  await invoke("clear_transfer_history");
}

export async function clearPeerCache(): Promise<void> {
  requireNativeRuntime("Clearing peer cache");
  await invoke("clear_peer_cache");
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

export async function getBleDiscoveryStatus(): Promise<BleDiscoveryStatus> {
  if (!isDesktopRuntime()) {
    return browserBleDiscoveryStatus;
  }
  return invoke<BleDiscoveryStatus>("get_ble_discovery_status");
}

export async function collectDiagnosticBundle(
  transferId?: string,
): Promise<DiagnosticBundle> {
  requireNativeRuntime("Diagnostic bundle collection");
  return invoke<DiagnosticBundle>("collect_diagnostic_bundle", {
    transferId: transferId ?? null,
  });
}

export function recordFrontendDiagnostic(message: string): void {
  if (!isTauri()) {
    return;
  }
  void invoke("record_frontend_diagnostic", { message }).catch(() => {
    // Diagnostics must never create a user-visible failure loop.
  });
}

export async function getPlatformProfile(): Promise<PlatformProfile> {
  if (!isNativeRuntime()) {
    return browserPlatformProfile;
  }
  return invoke<PlatformProfile>("get_platform_profile");
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

export async function setBluetoothDiscoveryEnabled(
  enabled: boolean,
): Promise<AppSettings> {
  requireNativeRuntime("Changing Bluetooth discovery settings");
  return invoke<AppSettings>("set_bluetooth_discovery_enabled", { enabled });
}

export async function setTransferMode(mode: TransferMode): Promise<AppSettings> {
  requireNativeRuntime("Changing transfer mode");
  return invoke<AppSettings>("set_transfer_mode", { mode });
}

export async function completeFirstRun(): Promise<AppSettings> {
  requireNativeRuntime("Completing setup");
  return invoke<AppSettings>("complete_first_run");
}

export async function openDownloadDir(): Promise<void> {
  requireNativeRuntime("Opening the download folder");
  await invoke("open_download_dir");
}

/**
 * Open an external https:// or http:// URL in the user's default browser
 * (or hand off to the OS handler on Android). Uses the Tauri shell plugin
 * so the URL is opened outside the embedded webview.
 */
export async function openExternalUrl(url: string): Promise<void> {
  const safeUrl = normalizeExternalUrl(url);
  if (!isTauri()) {
    window.open(safeUrl, "_blank", "noopener,noreferrer");
    return;
  }
  await shellOpen(safeUrl);
}

export function normalizeExternalUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("External URL must be absolute.");
  }
  if (!EXTERNAL_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("External URL must use http or https.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("External URL must not contain credentials.");
  }
  return parsed.href;
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

  const paths =
    typeof selected === "string"
      ? [selected]
      : Array.isArray(selected)
        ? selected
        : [];

  return resolveAndroidUris(paths);
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

  if (typeof selected !== "string") {
    return null;
  }
  const [resolved] = await resolveAndroidUris([selected]);
  return resolved ?? null;
}

/**
 * On Android, ask the Rust bridge to copy any `content://` SAF URIs into
 * the app cache and return regular filesystem paths so iroh-blobs can
 * `fs::metadata()` them. On other platforms this is a no-op identity.
 */
export async function resolveAndroidUris(paths: string[]): Promise<string[]> {
  if (!isMobileRuntime() || paths.length === 0) {
    return paths;
  }
  if (!paths.some((path) => path.startsWith("content://"))) {
    return paths;
  }
  try {
    return await invoke<string[]>("resolve_content_uris", { uris: paths });
  } catch (error) {
    console.error("resolve_content_uris failed", error);
    const appError = normalizeAppError(error);
    if (appError.source !== "unknown") {
      throw appError;
    }
    throw new Error("Could not read the selected file from the system picker.", {
      cause: error,
    });
  }
}

/**
 * Drains any files captured by the Android share-sheet handler since the
 * last call. Empty on non-Android. Call on app boot and on window focus
 * to handle cold-start and warm-start share intents.
 */
export async function drainPendingSharedFiles(): Promise<string[]> {
  if (!isMobileRuntime()) {
    return [];
  }
  try {
    return await invoke<string[]>("take_pending_shared_files");
  } catch (error) {
    console.error("take_pending_shared_files failed", error);
    return [];
  }
}

/**
 * Drain any Lightning P2P receive ticket dropped here via NFC tap or any
 * other side channel since the last call. Returns null if nothing queued.
 */
export async function drainPendingSharedTicket(): Promise<string | null> {
  if (!isMobileRuntime()) {
    return null;
  }
  try {
    const result = await invoke<string | null>("take_pending_shared_ticket");
    return result ?? null;
  } catch (error) {
    console.error("take_pending_shared_ticket failed", error);
    return null;
  }
}

/**
 * Start the experimental Lightning P2P BLE proximity discovery.
 * Pass the full local iroh NodeId as hex; the native bridge splits it into
 * small BLE frames. Returns whether advertise or scan started.
 */
export async function startBleDiscovery(nodeIdHex: string): Promise<boolean> {
  if (!isNativeRuntime()) {
    return false;
  }
  try {
    return await invoke<boolean>("start_ble_discovery", {
      nodeIdPrefixHex: nodeIdHex,
    });
  } catch (error) {
    console.error("start_ble_discovery failed", error);
    return false;
  }
}

/** Stop Lightning P2P BLE advertise + scan. Idempotent. */
export async function stopBleDiscovery(): Promise<void> {
  if (!isNativeRuntime()) {
    return;
  }
  try {
    await invoke("stop_ble_discovery");
  } catch (error) {
    console.error("stop_ble_discovery failed", error);
  }
}

/**
 * Opens the Android system folder UI for a MediaStore bucket. Buckets
 * are "Pictures" | "Movies" | "Music" | "Downloads".
 */
export async function openAndroidBucket(
  bucket: "Pictures" | "Movies" | "Music" | "Downloads",
): Promise<void> {
  if (!isMobileRuntime()) {
    throw new Error("openAndroidBucket is only available on Android");
  }
  await invoke("open_android_bucket", { bucket });
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

export function onNodeSupervisorStatus(
  callback: (status: NodeSupervisorStatus) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<NodeSupervisorStatus>(
    "node-supervisor-status",
    ({ payload }) => {
      callback(payload);
    },
  );
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

export function onNearbyDevicesUpdated(
  callback: (devices: NearbyDevice[]) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<NearbyDevice[]>("nearby-devices-updated", ({ payload }) => {
    callback(payload);
  });
}

export function onNearbyDiagnosticState(
  callback: (state: NearbyDiagnosticState) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<NearbyDiagnosticState>(
    "nearby-diagnostic-state",
    ({ payload }) => {
      callback(payload);
    },
  );
}

export function onIncomingOffer(
  callback: (offer: IncomingOffer) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<IncomingOffer>("nearby-offer-received", ({ payload }) => {
    callback(payload);
  });
}

export function onOfferResolved(
  callback: (resolution: OfferResolved) => void,
): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {});
  }

  return listen<OfferResolved>("nearby-offer-resolved", ({ payload }) => {
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
