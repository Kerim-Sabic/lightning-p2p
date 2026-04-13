import { motion } from "framer-motion";
import {
  ArrowDownToLine,
  Clock3,
  Send,
  Settings2,
  Wifi,
  Zap,
} from "lucide-react";
import { useMemo } from "react";
import type { View } from "../App";
import { useTransferStore } from "../stores/transferStore";

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
}

const navItems: Array<{
  id: View;
  label: string;
  icon: typeof Send;
  accent: string;
}> = [
  { id: "send", label: "Send", icon: Send, accent: "sky" },
  { id: "receive", label: "Receive", icon: ArrowDownToLine, accent: "emerald" },
  { id: "history", label: "History", icon: Clock3, accent: "violet" },
  { id: "settings", label: "Settings", icon: Settings2, accent: "slate" },
];

function activeIconClass(accent: string): string {
  switch (accent) {
    case "sky":
      return "border-sky-400/25 bg-sky-500/14 text-sky-300";
    case "emerald":
      return "border-emerald-400/25 bg-emerald-500/14 text-emerald-300";
    case "violet":
      return "border-violet-400/25 bg-violet-500/14 text-violet-300";
    default:
      return "border-white/10 bg-white/[0.08] text-slate-200";
  }
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const transfers = useTransferStore((state) => state.transfers);

  const activeTransferCount = useMemo(
    () =>
      Object.values(transfers).filter(
        (transfer) =>
          transfer.status === "starting" || transfer.status === "running",
      ).length,
    [transfers],
  );

  return (
    <aside className="group/sidebar relative z-10 m-3 flex h-[calc(100%-1.5rem)] w-[72px] shrink-0 overflow-hidden rounded-[24px] border border-white/[0.07] bg-black/40 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-[width] duration-300 ease-out hover:w-64">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_50%)]" />
      <div className="relative flex h-full w-full flex-col">
        {/* Logo */}
        <div className="px-3 py-4">
          <div className="flex items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.04] px-2.5 py-2.5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[radial-gradient(circle_at_top_left,#60a5fa,#2563eb_60%,#1e40af)] shadow-[0_4px_20px_rgba(59,130,246,0.3)]">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
              <p className="text-sm font-semibold tracking-tight text-white">
                FastDrop
              </p>
              <p className="text-[11px] text-slate-500">P2P file transfer</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex flex-1 flex-col gap-1 px-2.5 py-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group/item relative overflow-hidden rounded-xl px-2.5 py-2.5 text-left transition-all duration-200 ${
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                }`}
              >
                <div className="relative flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-200 ${
                      active
                        ? activeIconClass(item.accent)
                        : "border-white/[0.06] bg-white/[0.03] text-slate-400"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>

                  <div className="flex min-w-0 flex-1 items-center justify-between opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
                    <span className="truncate text-[13px] font-medium">
                      {item.label}
                    </span>
                    {item.id === "receive" && activeTransferCount > 0 ? (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500/20 px-1.5 text-[10px] font-semibold text-sky-200">
                        {activeTransferCount}
                      </span>
                    ) : null}
                  </div>
                </div>

                {active ? (
                  <motion.div
                    layoutId="sidebar-active"
                    className="pointer-events-none absolute inset-0 rounded-xl border border-white/[0.08] bg-[linear-gradient(135deg,rgba(59,130,246,0.08),transparent)]"
                    transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Status */}
        <div className="px-2.5 pb-3">
          <div className="overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.04] p-2.5">
            <div className="flex items-center gap-3">
              <div
                className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 ${
                  nodeStatus.online
                    ? "border-emerald-400/20 bg-emerald-500/12 text-emerald-300"
                    : "border-white/[0.06] bg-white/[0.03] text-slate-400"
                }`}
              >
                <Wifi className="h-[18px] w-[18px]" />
                {nodeStatus.online ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                  </span>
                ) : null}
              </div>
              <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
                <p className="text-[13px] font-medium text-white">
                  {nodeStatus.online ? "Online" : "Booting"}
                </p>
                <p className="text-[11px] text-slate-500">
                  {nodeStatus.online ? "Ready for transfers" : "Starting node"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
