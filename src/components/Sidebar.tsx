import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  Clock3,
  Radar,
  Send,
  Settings2,
  Sparkles,
} from "lucide-react";
import type { View } from "../App";
import lightningMark from "../assets/lightning-p2p-mark.png";
import { useNavigationSnapshot } from "../stores/transferSelectors";

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof Send;
}> = [
  { id: "send", label: "Send", icon: Send },
  { id: "receive", label: "Receive", icon: ArrowDownToLine },
  { id: "history", label: "History", icon: Clock3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function routeLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay ready";
    case "degraded":
      return "Routes warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Booting";
  }
}

function routeTone(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "border-emerald-400/20 bg-emerald-500/12 text-emerald-100";
    case "relay_ready":
      return "border-sky-400/20 bg-sky-500/12 text-sky-100";
    case "degraded":
      return "border-amber-400/20 bg-amber-500/12 text-amber-100";
    case "offline":
      return "border-rose-400/20 bg-rose-500/12 text-rose-100";
    case "starting":
    default:
      return "border-white/10 bg-white/[0.05] text-slate-100";
  }
}

function updateCopy(updatePhase: string): string {
  return updatePhase === "available"
    ? "Update ready"
    : updatePhase === "downloading"
      ? "Updating"
      : "Current";
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const { activeTransferCount, nodeStatus, receiveTransferCount, updatePhase } =
    useNavigationSnapshot();

  return (
    <aside className="relative z-10 m-4 flex h-[calc(100%-2rem)] w-[248px] shrink-0 overflow-hidden rounded-[28px] border border-white/10 bg-black/30 shadow-[0_20px_70px_rgba(2,6,23,0.44)]">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),transparent_22%,transparent)]" />
      <div className="relative flex h-full w-full flex-col px-4 py-4">
        <div className="rounded-[24px] border border-white/8 bg-white/[0.035] p-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <img
                src={lightningMark}
                alt=""
                className="h-7 w-7 object-contain opacity-95"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold tracking-tight text-white">
                Lightning P2P
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-300/70">
                Direct-first desktop transfers.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${routeTone(nodeStatus.online_state)}`}
          >
            <Radar className="h-3.5 w-3.5" />
            {routeLabel(nodeStatus.online_state)}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200">
            <Sparkles className="h-3.5 w-3.5 text-violet-200" />
            {updateCopy(updatePhase)}
          </div>
        </div>

        <nav className="mt-5 flex flex-1 flex-col gap-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group relative overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
                  active
                    ? "border-white/12 bg-white/[0.08]"
                    : "border-transparent bg-white/[0.02] hover:border-white/8 hover:bg-white/[0.045]"
                }`}
              >
                {active ? (
                  <motion.div
                    layoutId="sidebar-active"
                    className="pointer-events-none absolute inset-0 rounded-2xl bg-[linear-gradient(135deg,rgba(56,189,248,0.14),rgba(99,102,241,0.08)_55%,transparent)]"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                ) : null}

                <div className="relative flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border ${
                      active
                        ? "border-sky-300/20 bg-sky-500/14 text-sky-100"
                        : "border-white/8 bg-white/[0.04] text-slate-300"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-white">
                        {item.label}
                      </p>
                      {item.id === "receive" && receiveTransferCount > 0 ? (
                        <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-500/14 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                          {receiveTransferCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="rounded-[24px] border border-white/8 bg-white/[0.03] p-3.5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Live transfers
              </p>
              <p className="mt-1.5 text-2xl font-semibold tabular-nums text-white">
                {activeTransferCount}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Direct
              </p>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-white">
                {nodeStatus.direct_address_count}
              </p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
