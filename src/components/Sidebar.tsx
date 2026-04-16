import {
  ArrowDownToLine,
  Clock3,
  Radar,
  Send,
  Settings2,
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
      return "Warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Starting";
  }
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const { activeTransferCount, nodeStatus, receiveTransferCount } =
    useNavigationSnapshot();

  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-white/[0.05] px-3 pb-3 pt-4">
      <div className="sidebar-card px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[16px] border border-white/[0.08] bg-white/[0.03]">
            <img
              src={lightningMark}
              alt=""
              className="h-5 w-5 object-contain opacity-95"
            />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-[-0.02em] text-white">
              Lightning P2P
            </p>
            <p className="truncate text-[11px] text-slate-500">
              Direct-first transfer
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-400">
          <span className="chrome-pill px-2.5 py-1">
            <Radar className="h-3 w-3 text-sky-200/80" />
            {routeLabel(nodeStatus.online_state)}
          </span>
          {activeTransferCount > 0 ? (
            <span className="text-slate-500">{activeTransferCount} live</span>
          ) : null}
        </div>
      </div>

      <nav className="mt-4 flex flex-col gap-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          const badge =
            item.id === "receive" && receiveTransferCount > 0
              ? receiveTransferCount
              : null;

          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`nav-button ${active ? "nav-button-active" : ""}`}
            >
              <div className={`nav-icon ${active ? "nav-icon-active" : ""}`}>
                <Icon className="h-[17px] w-[17px]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-white">
                    {item.label}
                  </span>
                  {badge ? (
                    <span className="rounded-full border border-emerald-400/15 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-100">
                      {badge}
                    </span>
                  ) : null}
                </div>
              </div>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
