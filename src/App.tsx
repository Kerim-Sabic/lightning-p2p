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
import { isDesktopRuntime } from "./lib/tauri";
import { useTransferStore } from "./stores/transferStore";

export type View = "send" | "receive" | "history" | "settings";

export function App() {
  const [view, setView] = useState<View>("send");
  const error = useTransferStore((state) => state.error);
  const clearError = useTransferStore((state) => state.clearError);
  const desktopRuntime = isDesktopRuntime();
  useTransfer();

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
      className={`relative h-screen overflow-hidden text-[var(--fg-primary)] ${
        desktopRuntime ? "bg-transparent" : "bg-[var(--canvas-0)]"
      }`}
    >
      {!desktopRuntime ? (
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_26%),linear-gradient(180deg,rgba(9,12,18,0.96),rgba(11,14,20,1))]" />
      ) : null}
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
