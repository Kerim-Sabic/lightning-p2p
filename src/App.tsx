import { AnimatePresence, motion } from "framer-motion";
import { startTransition, useMemo, useState } from "react";
import { AppOverview } from "./components/AppOverview";
import { FirstRunOverlay } from "./components/FirstRunOverlay";
import { HistoryView } from "./components/HistoryView";
import { InlineAlert } from "./components/InlineAlert";
import { ReceiveView } from "./components/ReceiveView";
import { SendView } from "./components/SendView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { useTransfer } from "./hooks/useTransfer";
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
  useTransfer();

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
    <div className="h-screen overflow-hidden bg-[#050816] text-slate-100">
      <div className="relative flex h-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_28%),radial-gradient(circle_at_85%_12%,rgba(16,185,129,0.12),transparent_24%),radial-gradient(circle_at_50%_100%,rgba(99,102,241,0.12),transparent_28%)]" />
        <FirstRunOverlay />
        <Sidebar currentView={view} onNavigate={handleNavigate} />
        <main className="relative flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] opacity-70" />
          <div className="relative h-full overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
                variants={pageTransition}
                className="mx-auto flex min-h-full max-w-[1320px] flex-col gap-5 pb-8"
              >
                <AppOverview />
                <InlineAlert message={error} onDismiss={clearError} />
                {content}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
