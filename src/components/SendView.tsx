import { AnimatePresence, motion } from "framer-motion";
import {
  Binary,
  CheckCircle2,
  Copy,
  File,
  Folder,
  ImageIcon,
  Link2,
  Radar,
  Send,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { formatBytes } from "../lib/format";
import {
  isDesktopRuntime,
  onWindowDragDropEvent,
  renderTicketQr,
} from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";
import { useLatestSendTransfer } from "../stores/transferSelectors";
import { TransferCard } from "./TransferCard";

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function iconForSelection(name: string, isDir: boolean) {
  if (isDir) {
    return Folder;
  }

  const extension = name.split(".").pop()?.toLowerCase();
  if (
    extension &&
    ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extension)
  ) {
    return ImageIcon;
  }
  if (extension && ["mp4", "mov", "mkv", "avi", "webm"].includes(extension)) {
    return Video;
  }
  if (
    extension &&
    ["iso", "bin", "dmg", "zip", "tar", "gz", "7z", "rar"].includes(extension)
  ) {
    return Binary;
  }
  return File;
}

function readinessLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct routes available";
    case "relay_ready":
      return "Relay route available";
    case "degraded":
      return "Node is online, route still warming";
    case "offline":
      return "Node unavailable";
    case "starting":
    default:
      return "Node is starting";
  }
}

function readinessCopy(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Tickets you generate now can advertise direct addresses for the fastest delivery path.";
    case "relay_ready":
      return "Sharing still works now, but peers may rely on relay fallback until direct addresses appear.";
    case "degraded":
      return "Wait a moment if you want the fastest path to be advertised in the ticket.";
    case "offline":
      return "The local node failed to start. Open Settings before creating another share.";
    case "starting":
    default:
      return "Discovery is still initializing. You can stage content now and create the ticket when ready.";
  }
}

export function SendView() {
  const clearShareSelection = useTransferStore(
    (state) => state.clearShareSelection,
  );
  const createShare = useTransferStore((state) => state.createShare);
  const isSharing = useTransferStore((state) => state.isSharing);
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const settings = useTransferStore((state) => state.settings);
  const pickShareFiles = useTransferStore((state) => state.pickShareFiles);
  const pickShareFolder = useTransferStore((state) => state.pickShareFolder);
  const prepareShareSelection = useTransferStore(
    (state) => state.prepareShareSelection,
  );
  const setError = useTransferStore((state) => state.setError);
  const shareSelection = useTransferStore((state) => state.shareSelection);
  const shareTicket = useTransferStore((state) => state.shareTicket);
  const sendTransfer = useLatestSendTransfer();
  const desktopRuntime = isDesktopRuntime();
  const [copied, setCopied] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  const selectionSize = useMemo(
    () => shareSelection.reduce((total, item) => total + item.size, 0),
    [shareSelection],
  );
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;

  const stageSteps = useMemo(
    () => [
      {
        label: "Select",
        copy: "Drop files or choose a folder tree from disk.",
      },
      {
        label: "Generate",
        copy: "Create a fresh ticket only when you are ready to share.",
      },
      {
        label: "Deliver",
        copy: "Send the ticket as text or let the receiver scan the QR code.",
      },
    ],
    [],
  );

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void onWindowDragDropEvent((event) => {
        if (event.type === "enter" || event.type === "over") {
          setIsDragActive(true);
          return;
        }

        if (event.type === "leave") {
          setIsDragActive(false);
          return;
        }

        setIsDragActive(false);
        void prepareShareSelection(uniquePaths(event.paths));
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((reason: unknown) => {
        const message =
          reason instanceof Error
            ? reason.message
            : "Failed to register drag-and-drop";
        setError(message);
      });

    return () => {
      unlisten?.();
    };
  }, [prepareShareSelection, setError]);

  useEffect(() => {
    let active = true;

    if (!shareTicket) {
      setQrSvg(null);
      return () => {
        active = false;
      };
    }

    void renderTicketQr(shareTicket)
      .then((svg) => {
        if (active) {
          setQrSvg(svg);
        }
      })
      .catch(() => {
        if (active) {
          setQrSvg(null);
        }
      });

    return () => {
      active = false;
    };
  }, [shareTicket]);

  const handleCopy = async (): Promise<void> => {
    if (!shareTicket) {
      return;
    }

    try {
      await navigator.clipboard.writeText(shareTicket);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy failed");
    }
  };

  const handlePrimaryStageAction = async (): Promise<void> => {
    if (!desktopRuntime) {
      return;
    }

    await pickShareFiles();
  };

  const handleDropZoneClick = (
    event: MouseEvent<HTMLDivElement>,
  ): void => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("[data-stage-action='true']")) {
      return;
    }

    void handlePrimaryStageAction();
  };

  const handleDropZoneKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (
      event.key !== "Enter" &&
      event.key !== " "
    ) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("[data-stage-action='true']")) {
      return;
    }

    event.preventDefault();
    void handlePrimaryStageAction();
  };

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.36fr_0.64fr]">
        <header className="glass-panel hero-panel relative overflow-hidden p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(56,189,248,0.1),transparent_22%),radial-gradient(circle_at_18%_100%,rgba(56,189,248,0.08),transparent_24%)]" />
          <div className="relative">
            <div className="badge">
              <Send className="h-3 w-3 text-sky-200" />
              Send
            </div>
            <h1 className="page-title mt-6 max-w-[12ch]">
              Stage a share in seconds
            </h1>
            <p className="page-copy mt-4 max-w-[60ch]">
              Drop files or folders, generate a ticket, then hand that ticket
              to any receiver. Lightning P2P keeps the data local, verified,
              and direct-first from the first byte to the last.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="chrome-pill">Local-first</span>
              <span className="chrome-pill">Direct when possible</span>
              <span className="chrome-pill">Verified stream export</span>
            </div>

            <div className="hero-metrics mt-7 grid gap-3 sm:grid-cols-3">
              <div className="stat-card">
                <p className="metric-label">Staged items</p>
                <p className="metric-value">{shareSelection.length}</p>
              </div>
              <div className="stat-card">
                <p className="metric-label">Total size</p>
                <p className="metric-value">{formatBytes(selectionSize)}</p>
              </div>
              <div className="stat-card">
                <p className="metric-label">Active share</p>
                <p className="mt-2 truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
                  {sendTransfer?.name ?? "Nothing running"}
                </p>
              </div>
            </div>
          </div>
        </header>

        <aside className="glass-panel p-6">
          <div className="flex items-start gap-4">
            <div className="glass-icon h-12 w-12 rounded-2xl">
              <Radar className="h-5 w-5 text-sky-200/85" />
            </div>
            <div>
              <div className="badge">
                <CheckCircle2 className="h-3 w-3 text-sky-200" />
                Network readiness
              </div>
              <h2 className="mt-4 text-[1.55rem] font-semibold leading-tight tracking-[-0.03em] text-white">
                {readinessLabel(nodeStatus.online_state)}
              </h2>
              <p className="meta-copy mt-3">
                {readinessCopy(nodeStatus.online_state)}
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-3">
            <div className="stat-card">
              <p className="metric-label">Direct addresses</p>
              <p className="metric-value">
                {nodeStatus.direct_address_count}
              </p>
            </div>
            <div className="stat-card">
              <p className="metric-label">Relay session</p>
              <p className="mt-2 text-[15px] font-semibold tracking-[-0.02em] text-white">
                {nodeStatus.relay_connected ? "Connected" : "Waiting"}
              </p>
            </div>
            <div className="stat-card">
              <p className="metric-label">Nearby visibility</p>
              <p className="mt-2 text-[15px] font-semibold tracking-[-0.02em] text-white">
                {shareTicket && localDiscoveryEnabled
                  ? "Visible on this network"
                  : localDiscoveryEnabled
                    ? "Ready after ticket creation"
                    : "Disabled in Settings"}
              </p>
            </div>
          </div>

          <p className="meta-copy mt-5">
            Tickets bundle the sender node ID, relay URL, and any known direct
            addresses, so generating the ticket after the direct path appears
            gives the receiver a better chance of taking the fastest route.
          </p>
        </aside>
      </section>

      <section
        className={`glass-panel drop-zone relative overflow-hidden p-3 transition-all duration-300 ${
          isDragActive ? "drop-zone-active" : ""
        }`}
      >
        <div
          className={`relative overflow-hidden rounded-[30px] border border-dashed p-8 lg:p-10 ${
            isDragActive
              ? "border-sky-400/55 bg-sky-500/[0.07]"
              : "border-white/[0.09] bg-white/[0.02]"
          }`}
          onClick={handleDropZoneClick}
          onKeyDown={handleDropZoneKeyDown}
          tabIndex={desktopRuntime ? 0 : -1}
          role={desktopRuntime ? "button" : undefined}
          aria-label={
            desktopRuntime ? "Choose files to share or drop files here" : undefined
          }
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_32%,rgba(56,189,248,0.16),transparent_24%),radial-gradient(circle_at_80%_18%,rgba(56,189,248,0.1),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_34%,rgba(56,189,248,0.05)_100%)] opacity-90" />
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[42%] bg-[linear-gradient(135deg,transparent,rgba(56,189,248,0.06)_30%,transparent_75%)] lg:block" />

          <div className="relative grid gap-8 lg:grid-cols-[1.18fr_0.82fr] lg:items-center">
            <div className="space-y-5 text-left">
              <motion.div
                animate={
                  isDragActive ? { scale: 1.05, y: -3 } : { scale: 1, y: 0 }
                }
                transition={{ type: "spring", stiffness: 280, damping: 22 }}
                className="flex h-[76px] w-[76px] items-center justify-center rounded-[28px] border border-white/[0.1] bg-white/[0.05] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              >
                <Upload
                  className={`h-8 w-8 transition-colors duration-200 ${
                    isDragActive ? "text-sky-200" : "text-slate-200"
                  }`}
                />
              </motion.div>

              <div className="space-y-3">
                <p className="page-eyebrow">Primary action surface</p>
                <h2 className="text-[clamp(2rem,1.88rem+0.8vw,2.7rem)] font-semibold leading-[1.03] tracking-[-0.035em] text-white">
                  {isDragActive
                    ? "Release to stage the share"
                    : "Drop files or folders here"}
                </h2>
                <p className="page-copy max-w-[58ch]">
                  Directory structure stays intact. Content is only imported
                  into the local blob store when you intentionally generate the
                  share ticket.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="chrome-pill">Folder structure preserved</span>
                <span className="chrome-pill">No cloud hop</span>
                <span className="chrome-pill">Ticket generated on demand</span>
              </div>

              <div className="grid gap-3 pt-2 md:grid-cols-3">
                {stageSteps.map((step, index) => (
                  <div key={step.label} className="glass-subtle px-4 py-3">
                    <p className="metric-label">
                      {index + 1}. {step.label}
                    </p>
                    <p className="mt-2 text-[13px] leading-6 text-slate-300/78">
                      {step.copy}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div
              data-stage-action="true"
              className="space-y-3 rounded-[26px] border border-white/[0.08] bg-black/20 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            >
              <p className="page-eyebrow">Select content</p>
              <div className="grid gap-3">
                <button
                  onClick={() => void pickShareFiles()}
                  disabled={!desktopRuntime}
                  className="btn-primary justify-between px-5 py-4"
                >
                  <span className="relative inline-flex items-center gap-2">
                    <File className="h-4 w-4" />
                    Choose files
                  </span>
                  <span className="relative text-xs text-sky-100/72">
                    Multi-select
                  </span>
                </button>
                <button
                  onClick={() => void pickShareFolder()}
                  disabled={!desktopRuntime}
                  className="glass-button inline-flex items-center justify-between gap-2 px-5 py-4 text-sm text-slate-100"
                >
                  <span className="inline-flex items-center gap-2">
                    <Folder className="h-4 w-4" />
                    Choose folder
                  </span>
                  <span className="text-xs text-slate-400">Whole tree</span>
                </button>
              </div>

              <p className="meta-copy pt-1">
                Click anywhere on this surface, drag directly into it, or use
                the explicit file and folder actions for more control.
              </p>

              {!desktopRuntime ? (
                <p className="text-xs leading-6 text-slate-400">
                  Folder and file pickers only work in the Lightning P2P
                  desktop runtime.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <AnimatePresence>
        {shareSelection.length > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="glass-panel p-6"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  Staged selection
                </p>
                <p className="meta-copy mt-1">
                  {shareSelection.length} item
                  {shareSelection.length === 1 ? "" : "s"} ready for hashing,
                  import, and ticket creation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-3.5 py-2 text-sm font-semibold tabular-nums text-white">
                  {formatBytes(selectionSize)}
                </span>
                <button
                  onClick={clearShareSelection}
                  className="glass-button inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate-100"
                >
                  <Trash2 className="h-4 w-4" />
                  Clear
                </button>
                <button
                  onClick={() => void createShare()}
                  disabled={isSharing || !desktopRuntime}
                  className="btn-primary"
                >
                  {isSharing ? (
                    <span className="absolute inset-0 shimmer-overlay" />
                  ) : null}
                  <span className="relative inline-flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    {isSharing ? "Generating ticket..." : "Generate ticket"}
                  </span>
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shareSelection.map((item, index) => {
                const Icon = iconForSelection(item.name, item.is_dir);

                return (
                  <motion.article
                    key={item.path}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.2 }}
                    className="glass-subtle flex items-start gap-3 p-4"
                  >
                    <div className="glass-icon shrink-0">
                      <Icon className="h-4 w-4 text-sky-100" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-white">
                          {item.name}
                        </p>
                        {item.is_dir ? (
                          <span className="rounded-md border border-white/8 bg-white/[0.05] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.22em] text-slate-400">
                            Folder
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs tabular-nums text-slate-400">
                        {formatBytes(item.size)}
                      </p>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {sendTransfer ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <CheckCircle2 className="h-4 w-4 text-sky-200" />
            Current share
          </div>
          <TransferCard transfer={sendTransfer} />
        </section>
      ) : null}

      <AnimatePresence>
        {shareTicket ? (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="glass-panel p-6"
          >
            <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Share ticket ready
                    </p>
                    <p className="meta-copy mt-1">
                      Copy the full ticket or scan the QR code on the other
                      device. A fresh ticket keeps the receiver aligned with the
                      latest route information.
                    </p>
                  </div>
                  <button
                    onClick={() => void handleCopy()}
                    className={`glass-button inline-flex items-center gap-2 px-4 py-2 text-sm transition-all duration-200 ${
                      copied
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                        : "text-slate-100"
                    }`}
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>

                <div
                  className={`rounded-[24px] border px-4 py-3 text-sm ${
                    localDiscoveryEnabled
                      ? "border-emerald-400/18 bg-emerald-500/10 text-emerald-50"
                      : "border-white/8 bg-white/[0.04] text-slate-300"
                  }`}
                >
                  <p className="metric-label">
                    {localDiscoveryEnabled
                      ? "Visible on this network"
                      : "Manual sharing only"}
                  </p>
                  <p className="mt-2 leading-6">
                    {localDiscoveryEnabled
                      ? "Nearby receivers on the same LAN can discover this share automatically while this ticket stays active."
                      : "Local discovery is disabled, so receivers will need the ticket or QR code explicitly."}
                  </p>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-white/[0.08] bg-black/30 p-4">
                  <code className="block break-all font-mono text-[13px] leading-7 text-sky-50/88">
                    {shareTicket}
                  </code>
                </div>
              </div>

              <div className="glass-subtle flex flex-col items-center justify-center gap-4 p-5 text-center">
                {qrSvg ? (
                  <div
                    className="rounded-[24px] border border-white/[0.08] bg-white p-3 shadow-[0_18px_38px_rgba(0,0,0,0.24)]"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div className="glass-icon h-20 w-20 rounded-[28px]">
                    <Link2 className="h-6 w-6 text-slate-400" />
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold text-white">
                    Scan to receive
                  </p>
                  <p className="mt-1 text-sm leading-6 text-slate-300/72">
                    Open Lightning P2P on the receiving device, then paste or
                    scan the ticket to start the stream.
                  </p>
                </div>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
