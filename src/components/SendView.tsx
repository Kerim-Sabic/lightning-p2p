import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "../lib/format";
import { isDesktopRuntime, renderTicketQr } from "../lib/tauri";
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

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setIsDragActive(true);
          return;
        }

        if (event.payload.type === "leave") {
          setIsDragActive(false);
          return;
        }

        setIsDragActive(false);
        void prepareShareSelection(uniquePaths(event.payload.paths));
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

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <header className="glass-panel p-6">
          <div className="badge">
            <Send className="h-3 w-3 text-sky-200" />
            Send
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white">
            Stage a share in seconds
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-300/80">
            Drop files or folders, generate a ticket, then hand that ticket to
            any receiver. Lightning P2P keeps the data local, verified, and
            peer-to-peer from the first byte to the last.
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Staged items
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
                {shareSelection.length}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Total size
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
                {formatBytes(selectionSize)}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Active share
              </p>
              <p className="mt-1.5 truncate text-sm font-semibold text-white">
                {sendTransfer?.name ?? "Nothing running"}
              </p>
            </div>
          </div>
        </header>

        <aside className="glass-panel p-6">
          <div className="flex items-start gap-3">
            <div className="glass-icon h-12 w-12 rounded-2xl">
              <Radar className="h-5 w-5 text-emerald-200" />
            </div>
            <div>
              <div className="badge">
                <CheckCircle2 className="h-3 w-3 text-emerald-200" />
                Network readiness
              </div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight text-white">
                {readinessLabel(nodeStatus.online_state)}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-300/80">
                {readinessCopy(nodeStatus.online_state)}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Direct addresses
              </p>
              <p className="mt-1.5 text-xl font-semibold tabular-nums text-white">
                {nodeStatus.direct_address_count}
              </p>
            </div>
            <div className="stat-card">
              <p className="text-[10px] uppercase tracking-[0.28em] text-slate-500">
                Relay
              </p>
              <p className="mt-1.5 text-sm font-semibold text-white">
                {nodeStatus.relay_connected ? "Connected" : "Waiting"}
              </p>
            </div>
          </div>

          <p className="mt-5 text-sm leading-6 text-slate-300/72">
            Tickets bundle the sender node ID, relay URL, and any known direct
            addresses, so generating the ticket after the direct path appears
            gives the receiver a better chance of taking the fastest route.
          </p>
        </aside>
      </section>

      <section
        className={`glass-panel drop-zone relative overflow-hidden border-2 border-dashed p-10 text-center transition-all duration-300 ${
          isDragActive
            ? "drop-zone-active border-sky-400/60 bg-sky-500/10"
            : "border-white/10 bg-white/[0.025]"
        }`}
      >
        <div className="relative flex flex-col items-center gap-5">
          <motion.div
            animate={isDragActive ? { scale: 1.08, y: -4 } : { scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="flex h-[72px] w-[72px] items-center justify-center rounded-[26px] border border-white/10 bg-white/[0.05]"
          >
            <Upload
              className={`h-8 w-8 transition-colors duration-200 ${
                isDragActive ? "text-sky-200" : "text-slate-300"
              }`}
            />
          </motion.div>
          <div className="space-y-2">
            <p className="text-2xl font-semibold tracking-tight text-white">
              {isDragActive
                ? "Release to stage the share"
                : "Drop files or folders here"}
            </p>
            <p className="max-w-2xl text-sm leading-6 text-slate-300/72">
              Directory structure stays intact. Content is only imported into
              the local blob store when you intentionally generate the share
              ticket.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => void pickShareFiles()}
              disabled={!desktopRuntime}
              className="glass-button inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate-100"
            >
              <File className="h-4 w-4" />
              Choose files
            </button>
            <button
              onClick={() => void pickShareFolder()}
              disabled={!desktopRuntime}
              className="glass-button inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate-100"
            >
              <Folder className="h-4 w-4" />
              Choose folder
            </button>
          </div>
          {!desktopRuntime ? (
            <p className="text-xs leading-6 text-slate-400">
              Folder and file pickers only work in the Lightning P2P desktop app
              runtime.
            </p>
          ) : null}
        </div>
      </section>

      <AnimatePresence>
        {shareSelection.length > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="glass-panel p-5"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  Staged selection
                </p>
                <p className="mt-1 text-sm text-slate-300/72">
                  {shareSelection.length} item
                  {shareSelection.length === 1 ? "" : "s"} ready for hashing,
                  import, and ticket creation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-2xl border border-white/10 bg-white/[0.05] px-3.5 py-2 text-sm font-semibold tabular-nums text-white">
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

            <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {shareSelection.map((item, index) => {
                const Icon = iconForSelection(item.name, item.is_dir);

                return (
                  <motion.article
                    key={item.path}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.2 }}
                    className="glass-subtle flex items-start gap-3 p-3.5"
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
                      <p className="mt-0.5 text-xs tabular-nums text-slate-400">
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
            className="glass-panel p-5"
          >
            <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Share ticket ready
                    </p>
                    <p className="mt-1 text-[13px] leading-6 text-slate-300/72">
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

                <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/35 p-4">
                  <code className="block break-all font-mono text-[13px] leading-7 text-sky-50/88">
                    {shareTicket}
                  </code>
                </div>
              </div>

              <div className="glass-subtle flex flex-col items-center justify-center gap-4 p-5 text-center">
                {qrSvg ? (
                  <div
                    className="rounded-2xl border border-white/8 bg-white p-3"
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
