import { Copy, Gauge, Minus, Radar, Square, X } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";
import type { View } from "../App";
import lightningMark from "../assets/lightning-p2p-mark.png";
import { formatSpeed } from "../lib/format";
import {
  closeDesktopWindow,
  getDesktopWindowState,
  isDesktopRuntime,
  minimizeDesktopWindow,
  onDesktopWindowFocusChanged,
  onDesktopWindowResized,
  toggleDesktopWindowMaximize,
} from "../lib/tauri";
import { useOverviewSnapshot } from "../stores/transferSelectors";
import { useTransferStore } from "../stores/transferStore";

interface WindowChromeProps {
  currentView: View;
}

function routeLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay-assisted";
    case "degraded":
      return "Routes warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Starting";
  }
}

function routeTone(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "bg-emerald-400";
    case "relay_ready":
      return "bg-sky-400";
    case "degraded":
      return "bg-amber-300";
    case "offline":
      return "bg-rose-400";
    case "starting":
    default:
      return "bg-slate-500";
  }
}

function viewLabel(view: View): string {
  switch (view) {
    case "receive":
      return "Receive";
    case "history":
      return "History";
    case "settings":
      return "Settings";
    case "send":
    default:
      return "Send";
  }
}

export function WindowChrome({ currentView }: WindowChromeProps) {
  const overview = useOverviewSnapshot();
  const setError = useTransferStore((state) => state.setError);
  const desktopRuntime = isDesktopRuntime();
  const [windowState, setWindowState] = useState({
    focused: true,
    maximized: false,
  });

  const syncWindowState = useEffectEvent(async () => {
    const nextState = await getDesktopWindowState();
    setWindowState(nextState);
  });

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }

    void syncWindowState();

    let unlistenResize: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    void onDesktopWindowResized(() => {
      void syncWindowState();
    }).then((fn) => {
      unlistenResize = fn;
    });

    void onDesktopWindowFocusChanged((focused) => {
      setWindowState((current) => ({
        ...current,
        focused,
      }));
    }).then((fn) => {
      unlistenFocus = fn;
    });

    return () => {
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, [desktopRuntime, syncWindowState]);

  const statusText = useMemo(() => {
    const transferCount = overview.activeTransferCount;
    const throughput =
      transferCount > 0 ? formatSpeed(overview.combinedSpeedBps) : "Idle";

    return {
      routeLabel: routeLabel(overview.nodeStatus.online_state),
      transferCopy:
        transferCount > 0
          ? `${transferCount} live transfer${transferCount === 1 ? "" : "s"}`
          : "No active transfers",
      throughput,
    };
  }, [
    overview.activeTransferCount,
    overview.combinedSpeedBps,
    overview.nodeStatus.online_state,
  ]);

  const runWindowAction = useEffectEvent(
    async (action: () => Promise<void>, syncAfter = false) => {
      if (!desktopRuntime) {
        return;
      }

      try {
        await action();
        if (syncAfter) {
          await syncWindowState();
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Window action failed");
      }
    },
  );

  return (
    <header
      className={`window-chrome transition-opacity duration-200 ${
        windowState.focused ? "opacity-100" : "opacity-90"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[18px] border border-white/[0.08] bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <img
            src={lightningMark}
            alt=""
            className="h-5 w-5 object-contain opacity-95"
          />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold tracking-[-0.02em] text-white">
              Lightning P2P
            </p>
            <span className="hidden rounded-full border border-white/[0.07] bg-white/[0.04] px-2.5 py-1 text-[10px] uppercase tracking-[0.24em] text-slate-400 xl:inline-flex">
              {viewLabel(currentView)}
            </span>
          </div>
          <p className="truncate text-[11px] tracking-[0.16em] text-slate-500">
            Direct-first peer-to-peer transfer
          </p>
        </div>
      </div>

      <div
        data-tauri-drag-region
        onDoubleClick={() =>
          void runWindowAction(() => toggleDesktopWindowMaximize(), true)
        }
        className="mx-4 flex min-w-0 flex-1 items-center justify-center"
      >
        <div className="hidden items-center gap-2 xl:flex">
          <div className="chrome-pill">
            <span
              className={`h-2 w-2 rounded-full ${routeTone(overview.nodeStatus.online_state)}`}
            />
            <span>{statusText.routeLabel}</span>
          </div>
          <div className="chrome-pill">
            <Gauge className="h-3.5 w-3.5 text-sky-200/80" />
            <span>{statusText.throughput}</span>
          </div>
          <div className="chrome-pill">
            <Radar className="h-3.5 w-3.5 text-slate-300/72" />
            <span>{statusText.transferCopy}</span>
          </div>
          {!desktopRuntime ? (
            <div className="chrome-pill">Browser preview</div>
          ) : null}
        </div>
      </div>

      {desktopRuntime ? (
        <div className="ml-4 flex items-center gap-1">
          <button
            onClick={() => void runWindowAction(() => minimizeDesktopWindow())}
            className="window-control-button"
            aria-label="Minimize window"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            onClick={() =>
              void runWindowAction(() => toggleDesktopWindowMaximize(), true)
            }
            className="window-control-button"
            aria-label={
              windowState.maximized ? "Restore window" : "Maximize window"
            }
          >
            {windowState.maximized ? (
              <Copy className="h-3.5 w-3.5" />
            ) : (
              <Square className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={() => void runWindowAction(() => closeDesktopWindow())}
            className="window-control-button window-control-button-danger"
            aria-label="Close window"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </header>
  );
}
