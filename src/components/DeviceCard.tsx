import { Bluetooth, LaptopMinimal, Radar, Send, Wifi } from "lucide-react";
import type { NearbyDevice } from "../lib/tauri";

interface DeviceCardProps {
  device: NearbyDevice;
  busy: boolean;
  disabled: boolean;
  onSend: (device: NearbyDevice) => void;
}

function transportLabel(transport: NearbyDevice["transport"]): string {
  switch (transport) {
    case "wifi_mdns":
      return "Wi-Fi";
    case "ble":
      return "Bluetooth";
    case "both":
      return "Wi-Fi + Bluetooth";
    default:
      return "Nearby";
  }
}

function TransportIcon({
  transport,
}: {
  transport: NearbyDevice["transport"];
}) {
  if (transport === "ble") {
    return <Bluetooth className="h-3 w-3 text-sky-200/80" />;
  }
  if (transport === "both") {
    return <Radar className="h-3 w-3 text-sky-200/80" />;
  }
  return <Wifi className="h-3 w-3 text-sky-200/80" />;
}

function routeLabel(routeHint: NearbyDevice["route_hint"]): string {
  switch (routeHint) {
    case "direct":
      return "Direct route";
    case "relay":
      return "Via relay";
    case "mixed":
      return "Direct + relay";
    case "unknown":
    default:
      return "Detecting route";
  }
}

function lastSeenLabel(unix: number): string {
  if (unix === 0) {
    return "just now";
  }
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds <= 3) {
    return "just now";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function DeviceCard({
  device,
  busy,
  disabled,
  onSend,
}: DeviceCardProps) {
  return (
    <article className="glass-subtle flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="glass-icon shrink-0">
            <LaptopMinimal className="h-4 w-4 text-sky-200" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-sm font-semibold text-white">
                {device.device_name}
              </p>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                <span className="mr-1 inline-flex items-center align-middle">
                  <TransportIcon transport={device.transport} />
                </span>
                {transportLabel(device.transport)}
              </span>
              {device.has_active_share ? (
                <span className="rounded-full border border-emerald-300/20 bg-emerald-500/[0.08] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-emerald-100">
                  Active share
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-300/72">
              {routeLabel(device.route_hint)} | Seen{" "}
              {lastSeenLabel(device.last_seen_unix)}
            </p>
          </div>
        </div>

        <button
          onClick={() => onSend(device)}
          disabled={disabled || busy}
          className="btn-success shrink-0 px-4 py-2.5"
        >
          <span className="relative inline-flex items-center gap-2">
            <Send className="h-4 w-4" />
            {busy ? "Sending..." : "Send"}
          </span>
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-[12px] text-slate-400">
        <span>Direct addresses {device.direct_address_count}</span>
        <span className="truncate font-mono text-slate-500">
          {device.node_id}
        </span>
      </div>
    </article>
  );
}
