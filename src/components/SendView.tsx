import {
  Binary,
  CheckCircle2,
  Copy,
  ArrowDownToLine,
  Eye,
  File,
  Folder,
  ImageIcon,
  LaptopMinimal,
  Link2,
  Loader2,
  ShieldCheck,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatBytes } from "../lib/format";
import { isDeliberateFlick } from "../lib/flickGesture";
import { createReceiveHandoffLink } from "../lib/shareLinks";
import { attachAsyncUnlisten } from "../hooks/asyncSubscription";
import {
  isDesktopRuntime,
  isMobileRuntime,
  offerShareToPeer,
  onWindowDragDropEvent,
  pickShareFiles as pickShareFilesFromDialog,
  listPairedDevices,
  renderTicketQr,
  type NearbyDevice,
  writeClipboardText,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useNearbyDeviceStore } from "../stores/nearbyDeviceStore";
import { useLatestSendTransfer } from "../stores/transferSelectors";
import { useTransferStore } from "../stores/transferStore";
import { TransferCard } from "./TransferCard";

interface SendViewProps {
  onNavigateReceive: () => void;
}

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

function displayReceiveLink(link: string): string {
  return link.replace(/(#t=).+$/u, "$1[hidden ticket]");
}

interface FlickTargetSnapshot {
  nodeId: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  centerY: number;
}

interface ActiveFlick {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  targets: FlickTargetSnapshot[];
  element: HTMLElement;
}

export function SendView({ onNavigateReceive }: SendViewProps) {
  const clearShareSelection = useTransferStore(
    (state) => state.clearShareSelection,
  );
  const removeShareSelectionItem = useTransferStore(
    (state) => state.removeShareSelectionItem,
  );
  const cancelTransfer = useTransferStore((state) => state.cancelTransfer);
  const createShare = useTransferStore((state) => state.createShare);
  const isSharing = useTransferStore((state) => state.isSharing);
  const isPreparingSelection = useTransferStore(
    (state) => state.isPreparingSelection,
  );
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const settings = useTransferStore((state) => state.settings);
  const platformProfile = useTransferStore((state) => state.platformProfile);
  const bleDiscoveryStatus = useTransferStore(
    (state) => state.bleDiscoveryStatus,
  );
  const pickShareFiles = useTransferStore((state) => state.pickShareFiles);
  const pickShareFolder = useTransferStore((state) => state.pickShareFolder);
  const prepareShareSelection = useTransferStore(
    (state) => state.prepareShareSelection,
  );
  const setError = useTransferStore((state) => state.setError);
  const shareSelection = useTransferStore((state) => state.shareSelection);
  const shareTicket = useTransferStore((state) => state.shareTicket);
  const devices = useNearbyDeviceStore((state) => state.devices);
  const recordOutbound = useIncomingOfferStore((state) => state.recordOutbound);
  const sendTransfer = useLatestSendTransfer();
  const nativeRuntime = isDesktopRuntime();
  const mobileRuntime = isMobileRuntime();
  const [copied, setCopied] = useState<"link" | "ticket" | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [showRawTicket, setShowRawTicket] = useState(false);
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [dropTargetNodeId, setDropTargetNodeId] = useState<string | null>(null);
  const [verifiedNodeIds, setVerifiedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [flickHint, setFlickHint] = useState<string | null>(null);
  const recipientSurfaceRef = useRef<HTMLElement | null>(null);
  const activeFlickRef = useRef<ActiveFlick | null>(null);

  useEffect(() => {
    if (!nativeRuntime) return;
    let active = true;
    void listPairedDevices()
      .then((paired) => {
        if (active) {
          setVerifiedNodeIds(new Set(paired.map((device) => device.node_id)));
        }
      })
      .catch(() => {
        if (active) setVerifiedNodeIds(new Set());
      });
    return () => {
      active = false;
    };
  }, [nativeRuntime]);

  const selectionSize = useMemo(
    () => shareSelection.reduce((total, item) => total + item.size, 0),
    [shareSelection],
  );
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;
  const bluetoothDiscoverySupported =
    platformProfile.capabilities.bluetooth_discovery;
  const bluetoothDiscoveryEnabled =
    bluetoothDiscoverySupported &&
    (settings?.bluetooth_discovery_enabled ?? false);
  const discoveryEnabled =
    localDiscoveryEnabled || bluetoothDiscoveryEnabled;
  const visibleToNearbyPeers =
    Boolean(shareTicket) &&
    (nodeStatus.lan_discovery_active || bleDiscoveryStatus.advertising);
  const receiveHandoffLink = shareTicket
    ? createReceiveHandoffLink(shareTicket)
    : null;

  useEffect(() => {
    if (!nativeRuntime || mobileRuntime) {
      return;
    }

    return attachAsyncUnlisten(
      onWindowDragDropEvent((event) => {
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
      }),
      (reason: unknown) => {
        const message =
          reason instanceof Error
            ? reason.message
            : "Failed to register drag-and-drop";
        setError(message);
      },
    );
  }, [mobileRuntime, nativeRuntime, prepareShareSelection, setError]);

  useEffect(() => {
    let active = true;

    if (!receiveHandoffLink) {
      setQrSvg(null);
      return () => {
        active = false;
      };
    }

    void renderTicketQr(receiveHandoffLink)
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
  }, [receiveHandoffLink]);

  useEffect(() => {
    setShowRawTicket(false);
  }, [shareTicket]);

  const handleCopyReceiveLink = async (): Promise<void> => {
    if (!receiveHandoffLink) {
      return;
    }

    try {
      await writeClipboardText(receiveHandoffLink);
      setCopied("link");
      window.setTimeout(() => setCopied(null), 1800);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy failed");
    }
  };

  const handleCopyRawTicket = async (): Promise<void> => {
    if (!shareTicket) {
      return;
    }

    try {
      await writeClipboardText(shareTicket);
      setCopied("ticket");
      window.setTimeout(() => setCopied(null), 1800);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Copy failed");
    }
  };

  const handlePrimaryStageAction = async (): Promise<void> => {
    if (!nativeRuntime) {
      return;
    }

    await pickShareFiles();
  };

  const handleSendToDevice = async (device: NearbyDevice): Promise<void> => {
    let paths = shareSelection.map((item) => item.path);
    if (paths.length === 0) {
      try {
        paths = await pickShareFilesFromDialog();
      } catch (error) {
        setError(error instanceof Error ? error.message : "File picker failed");
        return;
      }
      if (paths.length === 0) return;
      await prepareShareSelection(paths);
    }

    setBusyNodeId(device.node_id);
    setError(null);
    try {
      const offerId = await offerShareToPeer(device.node_id, paths);
      recordOutbound({
        offerId,
        receiverNodeId: device.node_id,
        status: "accepted",
        message: `Accepted by ${device.device_name}`,
        updatedAt: Date.now(),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send offer");
    } finally {
      setBusyNodeId(null);
    }
  };

  const cancelFlick = (): void => {
    const active = activeFlickRef.current;
    if (active?.element.hasPointerCapture(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId);
    }
    activeFlickRef.current = null;
    setDropTargetNodeId(null);
  };

  const handleFlickPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      event.pointerType === "mouse" ||
      shareSelection.length === 0 ||
      devices.length === 0 ||
      busyNodeId !== null
    ) {
      return;
    }
    const targets = Array.from(
      recipientSurfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-flick-target]",
      ) ?? [],
    ).flatMap((element) => {
      const nodeId = element.dataset.flickTarget;
      if (!nodeId) return [];
      const rect = element.getBoundingClientRect();
      return [
        {
          nodeId,
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          centerX: rect.left + rect.width / 2,
          centerY: rect.top + rect.height / 2,
        },
      ];
    });
    if (targets.length === 0) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeFlickRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      targets,
      element: event.currentTarget,
    };
    setFlickHint("Flick toward a device to send");
  };

  const handleFlickPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    const active = activeFlickRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const target = active.targets.find(
      (candidate) =>
        event.clientX >= candidate.left &&
        event.clientX <= candidate.right &&
        event.clientY >= candidate.top &&
        event.clientY <= candidate.bottom,
    );
    setDropTargetNodeId(target?.nodeId ?? null);
  };

  const handleFlickPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    const active = activeFlickRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeFlickRef.current = null;
    setDropTargetNodeId(null);
    setFlickHint(null);
    if (active.element.hasPointerCapture(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId);
    }

    const atSystemEdge =
      event.clientX < 24 ||
      event.clientX > window.innerWidth - 24 ||
      event.clientY < 24 ||
      event.clientY > window.innerHeight - 24;
    if (atSystemEdge) return;
    const target = active.targets.find(
      (candidate) =>
        event.clientX >= candidate.left &&
        event.clientX <= candidate.right &&
        event.clientY >= candidate.top &&
        event.clientY <= candidate.bottom,
    );
    if (!target) return;
    const device = devices.find(
      (candidate) => candidate.node_id === target.nodeId,
    );
    if (!device) {
      setError("That device is no longer nearby. Choose a device again.");
      return;
    }
    const elapsedMs = performance.now() - active.startedAt;
    if (
      isDeliberateFlick({
        dx: event.clientX - active.startX,
        dy: event.clientY - active.startY,
        elapsedMs,
        targetX: target.centerX - active.startX,
        targetY: target.centerY - active.startY,
      })
    ) {
      void handleSendToDevice(device);
    }
  };

  useEffect(() => {
    const cancel = (): void => {
      if (!activeFlickRef.current) return;
      cancelFlick();
      setFlickHint(null);
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    window.addEventListener("orientationchange", cancel);
    window.addEventListener("scroll", cancel, true);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("orientationchange", cancel);
      window.removeEventListener("scroll", cancel, true);
    };
  }, []);

  const handleSelectionDragStart = (event: DragEvent<HTMLDivElement>): void => {
    if (shareSelection.length === 0 || mobileRuntime) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-lightning-selection", "files");
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <div className="min-w-0 space-y-4">
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
          tabIndex={nativeRuntime ? 0 : -1}
          role={nativeRuntime ? "button" : undefined}
          aria-label={
            nativeRuntime
              ? "Choose files to share or drop files here"
              : undefined
          }
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="glass-icon h-14 w-14 rounded-[20px]">
                <Upload className="h-6 w-6 text-sky-200" />
              </div>
              <p className="page-eyebrow mt-5">Send</p>
              <h1 className="mt-2 text-[clamp(1.8rem,1.6rem+0.8vw,2.4rem)] font-semibold tracking-[-0.04em] text-white">
                {isDragActive
                  ? "Release to stage files"
                  : mobileRuntime
                    ? "Pick files to share"
                    : "Drop files to share"}
              </h1>
              <p className="meta-copy mt-3 max-w-[58ch]">
                {mobileRuntime
                  ? "Pick files from this phone, keep the app open, then generate one receive link when you are ready."
                  : "Choose files or a folder, then generate one receive link when you are ready."}
              </p>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
                <span className="chrome-pill">
                  Network {networkLabel(nodeStatus.online_state)}
                </span>
                <span className="chrome-pill">
                  {visibleToNearbyPeers
                    ? "Visible to nearby peers"
                    : discoveryEnabled
                      ? "Nearby discovery enabled"
                      : "Manual link only"}
                </span>
              </div>
              <button
                type="button"
                onClick={onNavigateReceive}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/[0.1] px-4 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <ArrowDownToLine className="h-4 w-4" />
                Receive a file
              </button>
            </div>

            <div
              data-stage-action="true"
              className={`flex flex-col gap-3 ${mobileRuntime ? "w-full" : "w-full max-w-[320px]"}`}
            >
              <button
                onClick={() => void pickShareFiles()}
                disabled={!nativeRuntime || isPreparingSelection || isSharing}
                className={
                  mobileRuntime
                    ? "mobile-hero-cta"
                    : "btn-primary justify-center"
                }
              >
                <span className="relative inline-flex items-center gap-2">
                  <File className={mobileRuntime ? "h-5 w-5" : "h-4 w-4"} />
                  {mobileRuntime ? "Share files" : "Choose files"}
                </span>
              </button>
              {!mobileRuntime ? (
                <button
                  onClick={() => void pickShareFolder()}
                  disabled={!nativeRuntime || isPreparingSelection || isSharing}
                  className="glass-button inline-flex items-center justify-center gap-2 px-5 py-3 text-sm text-slate-100"
                >
                  <Folder className="h-4 w-4" />
                  Choose folder
                </button>
              ) : null}
              {!nativeRuntime ? (
                <p className="text-xs leading-6 text-slate-500">
                  File and folder pickers require the native Lightning P2P app
                  runtime.
                </p>
              ) : mobileRuntime ? (
                <p className="text-xs leading-6 text-slate-500">
                  Pick files here, or use any app's Share button and choose
                  Lightning P2P. Pictures go to Pictures, audio to Music, video
                  to Movies, other files to Downloads.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {isPreparingSelection && shareSelection.length === 0 ? (
        <section
          className="glass-panel flex flex-wrap items-center gap-3 p-5"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin text-sky-300" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">
              Reading your selection
            </p>
            <p className="meta-copy mt-1">
              Scanning files and folders before staging them for share.
            </p>
          </div>
          <button
            type="button"
            onClick={clearShareSelection}
            className="glass-button ml-auto min-h-11 px-4 text-sm text-slate-100"
          >
            Cancel
          </button>
        </section>
      ) : null}

      {shareSelection.length > 0 ? (
        <section className="glass-panel p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">
                Staged selection
              </p>
              <p className="meta-copy mt-1">
                {shareSelection.length} item
                {shareSelection.length === 1 ? "" : "s"} ready |{" "}
                {formatBytes(selectionSize)}
              </p>
              {!mobileRuntime ? (
                <p className="mt-2 text-xs text-slate-400">
                  Drag the file stack onto a nearby device, or choose Send.
                </p>
              ) : null}
              {nativeRuntime && devices.length > 0 ? (
                <button
                  type="button"
                  aria-label="Flick toward a nearby device to send the staged files"
                  onPointerDown={handleFlickPointerDown}
                  onPointerMove={handleFlickPointerMove}
                  onPointerUp={handleFlickPointerUp}
                  onPointerCancel={() => {
                    cancelFlick();
                    setFlickHint(null);
                  }}
                  onLostPointerCapture={() => {
                    if (activeFlickRef.current) {
                      cancelFlick();
                      setFlickHint(null);
                    }
                  }}
                  style={{ touchAction: "none" }}
                  className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--accent-primary)]/35 bg-[var(--accent-primary)]/10 px-4 text-xs font-semibold text-blue-100 transition hover:bg-[var(--accent-primary)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  <span aria-hidden="true" className="text-base">
                    ↗
                  </span>
                  {flickHint ?? "Flick to a device"}
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void pickShareFiles(true)}
                disabled={isPreparingSelection || isSharing || !nativeRuntime}
                className="glass-button inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate-100"
              >
                <File className="h-4 w-4" />
                {isPreparingSelection ? "Adding files…" : "Add files"}
              </button>
              <button
                onClick={clearShareSelection}
                disabled={isSharing}
                className="glass-button inline-flex items-center gap-2 px-4 py-2.5 text-sm text-slate-100"
              >
                <Trash2 className="h-4 w-4" />
                Clear
              </button>
              <button
                onClick={() => void createShare()}
                disabled={isSharing || !nativeRuntime}
                className="btn-primary"
              >
                <span className="relative inline-flex items-center gap-2">
                  {isSharing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                  {isSharing ? "Generating link..." : "Generate receive link"}
                </span>
              </button>
            </div>
          </div>

          <div
            className="mt-4 grid gap-2"
            draggable={shareSelection.length > 0 && !mobileRuntime}
            onDragStart={handleSelectionDragStart}
            onDragEnd={() => setDropTargetNodeId(null)}
            aria-label="Selected files. Drag onto a nearby device to send."
          >
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
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium tabular-nums text-slate-300/78">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${item.name} from selection`}
                      title={`Remove ${item.name}`}
                      onClick={() => removeShareSelectionItem(item.path)}
                      disabled={isSharing}
                      className="grid h-10 w-10 place-items-center rounded-full text-slate-400 transition hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

        </div>
        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start">
      <section
        ref={recipientSurfaceRef}
        className="glass-panel p-5"
        aria-labelledby="nearby-recipient-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="page-eyebrow">Choose a destination</p>
            <h2
              id="nearby-recipient-title"
              className="mt-1 text-lg font-semibold text-white"
            >
              Nearby devices
            </h2>
          </div>
          <p className="text-xs leading-5 text-slate-400">
            Device names are supplied by nearby peers. Confirm the device before
            sending.
          </p>
        </div>
        {!nativeRuntime ? (
          <p className="meta-copy mt-4">
            Open the native app to send files to nearby devices.
          </p>
        ) : devices.length > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {devices.map((device) => (
              <button
                key={device.node_id}
                data-flick-target={device.node_id}
                type="button"
                onClick={() => void handleSendToDevice(device)}
                onDragOver={(event) => {
                  if (
                    event.dataTransfer.types.includes(
                      "application/x-lightning-selection",
                    )
                  ) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setDropTargetNodeId(device.node_id);
                  }
                }}
                onDragLeave={() => setDropTargetNodeId(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  if (
                    event.dataTransfer.getData(
                      "application/x-lightning-selection",
                    )
                  ) {
                    void handleSendToDevice(device);
                  }
                  setDropTargetNodeId(null);
                }}
                disabled={busyNodeId !== null || !nativeRuntime}
                className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition disabled:opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${dropTargetNodeId === device.node_id ? "border-sky-300/60 bg-sky-400/10" : "border-white/[0.08] bg-white/[0.025] hover:border-sky-300/30 hover:bg-white/[0.05]"}`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04]">
                  <LaptopMinimal className="h-4 w-4 text-sky-200" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-white">
                    {device.device_name}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">
                    {dropTargetNodeId === device.node_id
                      ? `Release to send to ${device.device_name}`
                      : busyNodeId === device.node_id
                        ? "Preparing and offering…"
                        : device.transport === "ble"
                          ? "Bluetooth nearby"
                          : device.transport === "both"
                            ? "Wi-Fi and Bluetooth"
                            : "On your local network"}
                  </span>
                  <span
                    className={`mt-1 inline-flex items-center gap-1 text-[10px] font-medium ${verifiedNodeIds.has(device.node_id) ? "text-emerald-200" : "text-amber-200/85"}`}
                  >
                    {verifiedNodeIds.has(device.node_id) ? (
                      <>
                        <ShieldCheck className="h-3 w-3" /> Verified by you
                      </>
                    ) : (
                      "Not verified"
                    )}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-sky-200">
                  {busyNodeId === device.node_id
                    ? "Working"
                    : shareSelection.length > 0
                      ? "Send"
                      : "Choose files"}
                </span>
              </button>
            ))}
          </div>
        ) : !discoveryEnabled ? (
          <p className="meta-copy mt-4">
            Nearby discovery is off. Turn on local network discovery
            {bluetoothDiscoverySupported
              ? " or Bluetooth discovery"
              : ""} in Settings, or choose files to create a receive link.
          </p>
        ) : (
          <p className="meta-copy mt-4">
            {bluetoothDiscoveryEnabled && !localDiscoveryEnabled
              ? "No Bluetooth peers found yet. Check that Bluetooth is on, permissions are granted, and Lightning is open on a supported device."
              : "No nearby devices found yet. Open Lightning on another device with a compatible discovery method enabled. Some networks block local discovery."}{" "}
            You can also create a receive link above.
          </p>
        )}
      </section>
        </aside>
      </div>

      {shareTicket ? (
        <section className="glass-panel p-5">
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Share link ready
                  </p>
                  <p className="meta-copy mt-1">
                    Copy the receive link or scan the QR code on the receiving
                    device. Keep this sender window open until the receiver is
                    done.
                  </p>
                </div>
                <button
                  onClick={() => void handleCopyReceiveLink()}
                  className={`glass-button inline-flex items-center gap-2 px-4 py-2 text-sm ${
                    copied === "link"
                      ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                      : "text-slate-100"
                  }`}
                >
                  <Copy className="h-4 w-4" />
                  {copied === "link" ? "Link copied" : "Copy share link"}
                </button>
              </div>

              <div
                className={`rounded-[20px] border px-4 py-3 text-sm ${
                  visibleToNearbyPeers
                    ? "border-emerald-400/18 bg-emerald-500/10 text-emerald-50"
                    : "border-white/8 bg-white/[0.03] text-slate-300"
                }`}
              >
                <p className="metric-label">
                  {visibleToNearbyPeers
                    ? "Nearby discovery is active"
                    : discoveryEnabled
                      ? "Share link is ready; discovery is starting"
                      : "Nearby discovery is disabled"}
                </p>
                <p className="mt-2 leading-6">
                  {visibleToNearbyPeers
                    ? "Peers found through the active discovery methods may see this share while you stay online. If the receiver does not appear, send them this receive link."
                    : discoveryEnabled
                      ? "Discovery is enabled but not active yet. Send the receive link if the receiver does not appear automatically."
                      : "Receivers will need the share link, raw ticket, or QR code explicitly."}
                </p>
              </div>

              {receiveHandoffLink ? (
                <div className="overflow-hidden rounded-[20px] border border-emerald-400/16 bg-emerald-500/[0.08] p-4">
                  <p className="metric-label text-emerald-100/80">
                    Recommended receive link
                  </p>
                  <code className="mt-2 block break-all font-mono text-[13px] leading-7 text-emerald-50/90">
                    {displayReceiveLink(receiveHandoffLink)}
                  </code>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-[20px] border border-white/[0.08] bg-black/25 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="metric-label">Raw ticket fallback</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setShowRawTicket((value) => !value)}
                      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-white/[0.08]"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {showRawTicket ? "Hide" : "Reveal"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCopyRawTicket()}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        copied === "ticket"
                          ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-100"
                          : "border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                      }`}
                    >
                      {copied === "ticket" ? "Ticket copied" : "Copy"}
                    </button>
                  </div>
                </div>
                {showRawTicket ? (
                  <code className="block break-all font-mono text-[13px] leading-7 text-sky-50/88">
                    {shareTicket}
                  </code>
                ) : (
                  <p className="text-sm leading-6 text-slate-300">
                    Hidden because anyone with the ticket can receive while this
                    share is active. Reveal it only for manual paste fallback.
                  </p>
                )}
              </div>
            </div>

            <div className="glass-subtle flex flex-col items-center justify-center gap-4 p-5 text-center">
              {qrSvg ? (
                <div
                  className="qr-code-frame rounded-[20px] border border-white/[0.08] bg-white p-3"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              ) : (
                <div className="glass-icon h-20 w-20 rounded-[24px]">
                  <Link2 className="h-6 w-6 text-slate-400" />
                </div>
              )}
              <div>
                <p className="text-sm font-semibold text-white">
                  Scan to receive
                </p>
                <p className="meta-copy mt-1">
                  Opens the receive handoff page first; nearby discovery and
                  manual ticket entry still work.
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
          <TransferCard
            transfer={sendTransfer}
            onCancel={(transferId) => void cancelTransfer(transferId)}
          />
        </section>
      ) : null}
    </div>
  );
}
