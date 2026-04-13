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
  Send,
  Upload,
  Video,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatBytes } from "../lib/format";
import { renderTicketQr } from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";
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

export function SendView() {
  const shareSelection = useTransferStore((state) => state.shareSelection);
  const shareTicket = useTransferStore((state) => state.shareTicket);
  const isSharing = useTransferStore((state) => state.isSharing);
  const transfers = useTransferStore((state) => state.transfers);
  const error = useTransferStore((state) => state.error);
  const setError = useTransferStore((state) => state.setError);
  const prepareShareSelection = useTransferStore(
    (state) => state.prepareShareSelection,
  );
  const createShare = useTransferStore((state) => state.createShare);
  const [copied, setCopied] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  const sendTransfer = useMemo(() => {
    const sendTransfers = Object.values(transfers)
      .filter((transfer) => transfer.direction === "send")
      .sort((left, right) => left.transferId.localeCompare(right.transferId));
    return sendTransfers[sendTransfers.length - 1] ?? null;
  }, [transfers]);

  const selectionSize = useMemo(
    () => shareSelection.reduce((total, item) => total + item.size, 0),
    [shareSelection],
  );

  useEffect(() => {
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

    await navigator.clipboard.writeText(shareTicket);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="badge">
          <Send className="h-3 w-3 text-sky-300" />
          Send
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Share files
        </h1>
        <p className="max-w-xl text-sm leading-relaxed text-slate-400">
          Drop files or folders below, then generate a ticket for instant P2P
          delivery.
        </p>
      </header>

      {/* Drop zone */}
      <section
        className={`glass-panel drop-zone relative overflow-hidden border-2 border-dashed p-10 text-center transition-all duration-300 ${
          isDragActive
            ? "drop-zone-active border-sky-400/60 bg-sky-500/8 scale-[1.005]"
            : "border-white/[0.1] bg-white/[0.02]"
        }`}
      >
        <div className="relative flex flex-col items-center gap-4">
          <motion.div
            animate={isDragActive ? { scale: 1.1, y: -4 } : { scale: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]"
          >
            <Upload
              className={`h-7 w-7 transition-colors duration-200 ${isDragActive ? "text-sky-300" : "text-slate-400"}`}
            />
          </motion.div>
          <div className="space-y-1.5">
            <p className="text-lg font-semibold text-white">
              {isDragActive ? "Release to stage" : "Drop files or folders here"}
            </p>
            <p className="max-w-md text-sm text-slate-500">
              Directory structure is preserved. Files stay local until you
              generate a share link.
            </p>
          </div>
        </div>
      </section>

      {/* Selection */}
      <AnimatePresence>
        {shareSelection.length > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="glass-panel p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  Staged selection
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {shareSelection.length} item
                  {shareSelection.length === 1 ? "" : "s"} ready
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-300">
                <span className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 font-mono text-xs tabular-nums">
                  {formatBytes(selectionSize)}
                </span>
                <button
                  onClick={() => void createShare()}
                  disabled={isSharing}
                  className="btn-primary"
                >
                  {isSharing ? (
                    <span className="absolute inset-0 shimmer-overlay" />
                  ) : null}
                  <span className="relative inline-flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    {isSharing ? "Generating..." : "Generate Link"}
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
                    className="glass-subtle flex items-start gap-3 p-3"
                  >
                    <div className="glass-icon shrink-0">
                      <Icon className="h-4 w-4 text-sky-200" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-white">
                          {item.name}
                        </p>
                        {item.is_dir ? (
                          <span className="rounded-md border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em] text-slate-500">
                            Dir
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

      {/* Active send transfer */}
      {sendTransfer ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-sky-300" />
            Current share
          </div>
          <TransferCard transfer={sendTransfer} />
        </section>
      ) : null}

      {/* Share ticket */}
      <AnimatePresence>
        {shareTicket ? (
          <motion.section
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 280, damping: 26 }}
            className="glass-panel p-5"
          >
            <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Share ticket
                    </p>
                    <p className="mt-1 text-[13px] text-slate-500">
                      Copy the link or scan the QR code on the receiving device.
                    </p>
                  </div>
                  <button
                    onClick={() => void handleCopy()}
                    className={`glass-button inline-flex items-center gap-2 px-4 py-2 text-sm transition-all duration-200 ${
                      copied
                        ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                        : "text-slate-200"
                    }`}
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>

                <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/40 p-4">
                  <code className="block break-all font-mono text-[13px] leading-7 text-sky-100/80">
                    {shareTicket}
                  </code>
                </div>
              </div>

              <div className="glass-subtle flex flex-col items-center justify-center gap-3 p-5 text-center">
                {qrSvg ? (
                  <div
                    className="rounded-xl border border-white/[0.06] bg-black/30 p-3"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div className="glass-icon">
                    <Link2 className="h-5 w-5 text-slate-500" />
                  </div>
                )}
                <p className="text-sm font-medium text-slate-300">
                  Scan to receive
                </p>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {/* Error */}
      {error ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </motion.div>
      ) : null}
    </div>
  );
}
