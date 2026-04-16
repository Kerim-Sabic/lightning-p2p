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
    return "Just seen";
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
      return "Direct path";
    case "relay":
      return "Relay fallback";
    case "mixed":
      return "Direct + relay";
    case "unknown":
    default:
      return "Route warming";
  }
}

function routeTone(routeHint: NearbyShare["route_hint"]): string {
  switch (routeHint) {
    case "direct":
      return "border-emerald-400/20 bg-emerald-500/10 text-emerald-100";
    case "relay":
      return "border-sky-400/20 bg-sky-500/10 text-sky-100";
    case "mixed":
      return "border-cyan-400/20 bg-cyan-500/10 text-cyan-100";
    case "unknown":
    default:
      return "border-white/10 bg-white/[0.04] text-slate-200";
  }
}

export function NearbyShareCard({
  share,
  disabled,
  onReceive,
}: NearbyShareCardProps) {
  return (
    <article className="glass-subtle flex flex-col gap-4 p-5">
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
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.22em] ${routeTone(
                  share.route_hint,
                )}`}
              >
                <Radar className="h-3 w-3" />
                {routeLabel(share.route_hint)}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-6 text-slate-300/72">
              {share.device_name} · {formatBytes(share.size)} · Seen{" "}
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

      <div className="grid gap-2 text-[12px] text-slate-400 md:grid-cols-3">
        <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
          <p className="metric-label">Sender</p>
          <p className="mt-1 truncate text-sm font-medium text-slate-100/88">
            {share.device_name}
          </p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
          <p className="metric-label">Direct addresses</p>
          <p className="mt-1 text-sm font-medium text-slate-100/88">
            {share.direct_address_count}
          </p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-3">
          <p className="metric-label">Node</p>
          <p className="mt-1 truncate font-mono text-[11px] text-slate-100/80">
            {share.node_id}
          </p>
        </div>
      </div>
    </article>
  );
}
