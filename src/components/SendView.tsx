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
  Sparkles,
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
    ["iso", "bin", "dmg", "zip", "tar", "gz"].includes(extension)
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
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-0.5 text-[10px] uppercase tracking-[0.32em] text-slate-400">
          <Sparkles className="h-3 w-3 text-sky-300" />
          Send
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Share files
        </h1>
        <p className="max-w-2xl text-sm text-slate-400">
          Drop files or folders below, then generate a ticket for instant P2P
          delivery.
        </p>
      </header>

      <section
        className={`glass-panel drop-zone relative overflow-hidden border-2 border-dashed p-8 text-center transition-colors ${
          isDragActive
            ? "drop-zone-active border-sky-400/80 bg-sky-500/12"
            : "border-white/15 bg-white/5"
        }`}
      >
        <div className="relative flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.08]">
            <Send className="h-6 w-6 text-sky-300" />
          </div>
          <p className="text-lg font-semibold text-white">
            {isDragActive
              ? "Release to stage"
              : "Drop files or folders here"}
          </p>
          <p className="max-w-md text-sm text-slate-400">
            Directory structure is preserved. Files stay local until you
            generate a share link.
          </p>
        </div>
      </section>

      <AnimatePresence>
        {shareSelection.length > 0 ? (
          <motion.section
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="glass-panel p-6"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-medium text-white">
                  Staged selection
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {shareSelection.length} item
                  {shareSelection.length === 1 ? "" : "s"} ready to hash and
                  package
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1">
                  {formatBytes(selectionSize)}
                </span>
                <button
                  onClick={() => void createShare()}
                  disabled={isSharing}
                  className="group relative inline-flex overflow-hidden rounded-xl border border-sky-400/20 bg-sky-500/15 px-5 py-3 text-sm font-medium text-sky-50 shadow-[0_18px_50px_rgba(59,130,246,0.22)] transition-all hover:border-sky-300/35 hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-80"
                >
                  <span className="absolute inset-0 bg-[linear-gradient(110deg,transparent,rgba(255,255,255,0.28),transparent)] opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                  {isSharing ? (
                    <span className="absolute inset-0 shimmer-overlay" />
                  ) : null}
                  <span className="relative inline-flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    {isSharing ? "Generating Link" : "Generate Link"}
                  </span>
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {shareSelection.map((item) => {
                const Icon = iconForSelection(item.name, item.is_dir);
                return (
                  <article
                    key={item.path}
                    className="glass-subtle flex items-start gap-4 p-4"
                  >
                    <div className="glass-icon">
                      <Icon className="h-5 w-5 text-sky-200" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-white">
                          {item.name}
                        </p>
                        {item.is_dir ? (
                          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.24em] text-slate-400">
                            Folder
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-300">
                        {formatBytes(item.size)}
                      </p>
                      <p className="mt-2 truncate font-mono text-[11px] text-slate-500">
                        {item.path}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {sendTransfer ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
            <CheckCircle2 className="h-4 w-4 text-sky-300" />
            Current share
          </div>
          <TransferCard transfer={sendTransfer} />
        </section>
      ) : null}

      <AnimatePresence>
        {shareTicket ? (
          <motion.section
            initial={{ opacity: 0, y: 20, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 250, damping: 24 }}
            className="glass-panel p-6"
          >
            <div className="grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">
                      Share ticket
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Copy the link or scan the QR code on the receiving device.
                    </p>
                  </div>
                  <button
                    onClick={() => void handleCopy()}
                    className="glass-button inline-flex items-center gap-2 px-4 py-2 text-sm text-slate-100"
                  >
                    <Copy className="h-4 w-4" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>

                <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/35 p-4">
                  <code className="block break-all font-mono text-sm leading-7 text-sky-100">
                    {shareTicket}
                  </code>
                </div>
              </div>

              <div className="glass-subtle flex flex-col items-center justify-center gap-3 p-5 text-center">
                {qrSvg ? (
                  <div
                    className="rounded-2xl border border-white/10 bg-black/30 p-4"
                    dangerouslySetInnerHTML={{ __html: qrSvg }}
                  />
                ) : (
                  <div className="glass-icon">
                    <Link2 className="h-5 w-5 text-slate-500" />
                  </div>
                )}
                <p className="text-sm font-medium text-white">
                  Scan to receive
                </p>
              </div>
            </div>
          </motion.section>
        ) : null}
      </AnimatePresence>

      {error ? (
        <div className="glass-panel border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      ) : null}
    </div>
  );
}
