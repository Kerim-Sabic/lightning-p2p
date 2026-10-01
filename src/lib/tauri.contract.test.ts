import { describe, expect, it } from "vitest";
import contracts from "../test-fixtures/ipc-contracts.json";
import type {
  AppSettings,
  IncomingOffer,
  NearbyDevice,
  NodeSupervisorStatus,
  TransferEvent,
} from "./tauri";

describe("shared Rust and TypeScript IPC contracts", () => {
  it("keeps transfer, settings, nearby, and supervisor payloads aligned", () => {
    const transferProgress: Extract<TransferEvent, { type: "progress" }> = {
      type: "progress",
      transfer_id: "recv-1",
      bytes: 128,
      total: 256,
      speed_bps: 64,
      route_kind: "relay",
      phase: "downloading",
      connect_ms: 12,
      download_ms: 24,
      export_ms: 0,
      provider_count: 1,
      direct_provider_count: 0,
      relay_provider_count: 1,
      strategy: "queued_single_provider",
      first_byte_ms: 16,
      effective_mbps: 0,
    };
    const sharePrepared: Extract<TransferEvent, { type: "share_prepared" }> = {
      type: "share_prepared",
      transfer_id: "share-1",
      hash: "abc123",
      name: "photo.jpg",
      size: 42,
      timestamp: 10,
    };
    const settings: AppSettings = {
      download_dir: ".",
      auto_update_enabled: false,
      first_run_complete: true,
      relay_mode: "public",
      custom_relay_url: null,
      local_discovery_enabled: true,
      bluetooth_discovery_enabled: false,
      transfer_mode: "smart_auto",
      experimental_swarm_receive: false,
    };
    const incomingOffer: IncomingOffer = {
      offer_id: "offer-1",
      sender_node_id: "0123456789abcdef",
      sender_device_name: "Sender",
      label: "photo.jpg",
      size: 42,
      blob_hash: "abc123",
      blob_format: "hash_seq",
      file_count: 1,
      received_at_unix: 10,
      ready_to_catch: false,
      flick_direction: "right",
    };
    const nearbyDevice: NearbyDevice = {
      node_id: "0123456789abcdef",
      device_name: "Sender",
      last_seen_unix: 10,
      transport: "wifi_mdns",
      route_hint: "direct",
      direct_address_count: 1,
      has_active_share: true,
    };
    const supervisorStatus: NodeSupervisorStatus = {
      phase: "starting",
      last_reason: "app_startup",
      last_error: null,
      last_changed_unix: 10,
    };

    expect(transferProgress).toEqual(contracts.transfer_progress);
    expect(sharePrepared).toEqual(contracts.share_prepared);
    expect(settings).toEqual(contracts.app_settings);
    expect(incomingOffer).toEqual(contracts.incoming_offer);
    expect(nearbyDevice).toEqual(contracts.nearby_device);
    expect(supervisorStatus).toEqual(contracts.node_supervisor_status);
  });
});
