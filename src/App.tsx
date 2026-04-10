import { AnimatePresence, motion } from "framer-motion";
import { FirstRunOverlay } from "./components/FirstRunOverlay";
import { useMemo, useState } from "react";
import { HistoryView } from "./components/HistoryView";
import { ReceiveView } from "./components/ReceiveView";
import { SendView } from "./components/SendView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { useTransfer } from "./hooks/useTransfer";

export type View = "send" | "receive" | "history" | "settings";

const pageTransition = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
};

export function App() {
  const [view, setView] = useState<View>("send");
  useTransfer();

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
    <div className="h-screen overflow-hidden bg-[#0a0a0a] text-slate-50">
      <div className="relative flex h-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.14),transparent_24%),radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_40%)]" />
        <FirstRunOverlay />
        <Sidebar currentView={view} onNavigate={setView} />
        <main className="relative flex-1 overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),transparent)] opacity-20" />
          <div className="relative h-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.15, ease: "easeOut" }}
                variants={pageTransition}
                className="mx-auto min-h-full max-w-6xl"
              >
                {content}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
