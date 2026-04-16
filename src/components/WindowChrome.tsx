import { Copy, Minus, Radar, Square, X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import type { View } from "../App";
import lightningMark from "../assets/lightning-p2p-mark.png";
import {
  closeDesktopWindow,
  getDesktopWindowState,
  isDesktopRuntime,
  minimizeDesktopWindow,
  onDesktopWindowFocusChanged,
  toggleDesktopWindowMaximize,
} from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";

interface WindowChromeProps {
  currentView: View;
}

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
  const desktopRuntime = isDesktopRuntime();
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const activeTransferCount = useTransferStore(
    (state) =>
      Object.values(state.transfers).filter(
        (transfer) =>
          transfer.status === "starting" || transfer.status === "running",
      ).length,
  );
  const setError = useTransferStore((state) => state.setError);
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

    let unlistenFocus: (() => void) | null = null;

    void onDesktopWindowFocusChanged((focused) => {
      setWindowState((current) => ({
        ...current,
        focused,
      }));
    }).then((fn) => {
      unlistenFocus = fn;
    });

    return () => {
      unlistenFocus?.();
    };
  }, [desktopRuntime, syncWindowState]);

  const runWindowAction = useEffectEvent(
    async (
      action: () => Promise<void>,
      afterSuccess?: (previous: typeof windowState) => typeof windowState,
    ) => {
      if (!desktopRuntime) {
        return;
      }

      try {
        await action();
        if (afterSuccess) {
          setWindowState((current) => afterSuccess(current));
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Window action failed");
      }
    },
  );

  return (
    <header
      className={`window-chrome ${windowState.focused ? "opacity-100" : "opacity-90"}`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[16px] border border-white/[0.08] bg-white/[0.03]">
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
            {viewLabel(currentView)}
          </p>
        </div>
      </div>

      <div
        data-tauri-drag-region
        onDoubleClick={() =>
          void runWindowAction(() => toggleDesktopWindowMaximize(), (current) => ({
            ...current,
            maximized: !current.maximized,
          }))
        }
        className="mx-4 flex min-w-0 flex-1 items-center justify-center"
      >
        <div className="chrome-pill">
          <Radar className="h-3.5 w-3.5 text-sky-200/80" />
          <span>{routeLabel(nodeStatus.online_state)}</span>
          {activeTransferCount > 0 ? (
            <span className="text-slate-500">{activeTransferCount} live</span>
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
              void runWindowAction(() => toggleDesktopWindowMaximize(), (current) => ({
                ...current,
                maximized: !current.maximized,
              }))
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
