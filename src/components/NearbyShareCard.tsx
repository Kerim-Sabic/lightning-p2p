import { ArrowDownToLine, LaptopMinimal, Radar } from "lucide-react";
import { formatBytes } from "../lib/format";
import type { NearbyShare } from "../lib/tauri";

interface NearbyShareCardProps {
  share: NearbyShare;
  disabled: boolean;
  onReceive: (share: NearbyShare) => void;
}

function freshnessLabel(seconds: number): string {
  if (seconds <= 3) {
    return "just seen";
  }
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  return `${Math.floor(seconds / 3600)}h ago`;
}

function routeLabel(routeHint: NearbyShare["route_hint"]): string {
  switch (routeHint) {
    case "direct":
      return "Direct";
    case "relay":
      return "Relay";
    case "mixed":
      return "Direct + relay";
    case "unknown":
    default:
      return "Detecting";
  }
}

export function NearbyShareCard({
  share,
  disabled,
  onReceive,
}: NearbyShareCardProps) {
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
                {share.label}
              </p>
              <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-300">
                <Radar className="mr-1 inline h-3 w-3 text-sky-200/80" />
                {routeLabel(share.route_hint)}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-300/72">
              {share.device_name} | {formatBytes(share.size)} | Seen{" "}
              {freshnessLabel(share.freshness_seconds)}
            </p>
          </div>
        </div>

        <button
          onClick={() => onReceive(share)}
          disabled={disabled}
          className="btn-success shrink-0 px-4 py-2.5"
        >
          <span className="relative inline-flex items-center gap-2">
            <ArrowDownToLine className="h-4 w-4" />
            Receive
          </span>
        </button>
      </div>

      <div className="flex flex-wrap gap-3 text-[12px] text-slate-400">
        <span>Direct addresses {share.direct_address_count}</span>
        <span className="truncate font-mono text-slate-500">{share.node_id}</span>
      </div>
    </article>
  );
}
