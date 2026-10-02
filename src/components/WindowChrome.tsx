import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import type { View } from "../App";
import lightningMark from "../assets/lightning-p2p-mark.png";
import { attachAsyncUnlisten } from "../hooks/asyncSubscription";
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

function viewLabel(view: View): string {
  switch (view) {
    case "devices":
      return "Devices";
    case "receive":
      return "Receive";
    case "history":
      return "Activity";
    case "settings":
      return "Settings";
    case "send":
    default:
      return "Transfer";
  }
}

export function WindowChrome({ currentView }: WindowChromeProps) {
  const desktopRuntime = isDesktopRuntime();
  const platformProfile = useTransferStore((state) => state.platformProfile);
  // macOS renders native traffic lights over the top-left of the overlay
  // title bar, so inset the brand block and skip the custom controls.
  const isMac = platformProfile.platform_kind === "macos";
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

    return attachAsyncUnlisten(
      onDesktopWindowFocusChanged((focused) => {
        setWindowState((current) => ({
          ...current,
          focused,
        }));
      }),
      (error: unknown) =>
        setError(
          error instanceof Error ? error.message : "Window listener failed",
        ),
    );
  }, [desktopRuntime, setError, syncWindowState]);

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
        setError(
          error instanceof Error ? error.message : "Window action failed",
        );
      }
    },
  );

  return (
    <header
      className={`window-chrome ${windowState.focused ? "opacity-100" : "opacity-90"} ${isMac ? "pl-20" : ""}`}
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
            Lightning
          </p>
          <p className="truncate text-[11px] text-slate-500">
            {viewLabel(currentView)}
          </p>
        </div>
      </div>

      <div
        data-tauri-drag-region
        onDoubleClick={() =>
          void runWindowAction(
            () => toggleDesktopWindowMaximize(),
            (current) => ({
              ...current,
              maximized: !current.maximized,
            }),
          )
        }
        className="mx-4 min-w-0 flex-1"
      />

      {desktopRuntime && !isMac ? (
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
              void runWindowAction(
                () => toggleDesktopWindowMaximize(),
                (current) => ({
                  ...current,
                  maximized: !current.maximized,
                }),
              )
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
