import { Radar, ScanSearch, Send } from "lucide-react";
import { useState } from "react";
import {
  isDesktopRuntime,
  offerShareToPeer,
  pickShareFiles,
  type NearbyDevice,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useNearbyDeviceStore } from "../stores/nearbyDeviceStore";
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
  const recordOutbound = useIncomingOfferStore((state) => state.recordOutbound);
  const nativeRuntime = isDesktopRuntime();
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);

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
            <p className="metric-label">Pushing files</p>
            <p className="text-sm leading-6 text-slate-300/80">
              Pick a device, then choose files in the system picker. The
              receiver sees a prompt and either accepts the transfer or
              declines it.
            </p>
            <p className="text-xs leading-6 text-slate-500">
              Offers auto-expire after one minute without a response.
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
            <div className="glass-subtle flex flex-col items-center gap-2 px-5 py-10 text-center">
              <Radar className="h-5 w-5 text-sky-200/70" />
              <p className="text-base font-semibold text-white">
                Looking for nearby devices...
              </p>
              <p className="meta-copy">
                Open Lightning P2P on another device on the same network and it
                should appear here within a second or two.
              </p>
            </div>
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
