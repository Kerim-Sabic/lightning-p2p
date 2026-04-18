import { startTransition, useEffect, useMemo, useState } from "react";
import { FirstRunOverlay } from "./components/FirstRunOverlay";
import { HistoryView } from "./components/HistoryView";
import { InlineAlert } from "./components/InlineAlert";
import { ReceiveView } from "./components/ReceiveView";
import { SendView } from "./components/SendView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { WindowChrome } from "./components/WindowChrome";
import { useTransfer } from "./hooks/useTransfer";
import { isDesktopRuntime, onDeepLinkOpened } from "./lib/tauri";
import { useTransferStore } from "./stores/transferStore";

export type View = "send" | "receive" | "history" | "settings";

export function App() {
  const [view, setView] = useState<View>("send");
  const error = useTransferStore((state) => state.error);
  const clearError = useTransferStore((state) => state.clearError);
  const setPendingReceiveTicket = useTransferStore(
    (state) => state.setPendingReceiveTicket,
  );
  const desktopRuntime = isDesktopRuntime();
  useTransfer();

  useEffect(() => {
    if (!desktopRuntime) {
      return;
    }
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
  }, [desktopRuntime, setPendingReceiveTicket]);

  useEffect(() => {
    document.documentElement.dataset.runtime = desktopRuntime
      ? "desktop"
      : "browser";
    document.body.dataset.runtime = desktopRuntime ? "desktop" : "browser";

    return () => {
      delete document.documentElement.dataset.runtime;
      delete document.body.dataset.runtime;
    };
  }, [desktopRuntime]);

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
          desktopRuntime ? "app-shell-desktop" : "app-shell-browser"
        }`}
      >
        <FirstRunOverlay />
        <WindowChrome currentView={view} />
        <div className="flex min-h-0 flex-1">
          <Sidebar currentView={view} onNavigate={handleNavigate} />
          <main className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full max-w-[1040px] flex-col gap-4 px-4 pb-5 pt-4">
              <InlineAlert message={error} onDismiss={clearError} />
              {content}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
