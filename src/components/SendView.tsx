import {
  ArrowUpRight,
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
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatBytes } from "../lib/format";
import { safeDisplayText } from "../lib/safeDisplayText";
import { groupNearbyDevices } from "../lib/nearbyDeviceGroups";
import { getNearbyDiscoveryStatus } from "../lib/nearbyDiscoveryStatus";
import {
  arrivalDirectionFromSenderFlick,
  flickDirectionForGesture,
  flickTargetAtPoint,
  hasIntentionalFlickTravel,
  isAdditionalFlickPointer,
  movedBeyondFlickClickSlop,
  type FlickDirection,
  type FlickTargetBounds,
} from "../lib/flickGesture";
import { createReceiveHandoffLink } from "../lib/shareLinks";
import { attachAsyncUnlisten } from "../hooks/asyncSubscription";
import {
  isDesktopRuntime,
  isMobileRuntime,
  offerShareToPeer,
  onWindowDragDropEvent,
  onPairedDevicesUpdated,
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

const FLICK_DIRECTION_LABELS: Record<FlickDirection, string> = {
  right: "right",
  down_right: "down and right",
  down: "down",
  down_left: "down and left",
  left: "left",
  up_left: "up and left",
  up: "up",
  up_right: "up and right",
};

const FLICK_ARRIVAL_SIDE_LABELS: Record<FlickDirection, string> = {
  right: "right",
  down_right: "lower right",
  down: "bottom",
  down_left: "lower left",
  left: "left",
  up_left: "upper left",
  up: "top",
  up_right: "upper right",
};

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

interface ActiveFlick {
  nodeId?: string;
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  element: HTMLElement;
  targets?: FlickTargetBounds[];
  devices?: NearbyDevice[];
  selectionPaths?: string[];
  movedBeyondClickSlop?: boolean;
}

interface ActiveSelectionDrag {
  startX: number;
  startY: number;
  startedAt: number;
  targets: FlickTargetBounds[];
  devices: NearbyDevice[];
  selectionPaths: string[];
}

function snapshotFlickTargets(): FlickTargetBounds[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-flick-target-node-id]"),
  ).flatMap((element) => {
    const nodeId = element.dataset.flickTargetNodeId;
    const rect = element.getBoundingClientRect();
    return nodeId && rect.width > 0 && rect.height > 0
      ? [
          {
            nodeId,
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
          },
        ]
      : [];
  });
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
  const [flickDevices, setFlickDevices] = useState<NearbyDevice[] | null>(null);
  const [flickVerifiedNodeIds, setFlickVerifiedNodeIds] =
    useState<Set<string> | null>(null);
  const [verifiedNodeIds, setVerifiedNodeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [flickHint, setFlickHint] = useState<string | null>(null);
  const suppressFlickClickRef = useRef<string | null>(null);
  const recipientDevices = flickDevices ?? devices;
  const recipientVerifiedNodeIds = flickVerifiedNodeIds ?? verifiedNodeIds;
  const recipientGroups = groupNearbyDevices(
    recipientDevices,
    recipientVerifiedNodeIds,
  );
  const activeFlickRef = useRef<ActiveFlick | null>(null);
  const activeSelectionDragRef = useRef<ActiveSelectionDrag | null>(null);

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

  useEffect(() => {
    if (!nativeRuntime) return;
    return attachAsyncUnlisten(
      onPairedDevicesUpdated((paired) => {
        setVerifiedNodeIds(new Set(paired.map((device) => device.node_id)));
      }),
      (error: unknown) =>
        setError(
          error instanceof Error
            ? error.message
            : "Could not subscribe to saved device updates",
        ),
    );
  }, [nativeRuntime, setError]);

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
  const nearbyDiscoveryStatus = getNearbyDiscoveryStatus({
    localEnabled: localDiscoveryEnabled,
    bluetoothEnabled: bluetoothDiscoveryEnabled,
    lanActive: nodeStatus.lan_discovery_active,
    diagnosticState: "searching",
  });
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

  const handleSendToDevice = async (
    device: NearbyDevice,
    flickDirection?: FlickDirection,
  ): Promise<void> => {
    const initial = useTransferStore.getState();
    if (
      busyNodeId !== null ||
      initial.isPreparingSelection ||
      initial.isSharing
    ) {
      return;
    }
    setBusyNodeId(device.node_id);
    setError(null);
    try {
      let paths = initial.shareSelection.map((item) => item.path);
      if (paths.length === 0) {
        const pickedPaths = await pickShareFilesFromDialog();
        if (pickedPaths.length === 0) return;

        const current = useTransferStore.getState();
        if (current.isPreparingSelection || current.isSharing) return;
        await prepareShareSelection(pickedPaths);

        const prepared = useTransferStore.getState();
        paths = prepared.shareSelection.map((item) => item.path);
        if (paths.length === 0) {
          setError(prepared.error ?? "Lightning could not prepare those files.");
          return;
        }
      }

      const current = useTransferStore.getState();
      if (current.isPreparingSelection || current.isSharing) return;
      const currentPaths = current.shareSelection.map((item) => item.path);
      if (
        currentPaths.length !== paths.length ||
        currentPaths.some((path, index) => path !== paths[index])
      ) {
        setError("Your selection changed. Review it and send again.");
        return;
      }

      const offerId = await offerShareToPeer(
        device.node_id,
        paths,
        flickDirection,
      );
      recordOutbound({
        offerId,
        receiverNodeId: device.node_id,
        status: "accepted",
        message: `Accepted by ${safeDisplayText(device.device_name, "nearby device")}`,
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
    activeSelectionDragRef.current = null;
    setDropTargetNodeId(null);
    setFlickDevices(null);
    setFlickVerifiedNodeIds(null);
  };

  const cancelFlickWithFeedback = (): void => {
    const wasActive = activeFlickRef.current !== null;
    cancelFlick();
    setFlickHint(null);
    if (wasActive) {
      setError("Flick cancelled. Tap Send to continue, or try the gesture again.");
    }
  };

  const handleSelectionPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      shareSelection.length === 0 ||
      isPreparingSelection ||
      isSharing ||
      busyNodeId !== null
    ) {
      return;
    }

    const targets = snapshotFlickTargets();
    if (targets.length === 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    activeFlickRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      element: event.currentTarget,
      targets,
      devices: devices.map((device) => ({ ...device })),
      selectionPaths: shareSelection.map((item) => item.path),
    };
    setFlickDevices(devices.map((device) => ({ ...device })));
    setFlickVerifiedNodeIds(new Set(verifiedNodeIds));
    setFlickHint("Drag the file stack onto a device to send");
  };

  const handleSelectionPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const active = activeFlickRef.current;
    if (!active || active.pointerId !== event.pointerId) return;

    const targetNodeId = flickTargetAtPoint(
      active.targets ?? [],
      event.clientX,
      event.clientY,
    );
    setDropTargetNodeId((current) =>
      current === targetNodeId ? current : targetNodeId,
    );

    if (targetNodeId) {
      const dx = event.clientX - active.startX;
      const dy = event.clientY - active.startY;
      const direction = flickDirectionForGesture({
        dx,
        dy,
        elapsedMs: performance.now() - active.startedAt,
      });
      const arrivalDirection = direction
        ? arrivalDirectionFromSenderFlick(direction)
        : null;
      const arrivalSide = arrivalDirection
        ? FLICK_ARRIVAL_SIDE_LABELS[arrivalDirection]
        : null;
      const device = active.devices?.find(
        (candidate) => candidate.node_id === targetNodeId,
      );
      setFlickHint(
        device
          ? arrivalSide
            ? `Release to send to ${safeDisplayText(device.device_name, "nearby device")} · arrives from ${arrivalSide}`
            : `Release to send to ${safeDisplayText(device.device_name, "nearby device")}`
          : "Release over a nearby device to send",
      );
    } else {
      setFlickHint("Drag the file stack onto a device to send");
    }
  };

  const handleSelectionPointerUp = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const active = activeFlickRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeFlickRef.current = null;
    setDropTargetNodeId(null);
    setFlickDevices(null);
    setFlickVerifiedNodeIds(null);
    setFlickHint(null);
    if (active.element.hasPointerCapture(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId);
    }

    const targetNodeId = flickTargetAtPoint(
      active.targets ?? [],
      event.clientX,
      event.clientY,
    );
    if (!targetNodeId) return;

    const currentPaths = useTransferStore
      .getState()
      .shareSelection.map((item) => item.path);
    if (
      currentPaths.length !== (active.selectionPaths?.length ?? 0) ||
      currentPaths.some((path, index) => path !== active.selectionPaths?.[index])
    ) {
      setError("Your selection changed during the flick. Review it and send again.");
      return;
    }

    const device = devices.find((candidate) => candidate.node_id === targetNodeId);
    if (!device) {
      setError("That device left before you released. Choose a device again.");
      return;
    }

    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const elapsedMs = performance.now() - active.startedAt;
    const direction =
      flickDirectionForGesture({ dx, dy, elapsedMs }) ?? undefined;
    void handleSendToDevice(device, direction);
  };

  const handleSelectionDragStart = (event: DragEvent<HTMLDivElement>): void => {
    if (shareSelection.length === 0 || mobileRuntime) {
      event.preventDefault();
      return;
    }
    const targets = snapshotFlickTargets();
    if (targets.length === 0) {
      event.preventDefault();
      return;
    }
    activeSelectionDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      targets,
      devices: devices.map((device) => ({ ...device })),
      selectionPaths: shareSelection.map((item) => item.path),
    };
    setFlickDevices(devices.map((device) => ({ ...device })));
    setFlickVerifiedNodeIds(new Set(verifiedNodeIds));
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-lightning-selection", "files");
  };

  const handleSelectionDrop = (
    event: DragEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    const active = activeSelectionDragRef.current;
    activeSelectionDragRef.current = null;
    setDropTargetNodeId(null);
    setFlickDevices(null);
    setFlickVerifiedNodeIds(null);
    if (!event.dataTransfer.getData("application/x-lightning-selection")) {
      return;
    }
    if (!active) {
      setError("The drag session ended before the device received the files. Try again.");
      return;
    }

    const currentPaths = useTransferStore
      .getState()
      .shareSelection.map((item) => item.path);
    if (
      currentPaths.length !== active.selectionPaths.length ||
      currentPaths.some((path, index) => path !== active.selectionPaths[index])
    ) {
      setError("Your selection changed during the drag. Review it and send again.");
      return;
    }

    const targetNodeId = flickTargetAtPoint(
      active.targets,
      event.clientX,
      event.clientY,
    );
    if (!targetNodeId) return;

    const intendedDevice = active.devices.find(
      (candidate) => candidate.node_id === targetNodeId,
    );
    const liveDevice = devices.find((candidate) => candidate.node_id === targetNodeId);
    if (!liveDevice) {
      setError("That device left during the drag. Choose a device again.");
      return;
    }
    if (!intendedDevice) return;

    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const direction = flickDirectionForGesture({
      dx,
      dy,
      elapsedMs: performance.now() - active.startedAt,
    }) ?? undefined;
    void handleSendToDevice(liveDevice, direction);
  };

  const handleFlickPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    device: NearbyDevice,
  ): void => {
    if (
      !event.isPrimary ||
      event.button !== 0 ||
      shareSelection.length === 0 ||
      isPreparingSelection ||
      isSharing ||
      devices.length === 0 ||
      busyNodeId !== null
    ) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    activeFlickRef.current = {
      nodeId: device.node_id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      element: event.currentTarget,
      selectionPaths: shareSelection.map((item) => item.path),
    };
    setFlickDevices(devices.map((nearbyDevice) => ({ ...nearbyDevice })));
    setFlickVerifiedNodeIds(new Set(verifiedNodeIds));
    setDropTargetNodeId(device.node_id);
    setFlickHint("Flick toward their side to show the approximate arrival side");
  };

  const handleFlickPointerMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    const active = activeFlickRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (
      movedBeyondFlickClickSlop(
        event.clientX - active.startX,
        event.clientY - active.startY,
      )
    ) {
      active.movedBeyondClickSlop = true;
    }
    const direction = flickDirectionForGesture({
      dx: event.clientX - active.startX,
      dy: event.clientY - active.startY,
      elapsedMs: performance.now() - active.startedAt,
    });
    if (direction) {
      const arrivalDirection = arrivalDirectionFromSenderFlick(direction);
      setFlickHint(
        `Flick ${FLICK_DIRECTION_LABELS[direction]} · file arrives from the receiver’s ${FLICK_ARRIVAL_SIDE_LABELS[arrivalDirection]}`,
      );
    }
  };

  const handleFlickPointerUp = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    const active = activeFlickRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    activeFlickRef.current = null;
    setDropTargetNodeId(null);
    setFlickDevices(null);
    setFlickVerifiedNodeIds(null);
    setFlickHint(null);
    if (active.element.hasPointerCapture(active.pointerId)) {
      active.element.releasePointerCapture(active.pointerId);
    }

    const elapsedMs = performance.now() - active.startedAt;
    const dx = event.clientX - active.startX;
    const dy = event.clientY - active.startY;
    const direction = flickDirectionForGesture({ dx, dy, elapsedMs });
    const movedBeyondClickSlop =
      active.movedBeyondClickSlop ||
      movedBeyondFlickClickSlop(dx, dy);
    if (active.nodeId && movedBeyondClickSlop) {
      event.preventDefault();
      suppressFlickClickRef.current = active.nodeId;
      window.setTimeout(() => {
        if (suppressFlickClickRef.current === active.nodeId) {
          suppressFlickClickRef.current = null;
        }
      }, 0);
    }

    const device = devices.find(
      (candidate) => candidate.node_id === active.nodeId,
    );
    if (!device) {
      setError("That device is no longer nearby. Choose a device again.");
      return;
    }
    const currentPaths = useTransferStore
      .getState()
      .shareSelection.map((item) => item.path);
    if (
      currentPaths.length !== (active.selectionPaths?.length ?? 0) ||
      currentPaths.some((path, index) => path !== active.selectionPaths?.[index])
    ) {
      setError("Your selection changed during the flick. Review it and send again.");
      return;
    }
    if (direction) {
      void handleSendToDevice(device, direction);
    } else if (hasIntentionalFlickTravel(dx, dy)) {
      void handleSendToDevice(device);
    } else if (movedBeyondClickSlop) {
      setError(
        "That movement was too short to send. Tap Send or drag farther to the target.",
      );
    }
  };

  useEffect(() => {
    const cancel = (): void => {
      if (!activeFlickRef.current && !activeSelectionDragRef.current) return;
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

  const cancelOnAdditionalPointer = useEffectEvent((event: PointerEvent) => {
    const active = activeFlickRef.current;
    if (
      !isAdditionalFlickPointer(
        active?.pointerId ?? null,
        event.pointerId,
        event.isPrimary,
      )
    ) {
      return;
    }

    cancelFlick();
    setFlickHint(null);
    setError(
      "Flick cancelled because another pointer started. Try again with one finger.",
    );
  });

  useEffect(() => {
    window.addEventListener("pointerdown", cancelOnAdditionalPointer, true);
    return () => {
      window.removeEventListener("pointerdown", cancelOnAdditionalPointer, true);
    };
  }, []);

  const renderDeviceTarget = (device: NearbyDevice) => (
    <div
      key={device.node_id}
      data-flick-target-node-id={device.node_id}
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes("application/x-lightning-selection")
        ) {
          const intendedTargetId = flickTargetAtPoint(
            activeSelectionDragRef.current?.targets ?? [],
            event.clientX,
            event.clientY,
          );
          if (intendedTargetId) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropTargetNodeId(intendedTargetId);
          } else {
            setDropTargetNodeId(null);
          }
        }
      }}
      onDragLeave={() => setDropTargetNodeId(null)}
      onDrop={handleSelectionDrop}
      className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 transition ${dropTargetNodeId === device.node_id ? "border-[var(--accent-border)] bg-[var(--accent-subtle)]" : "border-[var(--border-subtle)] bg-[var(--surface-1)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"}`}
    >
      <button
        type="button"
        onClick={() => void handleSendToDevice(device)}
        disabled={
          busyNodeId !== null ||
          isPreparingSelection ||
          isSharing ||
          !nativeRuntime
        }
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:opacity-55"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)]">
          <LaptopMinimal className="h-4 w-4 text-[var(--accent-primary)]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--fg-primary)]">
            {safeDisplayText(device.device_name, "Nearby device")}
          </span>
          <span className="mt-1 block text-xs text-[var(--fg-secondary)]">
            {dropTargetNodeId === device.node_id
              ? `Release to send to ${safeDisplayText(device.device_name, "Nearby device")}`
              : busyNodeId === device.node_id
                ? "Preparing and offering…"
                : device.transport === "ble"
                  ? "Bluetooth nearby"
                  : device.transport === "both"
                    ? "Wi-Fi and Bluetooth"
                    : "On your local network"}
          </span>
          <span
            className={`mt-1 inline-flex items-center gap-1 text-xs font-medium ${recipientVerifiedNodeIds.has(device.node_id) ? "text-[var(--state-success)]" : "text-[var(--proof-amber)]"}`}
          >
            {recipientVerifiedNodeIds.has(device.node_id) ? (
              <>
                <ShieldCheck className="h-3.5 w-3.5" /> Verified by you
              </>
            ) : (
              "Not verified"
            )}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-[var(--accent-primary)]">
          {busyNodeId === device.node_id
            ? "Working"
            : shareSelection.length > 0
              ? "Send"
              : "Choose files"}
        </span>
      </button>
      {shareSelection.length > 0 && nativeRuntime ? (
        <div className="flex shrink-0 flex-col items-center gap-1">
          <button
            type="button"
            aria-label={`Send files to ${safeDisplayText(device.device_name, "this device")} normally. Swipe toward their side to add an approximate arrival direction.`}
            onClick={() => {
              if (suppressFlickClickRef.current === device.node_id) {
                suppressFlickClickRef.current = null;
                return;
              }
              void handleSendToDevice(device);
            }}
            onPointerDown={(event) => handleFlickPointerDown(event, device)}
            onPointerMove={handleFlickPointerMove}
            onPointerUp={handleFlickPointerUp}
            onPointerCancel={cancelFlickWithFeedback}
            onLostPointerCapture={() => {
              if (activeFlickRef.current) {
                cancelFlickWithFeedback();
              }
            }}
            disabled={
              busyNodeId !== null || isPreparingSelection || isSharing
            }
            style={{ touchAction: "none" }}
            className="grid h-11 min-w-11 place-items-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-2 text-xs font-semibold text-[var(--accent-primary)] transition hover:bg-[var(--accent-border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:opacity-55"
          >
            {activeFlickRef.current?.nodeId === device.node_id && flickHint
              ? "Flicking…"
              : "Flick"}
          </button>
          <span
            className="max-w-36 text-center text-xs leading-4 text-[var(--fg-muted)]"
            aria-live="polite"
            aria-atomic="true"
          >
            {activeFlickRef.current?.nodeId === device.node_id && flickHint
              ? flickHint
              : "Tap to send · flick toward their side"}
          </span>
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <div className="min-w-0 space-y-4">
      <section
        className={`rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-0)] drop-zone ${isDragActive ? "drop-zone-active" : ""}`}
      >
        <div
          className={`simple-drop-zone ${
            isDragActive
              ? "border-[var(--accent-border)] bg-[var(--accent-subtle)]"
              : "border-[var(--border-subtle)] bg-[var(--surface-1)]"
          }`}
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-2)]">
                <Upload className="h-6 w-6 text-[var(--accent-primary)]" />
              </div>
              <p className="page-eyebrow mt-5">Send</p>
              <h1 className="mt-2 text-[clamp(1.8rem,1.6rem+0.8vw,2.4rem)] font-semibold tracking-[-0.04em] text-[var(--fg-primary)]">
                {isDragActive
                  ? "Release to stage files"
                  : mobileRuntime
                    ? "Pick files to share"
                    : "Drop files to share"}
              </h1>
              <p className="meta-copy mt-3 max-w-[58ch]">
                {mobileRuntime
                  ? "Pick files from this phone, then send nearby or create a receive link. Keep Lightning open while files move."
                  : "Choose files or a folder, then send nearby or create a receive link."}
              </p>

              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--fg-secondary)]">
                <span className="chrome-pill">
                  Network {networkLabel(nodeStatus.online_state)}
                </span>
                <span className="chrome-pill">
                  {visibleToNearbyPeers
                    ? "Visible to saved devices"
                    : discoveryEnabled
                      ? "Nearby discovery enabled"
                      : "Manual link only"}
                </span>
              </div>
              <button
                type="button"
                onClick={onNavigateReceive}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-strong)] px-4 text-sm font-medium text-[var(--fg-secondary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
              >
                <ArrowDownToLine className="h-4 w-4" />
                Receive a file
              </button>
            </div>

            <div
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
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-5 py-3 text-sm text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)]"
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
          className="flex flex-wrap items-center gap-3 rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-0)] p-5"
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
        <section className="rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-0)] p-5">
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
              <p className="mt-2 text-xs text-slate-400">
                Drag or flick the selection onto a device to send. A quick flick adds an approximate arrival side.
              </p>
              {nativeRuntime && recipientDevices.length > 0 ? (
                <>
                  <div
                    aria-hidden="true"
                    onPointerDown={handleSelectionPointerDown}
                    onPointerMove={handleSelectionPointerMove}
                    onPointerUp={handleSelectionPointerUp}
                    onPointerCancel={cancelFlickWithFeedback}
                    onLostPointerCapture={() => {
                      if (activeFlickRef.current) {
                        cancelFlickWithFeedback();
                      }
                    }}
                    style={{ touchAction: "none" }}
                    className={`mt-3 inline-flex min-h-11 select-none items-center gap-2 rounded-full border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/10 px-4 text-sm font-semibold text-sky-100 transition ${isPreparingSelection || isSharing || busyNodeId !== null ? "cursor-not-allowed opacity-55" : "cursor-grab hover:bg-[var(--accent-primary)]/20 active:cursor-grabbing"}`}
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    {activeFlickRef.current && !activeFlickRef.current.nodeId
                      ? "Flicking…"
                      : "Flick to device"}
                  </div>
                  {activeFlickRef.current && !activeFlickRef.current.nodeId ? (
                    <p
                      className="mt-2 text-xs text-sky-100"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {flickHint}
                    </p>
                  ) : null}
                </>
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
            onDragEnd={() => {
              activeSelectionDragRef.current = null;
              setDropTargetNodeId(null);
              setFlickDevices(null);
              setFlickVerifiedNodeIds(null);
            }}
            aria-label="Selected files. Drag onto a nearby device to send."
          >
            {shareSelection.map((item) => {
              const Icon = iconForSelection(item.name, item.is_dir);
              const itemName = safeDisplayText(item.name, "Selected item");

              return (
                <div
                  key={item.path}
                  className="flex items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-subtle)]">
                    <Icon className="h-4 w-4 text-[var(--accent-primary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--fg-primary)]">
                      {itemName}
                    </p>
                    <p className="text-xs text-[var(--fg-muted)]">
                      {item.is_dir ? "Folder" : "File"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-medium tabular-nums text-[var(--fg-secondary)]">
                      {formatBytes(item.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${itemName} from selection`}
                      title={`Remove ${itemName}`}
                      onClick={() => removeShareSelectionItem(item.path)}
                      disabled={isSharing}
                      className="grid h-10 w-10 place-items-center rounded-full text-[var(--fg-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--fg-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
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
        className="rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-0)] p-5"
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
        ) : recipientDevices.length > 0 ? (
          <div className="mt-4 space-y-5">
            {recipientGroups.myDevices.length > 0 ? (
              <section aria-labelledby="my-device-targets-title">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3
                    id="my-device-targets-title"
                    className="text-sm font-semibold text-white"
                  >
                    My Devices
                  </h3>
                  <span className="text-xs text-slate-400">
                    Saved and verified
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recipientGroups.myDevices.map(renderDeviceTarget)}
                </div>
              </section>
            ) : null}
            {recipientGroups.nearbyDevices.length > 0 ? (
              <section aria-labelledby="other-device-targets-title">
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3
                    id="other-device-targets-title"
                    className="text-sm font-semibold text-white"
                  >
                    Nearby devices
                  </h3>
                  <span className="text-xs text-slate-400">
                    Confirm the device name before sending
                  </span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {recipientGroups.nearbyDevices.map(renderDeviceTarget)}
                </div>
              </section>
            ) : null}
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
            {nearbyDiscoveryStatus === "bluetooth_only"
              ? "No Bluetooth peers found yet. Check that Bluetooth is on, permissions are granted, and Lightning is open on a supported device."
              : nearbyDiscoveryStatus === "lan_unavailable"
                ? "Local network discovery is not active yet. Check Settings or use the receive link above."
                : "No nearby devices found yet. Open Lightning on another device with a compatible discovery method enabled. Some networks block local discovery."}{" "}
            You can also create a receive link above.
          </p>
        )}
      </section>
        </aside>
      </div>

      {shareTicket ? (
        <section className="rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-0)] p-5">
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
                    ? "Saved devices found through active discovery may see this share while you stay online. If the receiver does not appear, send them this receive link."
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

            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] p-5 text-center">
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
