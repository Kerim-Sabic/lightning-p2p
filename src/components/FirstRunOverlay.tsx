import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  FolderCog,
  HardDriveDownload,
  LoaderCircle,
  Radar,
  RefreshCw,
  Waypoints,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getRuntimeKind, retryNodeStartup } from "../lib/tauri";
import {
  canRetryNodeStartup,
  engineStatusPresentation,
  routeStatusPresentation,
} from "../lib/firstRunStatus";
import { useTransferStore } from "../stores/transferStore";

function toneClass(tone: "ready" | "working" | "attention"): string {
  switch (tone) {
    case "ready":
      return "border-[color-mix(in_srgb,var(--state-success)_26%,transparent)] bg-[color-mix(in_srgb,var(--state-success)_8%,var(--surface-0))] text-[var(--state-success)]";
    case "working":
      return "border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-primary)]";
    case "attention":
      return "border-[var(--amber-border)] bg-[var(--amber-bg)] text-[var(--proof-amber)]";
  }
}

function StatusCard({
  label,
  copy,
  icon,
  tone,
  busy = false,
}: {
  label: string;
  copy: string;
  icon: "engine" | "route";
  tone: "ready" | "working" | "attention";
  busy?: boolean;
}) {
  const Icon = busy ? LoaderCircle : icon === "engine" ? Waypoints : Radar;

  return (
    <section className="min-w-0 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-4">
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${toneClass(tone)}`}
          aria-hidden="true"
        >
          <Icon className={`h-5 w-5 ${busy ? "animate-spin" : ""}`} />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--fg-muted)]">
            {icon === "engine" ? "Transfer engine" : "Connection routes"}
          </p>
          <p
            className="mt-1 text-base font-semibold text-[var(--fg-primary)]"
            aria-live="polite"
          >
            {label}
          </p>
          <p className="mt-1.5 text-sm leading-5 text-[var(--fg-secondary)]">
            {copy}
          </p>
        </div>
      </div>
    </section>
  );
}

export function FirstRunOverlay() {
  const settings = useTransferStore((state) => state.settings);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const nodeSupervisorStatus = useTransferStore(
    (state) => state.nodeSupervisorStatus,
  );
  const platformProfile = useTransferStore((state) => state.platformProfile);
  const applyNodeSupervisorStatus = useTransferStore(
    (state) => state.applyNodeSupervisorStatus,
  );
  const pickDownloadDir = useTransferStore((state) => state.pickDownloadDir);
  const completeFirstRun = useTransferStore((state) => state.completeFirstRun);
  const openDownloadDir = useTransferStore((state) => state.openDownloadDir);
  const [isSaving, setIsSaving] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const runtimeKind = getRuntimeKind();
  const mobileRuntime = runtimeKind === "android" || runtimeKind === "ios";
  const androidProfileReady =
    runtimeKind !== "android" || platformProfile.platform_kind === "android";
  const androidSmartRouting =
    runtimeKind === "android" &&
    androidProfileReady &&
    platformProfile.capabilities.smart_routing;
  const reducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLElement>(null);
  const engine = engineStatusPresentation(nodeSupervisorStatus);
  const route = routeStatusPresentation(nodeStatus);
  const canRetryStartup = canRetryNodeStartup(nodeSupervisorStatus);

  useEffect(() => {
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  if (!settings || settings.first_run_complete) {
    return null;
  }

  const handleContinue = async (): Promise<void> => {
    setIsSaving(true);
    try {
      await completeFirstRun();
    } finally {
      setIsSaving(false);
    }
  };

  const handleRetry = async (): Promise<void> => {
    setRetryError(null);
    setIsRetrying(true);
    try {
      const status = await retryNodeStartup();
      applyNodeSupervisorStatus(status);
    } catch (error) {
      setRetryError(
        error instanceof Error ? error.message : "Could not retry startup.",
      );
    } finally {
      setIsRetrying(false);
    }
  };

  const containTabFocus = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      event.currentTarget.focus();
    } else if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialogRef.current)
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const engineBusy =
    nodeSupervisorStatus.phase === "starting" ||
    nodeSupervisorStatus.phase === "restarting";

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/45 px-4 py-[calc(16px+env(safe-area-inset-top))] sm:items-center">
      <motion.section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-run-title"
        aria-describedby="first-run-copy"
        tabIndex={-1}
        onKeyDown={containTabFocus}
        initial={reducedMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.22, ease: "easeOut" }}
        className="my-auto w-full max-w-3xl rounded-[28px] border border-[var(--border-strong)] bg-[var(--canvas-0)] p-5 text-[var(--fg-primary)] shadow-2xl sm:p-7"
      >
        <div className="space-y-6">
          <header className="max-w-2xl">
            <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent-primary)]">
              <span className="grid h-8 w-8 place-items-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)]">
                <Check className="h-4 w-4" aria-hidden="true" />
              </span>
              Set up Lightning
            </p>
            <h2
              id="first-run-title"
              className="mt-4 text-[clamp(1.8rem,1.5rem+1vw,2.4rem)] font-semibold tracking-[-0.04em]"
            >
              Choose where received files go.
            </h2>
            <p
              id="first-run-copy"
              className="mt-2 max-w-[60ch] text-[15px] leading-6 text-[var(--fg-secondary)]"
            >
              Incoming files are verified as they arrive, then saved here. You
              can change this any time in Settings.
            </p>
          </header>

          <section
            aria-label="Transfer readiness"
            className="grid gap-3 sm:grid-cols-2"
          >
            <div>
              <StatusCard
                label={engine.label}
                copy={engine.copy}
                icon="engine"
                tone={engine.tone}
                busy={engineBusy || isRetrying}
              />
              {canRetryStartup ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => void handleRetry()}
                    disabled={isRetrying}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-4 text-sm font-semibold text-[var(--accent-primary)] transition hover:bg-[var(--accent-border)] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`}
                      aria-hidden="true"
                    />
                    {isRetrying ? "Retrying…" : "Retry startup"}
                  </button>
                  {retryError ? (
                    <p
                      role="alert"
                      className="mt-2 text-sm text-[var(--danger-copy)]"
                    >
                      {retryError}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {nodeSupervisorStatus.phase === "failed" && !canRetryStartup ? (
                <p className="mt-2 text-sm leading-5 text-[var(--fg-secondary)]">
                  Close and reopen Lightning to release the pending storage
                  initialization, then check this status again.
                </p>
              ) : null}
            </div>
            <StatusCard
              label={route.label}
              copy={route.copy}
              icon="route"
              tone={route.tone}
              busy={nodeStatus.online_state === "starting"}
            />
          </section>

          <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-0)] p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] text-[var(--accent-primary)]">
                <HardDriveDownload className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold">
                  {androidSmartRouting
                    ? "Smart save routing"
                    : runtimeKind === "ios"
                      ? "App-private storage"
                      : runtimeKind === "android"
                        ? "Checking save options"
                        : "Receive folder"}
                </h3>
                <p className="mt-1 text-sm leading-5 text-[var(--fg-secondary)]">
                  {androidSmartRouting
                    ? "Verified files are saved into your phone’s system folders by type."
                    : runtimeKind === "ios"
                      ? "Receives stay in app-private storage on this build; public file export is not enabled."
                      : runtimeKind === "android"
                        ? "Lightning is checking the save locations available on this device."
                        : "Choose the folder Lightning uses for verified downloads."}
                </p>
              </div>
            </div>

            {androidSmartRouting ? (
              <ul className="mt-4 grid gap-2 text-sm text-[var(--fg-secondary)] sm:grid-cols-2">
                {[
                  ["Images", "Pictures"],
                  ["Video", "Movies"],
                  ["Audio", "Music"],
                  ["Other", "Downloads"],
                ].map(([kind, folder]) => (
                  <li
                    key={kind}
                    className="flex min-h-11 items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3"
                  >
                    <span>{kind}</span>
                    <span className="text-[var(--fg-muted)]">{folder}</span>
                  </li>
                ))}
              </ul>
            ) : mobileRuntime ? null : (
              <>
                <p className="mt-4 break-all rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3 py-3 text-sm text-[var(--fg-primary)]">
                  {settings.download_dir}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void pickDownloadDir()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-4 text-sm font-medium text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    <FolderCog className="h-4 w-4" aria-hidden="true" />
                    Change folder
                  </button>
                  <button
                    type="button"
                    onClick={() => void openDownloadDir()}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-4 text-sm font-medium text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                  >
                    <HardDriveDownload className="h-4 w-4" aria-hidden="true" />
                    Open folder
                  </button>
                </div>
              </>
            )}
          </section>

          <footer className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-5 text-[var(--fg-secondary)]">
              Engine startup and network reachability are separate. You can
              continue while routes finish warming.
            </p>
            <button
              type="button"
              onClick={() => void handleContinue()}
              disabled={isSaving}
              className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--accent-primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--accent-primary-hover)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas-0)]"
            >
              {isSaving ? (
                <LoaderCircle
                  className="h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              )}
              Continue
            </button>
          </footer>
        </div>
      </motion.section>
    </div>
  );
}
