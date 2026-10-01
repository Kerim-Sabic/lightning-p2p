use lightning_p2p_lib::node::nearby_offer::FlickDirection;
use lightning_p2p_lib::node::nearby_protocol::WireBlobFormat;
use lightning_p2p_lib::node::{
    IncomingOffer, NearbyDevice, NearbyRouteHint, NearbyTransport, NodeSupervisorPhase,
    NodeSupervisorStatus,
};
use lightning_p2p_lib::storage::settings::{AppSettings, RelayModeSetting};
use lightning_p2p_lib::transfer::metrics::{RouteKind, TransferStrategy};
use lightning_p2p_lib::transfer::mode::TransferMode;
use lightning_p2p_lib::transfer::progress::{TransferEvent, TransferPhase};
use serde_json::Value;
use std::path::PathBuf;

fn contracts() -> Value {
    serde_json::from_str(include_str!("../../src/test-fixtures/ipc-contracts.json"))
        .expect("IPC fixture must be valid JSON")
}

#[test]
fn transfer_progress_event_matches_the_shared_contract() {
    let event = TransferEvent::Progress {
        transfer_id: "recv-1".into(),
        bytes: 128,
        total: 256,
        speed_bps: 64,
        route_kind: RouteKind::Relay,
        phase: TransferPhase::Downloading,
        connect_ms: 12,
        download_ms: 24,
        export_ms: 0,
        provider_count: 1,
        direct_provider_count: 0,
        relay_provider_count: 1,
        strategy: TransferStrategy::QueuedSingleProvider,
        first_byte_ms: 16,
        effective_mbps: 0,
    };

    assert_eq!(
        serde_json::to_value(event).expect("serialize event"),
        contracts()["transfer_progress"]
    );
}

#[test]
fn prepared_share_event_matches_the_shared_contract() {
    let event = TransferEvent::SharePrepared {
        transfer_id: "share-1".into(),
        hash: "abc123".into(),
        name: "photo.jpg".into(),
        size: 42,
        timestamp: 10,
    };

    assert_eq!(
        serde_json::to_value(event).expect("serialize event"),
        contracts()["share_prepared"]
    );
}

#[test]
fn app_settings_match_the_shared_contract() {
    let settings = AppSettings {
        download_dir: PathBuf::from("."),
        auto_update_enabled: false,
        first_run_complete: true,
        relay_mode: RelayModeSetting::Public,
        custom_relay_url: None,
        local_discovery_enabled: true,
        bluetooth_discovery_enabled: false,
        transfer_mode: TransferMode::SmartAuto,
        experimental_swarm_receive: false,
    };

    assert_eq!(
        serde_json::to_value(settings).expect("serialize settings"),
        contracts()["app_settings"]
    );
}

#[test]
fn nearby_payloads_match_the_shared_contract() {
    let offer = IncomingOffer {
        offer_id: "offer-1".into(),
        sender_node_id: "0123456789abcdef".into(),
        sender_device_name: "Sender".into(),
        label: "photo.jpg".into(),
        size: 42,
        blob_hash: "abc123".into(),
        blob_format: WireBlobFormat::HashSeq,
        file_count: Some(1),
        received_at_unix: 10,
        ready_to_catch: false,
        flick_direction: Some(FlickDirection::Right),
    };
    let device = NearbyDevice {
        node_id: "0123456789abcdef".into(),
        device_name: "Sender".into(),
        last_seen_unix: 10,
        transport: NearbyTransport::WifiMdns,
        route_hint: NearbyRouteHint::Direct,
        direct_address_count: 1,
        has_active_share: true,
    };
    let expected = contracts();

    assert_eq!(
        serde_json::to_value(offer).expect("serialize offer"),
        expected["incoming_offer"]
    );
    assert_eq!(
        serde_json::to_value(device).expect("serialize device"),
        expected["nearby_device"]
    );
}

#[test]
fn supervisor_status_matches_the_shared_contract() {
    let status = NodeSupervisorStatus {
        phase: NodeSupervisorPhase::Starting,
        last_reason: Some("app_startup".into()),
        last_error: None,
        last_changed_unix: 10,
    };

    assert_eq!(
        serde_json::to_value(status).expect("serialize status"),
        contracts()["node_supervisor_status"]
    );
}
