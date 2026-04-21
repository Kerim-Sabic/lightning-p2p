import { startTransition, useEffect, useMemo, useState } from "react";
import { FirstRunOverlay } from "./components/FirstRunOverlay";
import { HistoryView } from "./components/HistoryView";
import { InlineAlert } from "./components/InlineAlert";
import { MobileTabBar } from "./components/MobileTabBar";
import { ReceiveView } from "./components/ReceiveView";
import { SendView } from "./components/SendView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { WebLandingPage } from "./components/WebLandingPage";
import { WindowChrome } from "./components/WindowChrome";
import { useTransfer } from "./hooks/useTransfer";
import {
  getRuntimeKind,
  onDeepLinkOpened,
  type RuntimeKind,
} from "./lib/tauri";
import { useTransferStore } from "./stores/transferStore";

export type View = "send" | "receive" | "history" | "settings";

export function App() {
  const runtimeKind = getRuntimeKind();
  const nativeRuntime = runtimeKind !== "browser";

  useEffect(() => {
    document.documentElement.dataset.runtime = runtimeKind;
    document.body.dataset.runtime = runtimeKind;
    document.body.classList.add("app-hydrated");

    return () => {
      delete document.documentElement.dataset.runtime;
      delete document.body.dataset.runtime;
      document.body.classList.remove("app-hydrated");
    };
  }, [runtimeKind]);

  if (!nativeRuntime) {
    return <WebLandingPage />;
  }

  return <NativeAppShell runtimeKind={runtimeKind} />;
}

interface NativeAppShellProps {
  runtimeKind: Exclude<RuntimeKind, "browser">;
}

function NativeAppShell({ runtimeKind }: NativeAppShellProps) {
  const [view, setView] = useState<View>("send");
  const error = useTransferStore((state) => state.error);
  const clearError = useTransferStore((state) => state.clearError);
  const setPendingReceiveTicket = useTransferStore(
    (state) => state.setPendingReceiveTicket,
  );
  useTransfer();
  const mobileRuntime = runtimeKind === "android" || runtimeKind === "ios";

  useEffect(() => {
    let active = true;
    const subscription = onDeepLinkOpened((ticket) => {
      if (!active) {
        return;
      }
      setPendingReceiveTicket(ticket);
      startTransition(() => {
        setView("receive");
      });
    });
    return () => {
      active = false;
      void subscription.then((unlisten) => unlisten());
    };
  }, [setPendingReceiveTicket]);

  const handleNavigate = (nextView: View): void => {
    startTransition(() => {
      setView(nextView);
    });
  };

  const content = useMemo(() => {
    switch (view) {
      case "receive":
        return <ReceiveView />;
      case "history":
        return <HistoryView />;
      case "settings":
        return <SettingsView />;
      case "send":
      default:
        return <SendView />;
    }
  }, [view]);

  return (
    <div
      className="relative h-screen overflow-hidden bg-[var(--canvas-0)] text-[var(--fg-primary)]"
    >
      <div
        className={`app-shell ${
          mobileRuntime ? "app-shell-mobile" : "app-shell-desktop"
        }`}
      >
        <FirstRunOverlay />
        {!mobileRuntime ? <WindowChrome currentView={view} /> : null}
        <div
          className={`flex min-h-0 flex-1 ${
            mobileRuntime ? "flex-col" : ""
          }`}
        >
          {!mobileRuntime ? (
            <Sidebar currentView={view} onNavigate={handleNavigate} />
          ) : null}
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div
              className={`mx-auto flex min-h-full max-w-[1040px] flex-col gap-4 px-4 pt-4 ${
                mobileRuntime
                  ? "pb-[calc(88px+env(safe-area-inset-bottom))]"
                  : "pb-5"
              }`}
            >
              <InlineAlert message={error} onDismiss={clearError} />
              {content}
            </div>
          </main>
          {mobileRuntime ? (
            <MobileTabBar currentView={view} onNavigate={handleNavigate} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
