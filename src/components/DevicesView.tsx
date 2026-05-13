import {
  LaptopMinimal,
  QrCode,
  Radar,
  ScanSearch,
  Send,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getLocalDeviceIdentity,
  isDesktopRuntime,
  offerShareToPeer,
  pickShareFiles,
  type LocalDeviceIdentity,
  type NearbyDevice,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useNearbyDeviceStore } from "../stores/nearbyDeviceStore";
import { useNearbyDiagnosticStore } from "../stores/nearbyDiagnosticStore";
import { useTransferStore } from "../stores/transferStore";
import { DeviceCard } from "./DeviceCard";

function networkLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay ready";
    case "degraded":
      return "Warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Starting";
  }
}

export function DevicesView() {
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const settings = useTransferStore((state) => state.settings);
  const setError = useTransferStore((state) => state.setError);
  const devices = useNearbyDeviceStore((state) => state.devices);
  const diagnosticState = useNearbyDiagnosticStore((state) => state.state);
  const recordOutbound = useIncomingOfferStore((state) => state.recordOutbound);
  const nativeRuntime = isDesktopRuntime();
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;
  const networkLikelyBlocked =
    diagnosticState === "likely_blocked" &&
    localDiscoveryEnabled &&
    devices.length === 0;
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [localIdentity, setLocalIdentity] =
    useState<LocalDeviceIdentity | null>(null);

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }
    let active = true;
    // Refresh whenever the node finishes coming online (node_id flip from null
    // to set) so the identity card never reads "starting" once the endpoint
    // is bound.
    void getLocalDeviceIdentity().then((identity) => {
      if (active) {
        setLocalIdentity(identity);
      }
    });
    return () => {
      active = false;
    };
  }, [nativeRuntime, nodeStatus.node_id]);

  const handleSend = async (device: NearbyDevice): Promise<void> => {
    setError(null);
    let paths: string[];
    try {
      paths = await pickShareFiles();
    } catch (error) {
      setError(error instanceof Error ? error.message : "File picker failed");
      return;
    }

    if (paths.length === 0) {
      return;
    }

    setBusyNodeId(device.node_id);
    try {
      const offerId = await offerShareToPeer(device.node_id, paths);
      recordOutbound({
        offerId,
        receiverNodeId: device.node_id,
        status: "accepted",
        message: `Accepted by ${device.device_name}`,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send offer";
      setError(message);
    } finally {
      setBusyNodeId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="glass-panel p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="glass-icon h-14 w-14 rounded-[20px]">
              <Send className="h-6 w-6 text-emerald-200" />
            </div>
            <p className="page-eyebrow mt-5">Devices</p>
            <h1 className="mt-2 text-[clamp(1.8rem,1.6rem+0.8vw,2.4rem)] font-semibold tracking-[-0.04em] text-white">
              Tap a nearby device to send
            </h1>
            <p className="meta-copy mt-3 max-w-[58ch]">
              Discovered peers appear here as soon as they're seen on the local
              network. Picking files pushes them to that device — the receiver
              taps to accept before any bytes move.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="chrome-pill">
                Network {networkLabel(nodeStatus.online_state)}
              </span>
              <span className="chrome-pill">
                {localDiscoveryEnabled
                  ? "Nearby discovery enabled"
                  : "Nearby discovery disabled"}
              </span>
              <span className="chrome-pill">{devices.length} visible</span>
            </div>
          </div>

          <div className="glass-subtle flex w-full max-w-[340px] flex-col gap-3 px-4 py-4">
            <p className="metric-label">You're visible as</p>
            <div className="flex items-start gap-3">
              <div className="glass-icon h-10 w-10 shrink-0">
                <LaptopMinimal className="h-4 w-4 text-emerald-200" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {localIdentity?.device_name ?? "Detecting device name..."}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-400">
                  {localIdentity
                    ? `${localIdentity.short_node_id}...`
                    : "Waiting for node id..."}
                </p>
              </div>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              Other devices running Lightning P2P on the same network see
              this name and node id. Pick a device, choose files, the
              receiver accepts. Offers auto-expire after one minute.
            </p>
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Nearby devices</p>
            <p className="meta-copy mt-1">
              All discovered peers, regardless of whether they have an active
              share.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ScanSearch className="h-4 w-4 text-sky-200/80" />
            {localDiscoveryEnabled
              ? "Scanning the local network"
              : "Turn on nearby discovery in Settings"}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!localDiscoveryEnabled ? (
            <div className="glass-subtle px-5 py-8 text-center">
              <p className="text-base font-semibold text-white">
                Nearby discovery is off
              </p>
              <p className="meta-copy mt-2">
                Enable local discovery in Settings to see nearby devices
                appear automatically.
              </p>
            </div>
          ) : devices.length === 0 ? (
            networkLikelyBlocked ? (
              <div className="glass-subtle flex flex-col items-center gap-3 px-5 py-8 text-center">
                <WifiOff className="h-5 w-5 text-amber-200/80" />
                <p className="text-base font-semibold text-white">
                  This network may be blocking multicast
                </p>
                <p className="meta-copy max-w-[44ch]">
                  Lightning P2P uses multicast for instant nearby discovery,
                  and some hotel, guest, and enterprise Wi-Fi networks silently
                  drop those packets. The app is healthy &mdash; you just
                  haven't seen a peer.
                </p>
                <div className="mt-1 flex items-center gap-2 text-xs text-amber-100/90">
                  <QrCode className="h-3.5 w-3.5" />
                  <span>
                    Use Send to generate a QR or ticket the receiver can paste
                    instead.
                  </span>
                </div>
              </div>
            ) : (
              <div className="glass-subtle flex flex-col items-center gap-2 px-5 py-10 text-center">
                <Radar className="h-5 w-5 text-sky-200/70" />
                <p className="text-base font-semibold text-white">
                  Looking for nearby devices...
                </p>
                <p className="meta-copy">
                  Open Lightning P2P on the other device too &mdash; they'll
                  appear here within a second once both apps are running on the
                  same Wi-Fi.
                </p>
              </div>
            )
          ) : (
            devices.map((device) => (
              <DeviceCard
                key={device.node_id}
                device={device}
                busy={busyNodeId === device.node_id}
                disabled={!nativeRuntime}
                onSend={(target) => void handleSend(target)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}
