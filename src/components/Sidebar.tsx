import { motion } from "framer-motion";
import { ArrowDownToLine, Clock3, Send, Settings2, Wifi } from "lucide-react";
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
}> = [
  { id: "send", label: "Send", icon: Send },
  { id: "receive", label: "Receive", icon: ArrowDownToLine },
  { id: "history", label: "History", icon: Clock3 },
  { id: "settings", label: "Settings", icon: Settings2 },
];

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
    <aside className="group/sidebar relative z-10 m-3 hidden h-[calc(100%-1.5rem)] w-20 shrink-0 overflow-hidden rounded-[28px] border border-white/10 bg-black/30 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl transition-[width] duration-300 hover:w-72 lg:flex">
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02))]" />
      <div className="relative flex h-full w-full flex-col">
        <div className="px-4 py-5">
          <div className="flex items-center gap-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[radial-gradient(circle_at_top_left,#60a5fa,#2563eb_65%,#0f172a)] shadow-[0_18px_40px_rgba(59,130,246,0.35)]">
              <Send className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
              <p className="text-base font-semibold tracking-tight text-white">
                FastDrop
              </p>
              <p className="text-xs text-slate-400">
                Premium peer-to-peer transfers
              </p>
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-2 px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group/item relative overflow-hidden rounded-2xl px-3 py-3 text-left transition-all ${
                  active
                    ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
                }`}
              >
                <div className="relative flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                      active
                        ? "border-sky-400/25 bg-sky-500/12 text-sky-300"
                        : "border-white/10 bg-white/5 text-slate-300"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="flex min-w-0 flex-1 items-center justify-between opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
                    <span className="truncate text-sm font-medium">
                      {item.label}
                    </span>
                    {item.id === "receive" && activeTransferCount > 0 ? (
                      <span className="rounded-full border border-sky-400/20 bg-sky-500/12 px-2 py-0.5 text-[11px] text-sky-200">
                        {activeTransferCount}
                      </span>
                    ) : null}
                  </div>
                </div>

                {active ? (
                  <motion.div
                    layoutId="sidebar-active"
                    className="pointer-events-none absolute inset-0 rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(59,130,246,0.16),rgba(255,255,255,0.04))]"
                    transition={{ type: "spring", stiffness: 320, damping: 28 }}
                  />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div className="px-3 pb-3">
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                  nodeStatus.online
                    ? "border-emerald-400/20 bg-emerald-500/12 text-emerald-300"
                    : "border-white/10 bg-white/5 text-slate-400"
                }`}
              >
                <Wifi className="h-5 w-5" />
              </div>
              <div className="min-w-0 opacity-0 transition-opacity duration-200 group-hover/sidebar:opacity-100">
                <p className="text-sm font-medium text-white">
                  {nodeStatus.online ? "Online" : "Booting"}
                </p>
                <p className="text-xs text-slate-400">
                  {nodeStatus.online
                    ? "Ready for transfers"
                    : "Starting node"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
