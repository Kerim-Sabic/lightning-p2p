import {
  Binary,
  CheckCircle2,
  Copy,
  File,
  Folder,
  ImageIcon,
  Link2,
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
import { useLatestSendTransfer } from "../stores/transferSelectors";
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

function networkLabel(onlineState: string): string {
  switch (onlineState) {
    case "direct_ready":
      return "Direct ready";
    case "relay_ready":
      return "Relay ready";
    case "degraded":
      return "Warming";
    case "offline":
      return "Offline";
    case "starting":
    default:
      return "Starting";
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
  const visibleOnNetwork = Boolean(shareTicket) && localDiscoveryEnabled;

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

  const handleDropZoneClick = (event: MouseEvent<HTMLDivElement>): void => {
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
    if (event.key !== "Enter" && event.key !== " ") {
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
    <div className="space-y-4">
      <section
        className={`glass-panel drop-zone ${isDragActive ? "drop-zone-active" : ""}`}
      >
        <div
          className={`simple-drop-zone ${
            isDragActive
              ? "border-sky-400/45 bg-sky-500/[0.06]"
              : "border-white/[0.08] bg-white/[0.02]"
          }`}
          onClick={handleDropZoneClick}
          onKeyDown={handleDropZoneKeyDown}
          tabIndex={desktopRuntime ? 0 : -1}
          role={desktopRuntime ? "button" : undefined}
          aria-label={
            desktopRuntime ? "Choose files to share or drop files here" : undefined
          }
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="glass-icon h-14 w-14 rounded-[20px]">
                <Upload className="h-6 w-6 text-sky-200" />
              </div>
              <p className="page-eyebrow mt-5">Send</p>
              <h1 className="mt-2 text-[clamp(1.8rem,1.6rem+0.8vw,2.4rem)] font-semibold tracking-[-0.04em] text-white">
                {isDragActive ? "Release to stage files" : "Drop files to share"}
              </h1>
              <p className="meta-copy mt-3 max-w-[58ch]">
                Choose files or a folder, then generate one share ticket when
                you are ready.
              </p>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="chrome-pill">
                  Network {networkLabel(nodeStatus.online_state)}
                </span>
                <span className="chrome-pill">
                  {visibleOnNetwork
                    ? "Visible on this network"
                    : localDiscoveryEnabled
                      ? "Nearby discovery ready"
                      : "Manual code only"}
                </span>
              </div>
            </div>

            <div
              data-stage-action="true"
              className="flex w-full max-w-[320px] flex-col gap-3"
            >
              <button
                onClick={() => void pickShareFiles()}
                disabled={!desktopRuntime}
                className="btn-primary justify-center"
              >
                <span className="relative inline-flex items-center gap-2">
                  <File className="h-4 w-4" />
                  Choose files
                </span>
              </button>
              <button
                onClick={() => void pickShareFolder()}
                disabled={!desktopRuntime}
                className="glass-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm text-slate-100"
              >
                <Folder className="h-4 w-4" />
                Choose folder
              </button>
              {!desktopRuntime ? (
                <p className="text-xs leading-6 text-slate-500">
                  File and folder pickers require the native Lightning P2P
                  desktop app runtime.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {shareSelection.length > 0 ? (
        <section className="glass-panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">Staged selection</p>
              <p className="meta-copy mt-1">
                {shareSelection.length} item
                {shareSelection.length === 1 ? "" : "s"} ready |{" "}
                {formatBytes(selectionSize)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
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
                <span className="relative inline-flex items-center gap-2">
                  <Link2 className="h-4 w-4" />
                  {isSharing ? "Generating ticket..." : "Generate ticket"}
                </span>
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-2">
            {shareSelection.map((item) => {
              const Icon = iconForSelection(item.name, item.is_dir);

              return (
                <div
                  key={item.path}
                  className="glass-subtle flex items-center gap-3 px-4 py-3"
                >
                  <div className="glass-icon h-9 w-9 shrink-0">
                    <Icon className="h-4 w-4 text-sky-200" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {item.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {item.is_dir ? "Folder" : "File"}
                    </p>
                  </div>
                  <div className="text-sm font-medium tabular-nums text-slate-300/78">
                    {formatBytes(item.size)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {shareTicket ? (
        <section className="glass-panel p-5">
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Share code ready
                  </p>
                  <p className="meta-copy mt-1">
                    Copy the code or scan the QR code on the receiving device.
                  </p>
                </div>
                <button
                  onClick={() => void handleCopy()}
                  className={`glass-button inline-flex items-center gap-2 px-4 py-2 text-sm ${
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
                className={`rounded-[20px] border px-4 py-3 text-sm ${
                  visibleOnNetwork
                    ? "border-emerald-400/18 bg-emerald-500/10 text-emerald-50"
                    : "border-white/8 bg-white/[0.03] text-slate-300"
                }`}
              >
                <p className="metric-label">
                  {visibleOnNetwork
                    ? "Nearby discovery is active"
                    : localDiscoveryEnabled
                      ? "Share code is ready"
                      : "Nearby discovery is disabled"}
                </p>
                <p className="mt-2 leading-6">
                  {visibleOnNetwork
                    ? "Receivers on the same LAN should see this share automatically while it stays active."
                    : localDiscoveryEnabled
                      ? "If the receiver does not appear automatically, they can still paste this code."
                      : "Receivers will need the share code or QR code explicitly."}
                </p>
              </div>

              <div className="overflow-hidden rounded-[20px] border border-white/[0.08] bg-black/25 p-4">
                <code className="block break-all font-mono text-[13px] leading-7 text-sky-50/88">
                  {shareTicket}
                </code>
              </div>
            </div>

            <div className="glass-subtle flex flex-col items-center justify-center gap-4 p-5 text-center">
              {qrSvg ? (
                <div
                  className="rounded-[20px] border border-white/[0.08] bg-white p-3"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              ) : (
                <div className="glass-icon h-20 w-20 rounded-[24px]">
                  <Link2 className="h-6 w-6 text-slate-400" />
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-white">Scan to receive</p>
                <p className="meta-copy mt-1">
                  Nearby discovery and manual code entry both stay available.
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {sendTransfer ? (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
            <CheckCircle2 className="h-4 w-4 text-sky-200" />
            Current share
          </div>
          <TransferCard transfer={sendTransfer} />
        </section>
      ) : null}
    </div>
  );
}
