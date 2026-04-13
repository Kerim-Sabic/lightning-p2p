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
  initial: { opacity: 0, y: 12, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -8, filter: "blur(4px)" },
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
    <div className="h-screen overflow-hidden bg-[#060608] text-slate-100">
      <div className="relative flex h-full">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_10%_5%,rgba(59,130,246,0.1),transparent),radial-gradient(ellipse_60%_50%_at_92%_90%,rgba(34,197,94,0.08),transparent),radial-gradient(ellipse_40%_30%_at_50%_50%,rgba(139,92,246,0.04),transparent)]" />
        <FirstRunOverlay />
        <Sidebar currentView={view} onNavigate={setView} />
        <main className="relative flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),transparent)] opacity-60" />
          <div className="relative h-full overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
                variants={pageTransition}
                className="mx-auto min-h-full max-w-5xl"
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
