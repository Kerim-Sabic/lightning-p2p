import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DevicesView } from "./components/DevicesView";
import { FirstRunOverlay } from "./components/FirstRunOverlay";
import { HistoryView } from "./components/HistoryView";
import { InlineAlert } from "./components/InlineAlert";
import { MobileTabBar } from "./components/MobileTabBar";
import { OfferPrompt } from "./components/OfferPrompt";
import { ReceiveView } from "./components/ReceiveView";
import { SendView } from "./components/SendView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
import { WebLandingPage } from "./components/WebLandingPage";
import { WindowChrome } from "./components/WindowChrome";
import { useTransfer } from "./hooks/useTransfer";
import {
  drainPendingSharedFiles,
  drainPendingSharedTicket,
  getRuntimeKind,
  onDeepLinkOpened,
  recordFrontendDiagnostic,
  type RuntimeKind,
} from "./lib/tauri";
import { useTransferStore } from "./stores/transferStore";

export type View = "send" | "devices" | "receive" | "history" | "settings";

export function App() {
  const runtimeKind = getRuntimeKind();
  const nativeRuntime = runtimeKind !== "browser";

  useEffect(() => {
    document.documentElement.dataset.runtime = runtimeKind;
    document.body.dataset.runtime = runtimeKind;
    document.body.classList.add("app-hydrated");
    recordFrontendDiagnostic(`app:rendered:${runtimeKind}`);

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
  const appError = useTransferStore((state) => state.appError);
  const clearError = useTransferStore((state) => state.clearError);
  const setPendingReceiveTicket = useTransferStore(
    (state) => state.setPendingReceiveTicket,
  );
  const prepareShareSelection = useTransferStore(
    (state) => state.prepareShareSelection,
  );
  const createShare = useTransferStore((state) => state.createShare);
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

  // Drain Android share-sheet handoffs on cold-start and on every window focus
  // (warm-start case: user backgrounded the app, picked Share -> Lightning P2P,
  // returned to the activity). Seeds the Send view and auto-creates the
  // receive ticket so the user lands directly on a shareable QR/link.
  useEffect(() => {
    if (!mobileRuntime) {
      return;
    }

    let active = true;

    const drainAndSeed = async (): Promise<void> => {
      const paths = await drainPendingSharedFiles();
      if (active && paths.length > 0) {
        startTransition(() => {
          setView("send");
        });
        try {
          await prepareShareSelection(paths);
          await createShare();
        } catch {
          // store already surfaces errors via setError
        }
      }

      // Drain any NFC-pushed receive ticket. When two phones tap, the
      // sender's active ticket lands here; route the user directly to
      // the Receive view with the ticket pre-filled.
      const ticket = await drainPendingSharedTicket();
      if (active && ticket) {
        setPendingReceiveTicket(ticket);
        startTransition(() => {
          setView("receive");
        });
      }
    };

    void drainAndSeed();

    const onFocus = (): void => {
      void drainAndSeed();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.removeEventListener("focus", onFocus);
    };
  }, [
    createShare,
    mobileRuntime,
    prepareShareSelection,
    setPendingReceiveTicket,
  ]);

  const handleNavigate = useCallback((nextView: View): void => {
    startTransition(() => {
      setView(nextView);
    });
  }, []);

  const handleNavigateToSend = useCallback((): void => {
    handleNavigate("send");
  }, [handleNavigate]);

  const content = useMemo(() => {
    switch (view) {
      case "devices":
        return <DevicesView />;
      case "receive":
        return <ReceiveView onNavigateSend={handleNavigateToSend} />;
      case "history":
        return <HistoryView />;
      case "settings":
        return <SettingsView />;
      case "send":
      default:
        return <SendView />;
    }
  }, [view, handleNavigateToSend]);

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--canvas-0)] text-[var(--fg-primary)]">
      <div
        className={`app-shell ${
          mobileRuntime ? "app-shell-mobile" : "app-shell-desktop"
        }`}
      >
        <FirstRunOverlay />
        {!mobileRuntime ? <WindowChrome currentView={view} /> : null}
        <div
          className={`flex min-h-0 flex-1 ${mobileRuntime ? "flex-col" : ""}`}
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
              <InlineAlert
                appError={appError}
                message={error}
                onDismiss={clearError}
              />
              {content}
            </div>
          </main>
          {mobileRuntime ? (
            <MobileTabBar currentView={view} onNavigate={handleNavigate} />
          ) : null}
        </div>
      </div>
      <OfferPrompt />
    </div>
  );
}
