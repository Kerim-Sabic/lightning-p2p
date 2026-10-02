import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTransfer } from "./hooks/useTransfer";
import {
  attachAsyncUnlisten,
  createCoalescedAsyncRunner,
} from "./hooks/asyncSubscription";
import { engineStatusPresentation } from "./lib/firstRunStatus";
import {
  drainPendingSharedFiles,
  drainPendingSharedTicket,
  getRuntimeKind,
  onDeepLinkOpened,
  recordFrontendDiagnostic,
  type RuntimeKind,
} from "./lib/tauri";
import { useTransferStore } from "./stores/transferStore";

const WebLandingPage = lazy(() =>
  import("./components/WebLandingPage").then((module) => ({
    default: module.WebLandingPage,
  })),
);
const DevicesView = lazy(() =>
  import("./components/DevicesView").then((module) => ({
    default: module.DevicesView,
  })),
);
const ChatView = lazy(() =>
  import("./components/ChatView").then((module) => ({
    default: module.ChatView,
  })),
);
const FirstRunOverlay = lazy(() =>
  import("./components/FirstRunOverlay").then((module) => ({
    default: module.FirstRunOverlay,
  })),
);
const HistoryView = lazy(() =>
  import("./components/HistoryView").then((module) => ({
    default: module.HistoryView,
  })),
);
const InlineAlert = lazy(() =>
  import("./components/InlineAlert").then((module) => ({
    default: module.InlineAlert,
  })),
);
const MobileTabBar = lazy(() =>
  import("./components/MobileTabBar").then((module) => ({
    default: module.MobileTabBar,
  })),
);
const OfferPrompt = lazy(() =>
  import("./components/OfferPrompt").then((module) => ({
    default: module.OfferPrompt,
  })),
);
const ReceiveView = lazy(() =>
  import("./components/ReceiveView").then((module) => ({
    default: module.ReceiveView,
  })),
);
const SendView = lazy(() =>
  import("./components/SendView").then((module) => ({
    default: module.SendView,
  })),
);
const TransferTray = lazy(() =>
  import("./components/TransferTray").then((module) => ({
    default: module.TransferTray,
  })),
);
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);
const Sidebar = lazy(() =>
  import("./components/Sidebar").then((module) => ({
    default: module.Sidebar,
  })),
);
const WindowChrome = lazy(() =>
  import("./components/WindowChrome").then((module) => ({
    default: module.WindowChrome,
  })),
);

export type View =
  "send" | "devices" | "chat" | "receive" | "history" | "settings";

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
    const pathname =
      typeof window === "undefined"
        ? "/"
        : window.location.pathname.replace(/\/$/u, "") || "/";
    return (
      <Suspense fallback={<AppLoader label="Opening Lightning P2P" />}>
        {pathname === "/chat" ? <BrowserChatPage /> : <WebLandingPage />}
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<AppLoader label="Starting the transfer engine" />}>
      <NativeAppShell runtimeKind={runtimeKind} />
    </Suspense>
  );
}

function BrowserChatPage() {
  useEffect(() => {
    document.title = "Lightning Chat — Private Web Rooms and Encrypted DMs";
    const description = document.querySelector<HTMLMetaElement>(
      'meta[name="description"]',
    );
    description?.setAttribute(
      "content",
      "Open Lightning Chat for signed relay rooms and encrypted direct messages with no account required.",
    );
  }, []);

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[var(--lab-black)] p-3 text-white sm:p-5">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-320px] h-[680px] w-[900px] -translate-x-1/2 rounded-full bg-sky-400/[0.08] blur-[140px]"
      />
      <header className="relative mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-3 px-1 pb-3">
        <a href="/" className="group flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-sky-300/15 bg-sky-300/10 font-bold text-sky-200">
            L
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">
              Lightning Chat
            </span>
            <span className="block text-[10px] text-white/40">
              by Lightning P2P
            </span>
          </span>
        </a>
        <div className="flex items-center gap-2">
          <a
            href="/send"
            className="rounded-full border border-white/[0.08] px-3 py-2 text-[11px] font-semibold text-white/64 transition hover:bg-white/[0.05] hover:text-white"
          >
            Send files
          </a>
          <a
            href="https://github.com/Kerim-Sabic/lightning-p2p/releases/latest"
            className="rounded-full bg-sky-300 px-3 py-2 text-[11px] font-bold text-slate-950 transition hover:bg-sky-200"
          >
            Get the app
          </a>
        </div>
        <p className="w-full text-[10px] text-white/36 sm:w-auto sm:text-right">
          Signed relay rooms and encrypted DMs · native Bluetooth mesh on
          Windows and Android
        </p>
      </header>
      <div className="relative mx-auto flex w-full max-w-[1440px] flex-1">
        <ChatView />
      </div>
    </div>
  );
}

function AppLoader({ label }: { label: string }) {
  return (
    <main className="app-loader" aria-busy="true" aria-live="polite">
      <span className="app-loader-mark" aria-hidden="true" />
      <p>{label}</p>
    </main>
  );
}

interface NativeAppShellProps {
  runtimeKind: Exclude<RuntimeKind, "browser">;
}

function NativeAppShell({ runtimeKind }: NativeAppShellProps) {
  const [view, setView] = useState<View>("send");
  const error = useTransferStore((state) => state.error);
  const appError = useTransferStore((state) => state.appError);
  const nodeSupervisorStatus = useTransferStore(
    (state) => state.nodeSupervisorStatus,
  );
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
  const engineStatus = engineStatusPresentation(nodeSupervisorStatus);

  useEffect(() => {
    const subscription = onDeepLinkOpened((ticket) => {
      setPendingReceiveTicket(ticket);
      startTransition(() => {
        setView("receive");
      });
    });
    return attachAsyncUnlisten(subscription, () => {
      useTransferStore
        .getState()
        .setError("Could not listen for receive links");
    });
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
    const runDrain = createCoalescedAsyncRunner();

    const drainAndSeed = async (): Promise<void> => {
      if (!active) return;
      const paths = await drainPendingSharedFiles();
      if (!active) return;
      if (paths.length > 0) {
        startTransition(() => {
          setView("send");
        });
        try {
          const prepared = await prepareShareSelection(paths);
          if (active && prepared) {
            await createShare();
          }
        } catch {
          // store already surfaces errors via setError
        }
      }

      // Drain any NFC-pushed receive ticket. When two phones tap, the
      // sender's active ticket lands here; route the user directly to
      // the Receive view with the ticket pre-filled.
      if (!active) return;
      const ticket = await drainPendingSharedTicket();
      if (active && ticket) {
        setPendingReceiveTicket(ticket);
        startTransition(() => {
          setView("receive");
        });
      }
    };

    const scheduleDrain = (): void => {
      void runDrain(drainAndSeed).catch((error: unknown) => {
        if (active) {
          const message =
            error instanceof Error ? error.message : String(error);
          useTransferStore.getState().setError(message);
        }
      });
    };

    scheduleDrain();

    const onFocus = (): void => {
      scheduleDrain();
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

  const handleNavigateToReceive = useCallback((): void => {
    handleNavigate("receive");
  }, [handleNavigate]);

  const handleNavigateToActivity = useCallback((): void => {
    handleNavigate("history");
  }, [handleNavigate]);

  const content = useMemo(() => {
    switch (view) {
      case "devices":
        return <DevicesView />;
      case "chat":
        return <ChatView />;
      case "receive":
        return <ReceiveView onNavigateSend={handleNavigateToSend} />;
      case "history":
        return <HistoryView />;
      case "settings":
        return <SettingsView />;
      case "send":
      default:
        return <SendView onNavigateReceive={handleNavigateToReceive} />;
    }
  }, [view, handleNavigate, handleNavigateToSend, handleNavigateToReceive]);

  return (
    <div className="relative h-screen overflow-hidden bg-[var(--canvas-0)] text-[var(--fg-primary)]">
      <div
        className={`app-shell ${
          mobileRuntime ? "app-shell-mobile" : "app-shell-desktop"
        }`}
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <FirstRunOverlay />
        {!mobileRuntime ? <WindowChrome currentView={view} /> : null}
        <div
          className={`flex min-h-0 flex-1 ${mobileRuntime ? "flex-col" : ""}`}
        >
          {!mobileRuntime ? (
            <Sidebar currentView={view} onNavigate={handleNavigate} />
          ) : null}
          <main id="main-content" className="min-h-0 flex-1 overflow-y-auto">
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
              {nodeSupervisorStatus.phase !== "idle" ? (
                <section
                  role={engineStatus.tone === "attention" ? "alert" : "status"}
                  aria-live={
                    engineStatus.tone === "attention" ? "assertive" : "polite"
                  }
                  className={`flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 ${
                    engineStatus.tone === "attention"
                      ? "border-[var(--amber-border)] bg-[var(--amber-bg)]"
                      : "border-[var(--accent-border)] bg-[var(--surface-0)]"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--fg-primary)]">
                      Transfer engine · {engineStatus.label}
                    </p>
                    <p className="mt-0.5 text-sm leading-5 text-[var(--fg-secondary)]">
                      {engineStatus.copy}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleNavigate("settings")}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 text-sm font-semibold text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    Engine status
                  </button>
                </section>
              ) : null}
              {content}
              <TransferTray
                mobileRuntime={mobileRuntime}
                onNavigateActivity={handleNavigateToActivity}
              />
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
