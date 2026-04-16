import { AnimatePresence, motion } from "framer-motion";
import { startTransition, useEffect, useMemo, useState } from "react";
import { AppOverview } from "./components/AppOverview";
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

const pageTransition = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

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
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_10%_0%,rgba(59,130,246,0.18),transparent_28%),radial-gradient(circle_at_100%_10%,rgba(24,144,255,0.1),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(14,165,233,0.08),transparent_30%)]" />
      ) : null}
      <div
        className={`app-shell ${
          desktopRuntime ? "app-shell-desktop" : "app-shell-browser"
        }`}
      >
        <FirstRunOverlay />
        <WindowChrome currentView={view} />
        <div className="relative flex min-h-0 flex-1">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.04),transparent_24%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_22%)]" />
          <Sidebar currentView={view} onNavigate={handleNavigate} />
          <main className="relative min-h-0 flex-1 overflow-hidden">
            <div className="relative flex h-full min-h-0 flex-col gap-4 px-4 pb-4 pt-3">
              <AppOverview />
              <InlineAlert message={error} onDismiss={clearError} />
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={view}
                    initial="initial"
                    animate="animate"
                    exit="exit"
                    transition={{
                      duration: 0.18,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    variants={pageTransition}
                    className="mx-auto flex min-h-full max-w-[1280px] flex-col gap-5 pb-8"
                  >
                    {content}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
