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
  const primaryNavItems = navItems.filter((item) => item.id !== "settings");
  const secondaryNavItems = navItems.filter((item) => item.id === "settings");

  return (
    <aside className="relative z-10 flex w-[276px] shrink-0 flex-col border-r border-white/[0.05] px-4 pb-4 pt-3">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_18%)]" />
      <div className="relative flex min-h-0 flex-1 flex-col gap-4">
        <div className="sidebar-card p-4">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <img
                src={lightningMark}
                alt=""
                className="h-6 w-6 object-contain opacity-95"
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
                Lightning P2P
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-[0.22em] text-slate-500">
                Direct-first desktop transfers
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <div className={`chrome-pill ${routeTone(nodeStatus.online_state)}`}>
              <Radar className="h-3.5 w-3.5" />
              {routeLabel(nodeStatus.online_state)}
            </div>
            <div className="chrome-pill">
              <Sparkles className="h-3.5 w-3.5 text-sky-200/80" />
              {updateCopy(updatePhase)}
            </div>
          </div>
        </div>

        <section>
          <p className="nav-section-label">Transfer</p>
          <nav className="mt-2 flex flex-col gap-2">
            {primaryNavItems.map((item) => {
              const Icon = item.icon;
              const active = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`nav-button ${active ? "nav-button-active" : ""}`}
                >
                  {active ? (
                    <motion.div
                      layoutId="sidebar-active"
                      className="pointer-events-none absolute inset-0 rounded-[22px] bg-[linear-gradient(135deg,rgba(56,189,248,0.12),rgba(56,189,248,0.03)_58%,transparent)]"
                      transition={{ type: "spring", stiffness: 320, damping: 28 }}
                    />
                  ) : null}

                  <div
                    className={`nav-icon ${active ? "nav-icon-active" : ""}`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>

                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-semibold text-white">
                        {item.label}
                      </p>
                      {item.id === "receive" && receiveTransferCount > 0 ? (
                        <span className="inline-flex min-w-6 items-center justify-center rounded-full border border-emerald-300/15 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                          {receiveTransferCount}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-slate-400">
                      {item.id === "send"
                        ? "Stage and publish a share ticket"
                        : item.id === "receive"
                          ? "Paste a ticket and stream locally"
                          : "Inspect prior transfers and re-share"}
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </section>

        <section className="mt-1">
          <p className="nav-section-label">Workspace</p>
          <nav className="mt-2 flex flex-col gap-2">
            {secondaryNavItems.map((item) => {
              const Icon = item.icon;
              const active = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => onNavigate(item.id)}
                  className={`nav-button ${active ? "nav-button-active" : ""}`}
                >
                  {active ? (
                    <motion.div
                      layoutId="sidebar-secondary-active"
                      className="pointer-events-none absolute inset-0 rounded-[22px] bg-[linear-gradient(135deg,rgba(56,189,248,0.1),rgba(56,189,248,0.02)_58%,transparent)]"
                      transition={{ type: "spring", stiffness: 320, damping: 28 }}
                    />
                  ) : null}
                  <div
                    className={`nav-icon ${active ? "nav-icon-active" : ""}`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                  <div className="min-w-0 flex-1 text-left">
                    <p className="text-sm font-semibold text-white">
                      {item.label}
                    </p>
                    <p className="mt-1 text-[12px] leading-5 text-slate-400">
                      Relay, storage, and signed update controls
                    </p>
                  </div>
                </button>
              );
            })}
          </nav>
        </section>

        <div className="mt-auto sidebar-card p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="metric-label">Live transfers</p>
              <p className="metric-value mt-2 text-[1.9rem]">
                {activeTransferCount}
              </p>
            </div>
            <div className="rounded-[18px] border border-white/[0.06] bg-black/20 px-3 py-2 text-right">
              <p className="metric-label text-slate-500">Direct routes</p>
              <p className="mt-1 text-lg font-semibold tabular-nums text-white">
                {nodeStatus.direct_address_count}
              </p>
            </div>
          </div>

          <div
            className={`mt-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${routeTone(nodeStatus.online_state)}`}
          >
            <Radar className="h-3.5 w-3.5" />
            {nodeStatus.relay_connected ? "Reachable now" : "Waiting on relay"}
          </div>
          <p className="mt-3 text-[13px] leading-6 text-slate-400">
            Designed for fast, verified transfers across LAN and public
            internet paths without leaving the device.
          </p>
        </div>
      </div>
    </aside>
  );
}
