import {
  Check,
  Clock3,
  LaptopMinimal,
  QrCode,
  Radar,
  ScanSearch,
  Send,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { attachAsyncUnlisten } from "../hooks/asyncSubscription";
import { safeDisplayText } from "../lib/safeDisplayText";
import { getNearbyDiscoveryStatus } from "../lib/nearbyDiscoveryStatus";
import {
  getLocalDeviceIdentity,
  getDevicePairingCode,
  isDesktopRuntime,
  listPairedDevices,
  onPairedDevicesUpdated,
  offerShareToPeer,
  pickShareFiles,
  pairVerifiedDevice,
  removePairedDevice,
  renamePairedDevice,
  setReadyToCatch,
  type LocalDeviceIdentity,
  type NearbyDevice,
  type PairedDevice,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useNearbyDeviceStore } from "../stores/nearbyDeviceStore";
import { useNearbyDiagnosticStore } from "../stores/nearbyDiagnosticStore";
import { useTransferStore } from "../stores/transferStore";
import { DeviceCard } from "./DeviceCard";
import { EmptyState } from "./EmptyState";

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

interface ReadyToCatchNoticeProps {
  deviceName: string;
  expiresAtMs: number;
  onCancel: () => void;
  onExpire: () => void;
}

function ReadyToCatchNotice({
  deviceName,
  expiresAtMs,
  onCancel,
  onExpire,
}: ReadyToCatchNoticeProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)),
  );

  useEffect(() => {
    const tick = (): void => {
      const remaining = Math.max(
        0,
        Math.ceil((expiresAtMs - Date.now()) / 1000),
      );
      setSecondsRemaining(remaining);
      if (remaining === 0) onExpire();
    };
    const interval = window.setInterval(tick, 1000);
    const expiry = window.setTimeout(
      tick,
      Math.max(0, expiresAtMs - Date.now()),
    );
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(expiry);
    };
  }, [expiresAtMs, onExpire]);

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] px-4 py-3">
      <Clock3 className="h-4 w-4 text-[var(--accent-primary)]" />
      <p className="min-w-0 flex-1 text-sm leading-5 text-[var(--fg-secondary)]">
        Ready to Catch from <strong>{deviceName}</strong> for {secondsRemaining}
        s. One supported file up to 100 MiB. Received files never open
        automatically.
      </p>
      <button
        type="button"
        className="min-h-11 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-1.5 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
        onClick={onCancel}
      >
        Cancel
      </button>
    </div>
  );
}

export function DevicesView() {
  const nodeStatus = useTransferStore((state) => state.nodeStatus);
  const settings = useTransferStore((state) => state.settings);
  const platformProfile = useTransferStore((state) => state.platformProfile);
  const setError = useTransferStore((state) => state.setError);
  const prepareShareSelection = useTransferStore(
    (state) => state.prepareShareSelection,
  );
  const isPreparingSelection = useTransferStore(
    (state) => state.isPreparingSelection,
  );
  const isSharing = useTransferStore((state) => state.isSharing);
  const devices = useNearbyDeviceStore((state) => state.devices);
  const diagnosticState = useNearbyDiagnosticStore((state) => state.state);
  const recordOutbound = useIncomingOfferStore((state) => state.recordOutbound);
  const nativeRuntime = isDesktopRuntime();
  const localDiscoveryEnabled = settings?.local_discovery_enabled ?? true;
  const bluetoothDiscoverySupported =
    platformProfile.capabilities.bluetooth_discovery;
  const bluetoothDiscoveryEnabled =
    bluetoothDiscoverySupported &&
    (settings?.bluetooth_discovery_enabled ?? false);
  const discoveryEnabled = localDiscoveryEnabled || bluetoothDiscoveryEnabled;
  const nearbyDiscoveryStatus = getNearbyDiscoveryStatus({
    localEnabled: localDiscoveryEnabled,
    bluetoothEnabled: bluetoothDiscoveryEnabled,
    lanActive: nodeStatus.lan_discovery_active,
    diagnosticState,
  });
  const networkLikelyBlocked =
    nearbyDiscoveryStatus === "network_blocked" && devices.length === 0;
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null);
  const [localIdentity, setLocalIdentity] =
    useState<LocalDeviceIdentity | null>(null);
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const pairedDevicesRevision = useRef(0);
  const [pairingCandidate, setPairingCandidate] = useState<NearbyDevice | null>(
    null,
  );
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [pairingName, setPairingName] = useState("");
  const [codesConfirmed, setCodesConfirmed] = useState(false);
  const [savingPair, setSavingPair] = useState(false);
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [readySession, setReadySession] = useState<{
    nodeId: string;
    expiresAtMs: number;
  } | null>(null);
  const pairingNameRef = useRef<HTMLInputElement>(null);
  const previousPairingFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!pairingCandidate) return;
    if (
      previousPairingFocusRef.current === null &&
      document.activeElement instanceof HTMLElement
    ) {
      previousPairingFocusRef.current = document.activeElement;
    }
    pairingNameRef.current?.focus();
    return () => {
      previousPairingFocusRef.current?.focus();
      previousPairingFocusRef.current = null;
    };
  }, [pairingCandidate]);

  useEffect(() => {
    if (!readySession) return;
    return () => {
      void setReadyToCatch(readySession.nodeId, false).catch(() => undefined);
    };
  }, [readySession]);

  const expireReadySession = useCallback(() => setReadySession(null), []);

  useEffect(() => {
    const clearConsumedSession = (event: Event): void => {
      const nodeId = (event as CustomEvent<{ nodeId?: string }>).detail?.nodeId;
      if (nodeId) {
        setReadySession((current) =>
          current?.nodeId === nodeId ? null : current,
        );
      }
    };
    window.addEventListener(
      "lightning-ready-to-catch-consumed",
      clearConsumedSession,
    );
    return () =>
      window.removeEventListener(
        "lightning-ready-to-catch-consumed",
        clearConsumedSession,
      );
  }, []);

  useEffect(() => {
    if (!nativeRuntime) {
      return;
    }
    let active = true;
    // Refresh whenever the node finishes coming online (node_id flip from null
    // to set) so the identity card never reads "starting" once the endpoint
    // is bound.
    void getLocalDeviceIdentity().then((identity) => {
      if (active) {
        setLocalIdentity(identity);
      }
    });
    return () => {
      active = false;
    };
  }, [nativeRuntime, nodeStatus.node_id]);

  useEffect(() => {
    if (!nativeRuntime) return;
    let active = true;
    const revision = ++pairedDevicesRevision.current;
    void listPairedDevices()
      .then((saved) => {
        if (active && revision === pairedDevicesRevision.current) {
          setPairedDevices(saved);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Could not load saved devices",
          );
      });
    return () => {
      active = false;
    };
  }, [nativeRuntime, setError]);

  useEffect(() => {
    if (!nativeRuntime) return;
    return attachAsyncUnlisten(
      onPairedDevicesUpdated((saved) => {
        pairedDevicesRevision.current += 1;
        setPairedDevices(saved);
      }),
      (error: unknown) =>
        setError(
          error instanceof Error
            ? error.message
            : "Could not subscribe to saved device updates",
        ),
    );
  }, [nativeRuntime, setError]);

  const beginPairing = async (device: NearbyDevice): Promise<void> => {
    setError(null);
    try {
      const code = await getDevicePairingCode(device.node_id);
      setPairingCandidate(device);
      setPairingCode(code);
      setPairingName(safeDisplayText(device.device_name, "Nearby device"));
      setCodesConfirmed(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not verify this device",
      );
    }
  };

  const confirmPairing = async (): Promise<void> => {
    if (!pairingCandidate || !pairingCode || !codesConfirmed) return;
    setSavingPair(true);
    try {
      const saved = await pairVerifiedDevice(
        pairingCandidate.node_id,
        pairingName,
      );
      pairedDevicesRevision.current += 1;
      setPairedDevices(saved);
      setPairingCandidate(null);
      setPairingCode(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not save this device",
      );
    } finally {
      setSavingPair(false);
    }
  };

  const revokeDevice = async (nodeId: string): Promise<void> => {
    try {
      const saved = await removePairedDevice(nodeId);
      pairedDevicesRevision.current += 1;
      setPairedDevices(saved);
      setReadySession(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not remove this device",
      );
    }
  };

  const toggleReadyToCatch = async (nodeId: string): Promise<void> => {
    try {
      if (readySession?.nodeId === nodeId) {
        await setReadyToCatch(nodeId, false);
        setReadySession(null);
        return;
      }
      const expiresAt = await setReadyToCatch(nodeId, true);
      if (expiresAt !== null) {
        setReadySession({ nodeId, expiresAtMs: expiresAt * 1000 });
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not enable Ready to Catch",
      );
    }
  };

  const saveRename = async (nodeId: string): Promise<void> => {
    try {
      const saved = await renamePairedDevice(nodeId, renamingValue);
      pairedDevicesRevision.current += 1;
      setPairedDevices(saved);
      setRenamingNodeId(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not rename this device",
      );
    }
  };

  const handlePairingDialogKeyDown = (
    event: KeyboardEvent<HTMLElement>,
  ): void => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      event.currentTarget.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const handleSend = async (device: NearbyDevice): Promise<void> => {
    const initial = useTransferStore.getState();
    if (
      busyNodeId !== null ||
      initial.isPreparingSelection ||
      initial.isSharing
    ) {
      return;
    }
    setError(null);
    setBusyNodeId(device.node_id);
    try {
      let paths = initial.shareSelection.map((item) => item.path);
      if (paths.length === 0) {
        const pickedPaths = await pickShareFiles();
        if (pickedPaths.length === 0) return;
        const current = useTransferStore.getState();
        if (current.isPreparingSelection || current.isSharing) return;
        await prepareShareSelection(pickedPaths);
        const prepared = useTransferStore.getState();
        if (prepared.isPreparingSelection || prepared.isSharing) return;
        paths = prepared.shareSelection.map((item) => item.path);
        if (paths.length === 0) {
          setError(
            prepared.error ?? "Lightning could not prepare those files.",
          );
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

      const offerId = await offerShareToPeer(device.node_id, paths);
      recordOutbound({
        offerId,
        receiverNodeId: device.node_id,
        status: "accepted",
        message: `Accepted by ${safeDisplayText(device.device_name, "nearby device")}`,
        updatedAt: Date.now(),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send offer";
      setError(message);
    } finally {
      setBusyNodeId(null);
    }
  };

  return (
    <div className="space-y-4">
      <section className="glass-panel p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="glass-icon h-14 w-14 rounded-[20px]">
              <Send className="h-6 w-6 text-emerald-200" />
            </div>
            <p className="page-eyebrow mt-5">Devices</p>
            <h1 className="mt-2 text-[clamp(1.8rem,1.6rem+0.8vw,2.4rem)] font-semibold tracking-[-0.04em] text-white">
              Tap a nearby device to send
            </h1>
            <p className="meta-copy mt-3 max-w-[58ch]">
              Devices appear here when an enabled discovery method finds them.
              Choose a peer and its receiver must accept before files move.
              Bluetooth discovery is available on supported platforms; it helps
              find peers but does not verify identity or measure exact distance.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
              <span className="chrome-pill">
                Network {networkLabel(nodeStatus.online_state)}
              </span>
              <span className="chrome-pill">
                {localDiscoveryEnabled
                  ? "Nearby discovery enabled"
                  : "Nearby discovery disabled"}
              </span>
              <span className="chrome-pill">{devices.length} visible</span>
            </div>
          </div>

          <div className="glass-subtle flex w-full max-w-[340px] flex-col gap-3 px-4 py-4">
            <p className="metric-label">You're visible as</p>
            <div className="flex items-start gap-3">
              <div className="glass-icon h-10 w-10 shrink-0">
                <LaptopMinimal className="h-4 w-4 text-emerald-200" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">
                  {safeDisplayText(
                    localIdentity?.device_name ?? "",
                    "Detecting device name...",
                  )}
                </p>
                <p className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-400">
                  {localIdentity
                    ? `${localIdentity.short_node_id}...`
                    : "Waiting for node id..."}
                </p>
              </div>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              Nearby peers may see this name and stable device identifier
              through enabled discovery methods. Discovery does not establish
              trust. Offers expire after one minute if the receiver does not
              respond.
            </p>
          </div>
        </div>
      </section>

      <section className="glass-panel p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Nearby devices</p>
            <p className="meta-copy mt-1">
              All discovered peers, regardless of whether they have an active
              share.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ScanSearch className="h-4 w-4 text-sky-200/80" />
            {localDiscoveryEnabled && bluetoothDiscoveryEnabled
              ? "Local network and Bluetooth discovery enabled"
              : localDiscoveryEnabled
                ? "Local network discovery enabled"
                : bluetoothDiscoveryEnabled
                  ? "Bluetooth discovery enabled"
                  : "Turn on nearby discovery in Settings"}
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {!discoveryEnabled ? (
            <EmptyState
              icon={ScanSearch}
              title="Nearby discovery is off"
              copy={
                bluetoothDiscoverySupported
                  ? "Enable local network or Bluetooth discovery in Settings to find devices automatically."
                  : "Enable local network discovery in Settings to find devices automatically."
              }
            />
          ) : devices.length === 0 ? (
            networkLikelyBlocked ? (
              <EmptyState
                icon={WifiOff}
                title="This network may be blocking multicast"
                copy="Lightning P2P uses multicast for instant nearby discovery, and some hotel, guest, and enterprise Wi-Fi networks silently drop those packets. The app is healthy — you just haven't seen a peer."
                action={
                  <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-300/5 px-3 py-1.5 text-xs text-amber-100/90">
                    <QrCode className="h-3.5 w-3.5" />
                    Use Send to generate a QR or paste-ticket instead.
                  </div>
                }
              />
            ) : nearbyDiscoveryStatus === "lan_unavailable" ? (
              <EmptyState
                icon={WifiOff}
                title="Local discovery is not active"
                copy="Lightning has not started local network discovery yet. Check Settings or use Send to create a QR code or receive link while it reconnects."
              />
            ) : (
              <EmptyState
                icon={Radar}
                title="Looking for nearby devices..."
                copy={
                  bluetoothDiscoveryEnabled && !localDiscoveryEnabled
                    ? "Open Lightning on another supported device with Bluetooth discovery enabled. Discovery can be affected by permissions, radio state, and the environment."
                    : "Open Lightning on another device with a compatible discovery method enabled. Devices appear when discovery can reach them; a nearby result is not proof of identity or trust."
                }
              />
            )
          ) : (
            devices.map((device) => (
              <div key={device.node_id} className="space-y-2">
                <DeviceCard
                  device={device}
                  busy={busyNodeId === device.node_id}
                  disabled={!nativeRuntime || isPreparingSelection || isSharing}
                  onSend={(target) => void handleSend(target)}
                />
                {pairedDevices.some(
                  (saved) => saved.node_id === device.node_id,
                ) ? (
                  <p className="px-4 text-xs font-medium text-blue-200">
                    Verified device
                  </p>
                ) : (
                  <>
                    {pairedDevices.some(
                      (saved) => saved.name === device.device_name,
                    ) ? (
                      <p className="px-4 text-xs text-amber-200">
                        This name now appears with a different cryptographic
                        identity. Verify it again before trusting.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      className="ml-4 rounded-full border border-white/10 px-3 py-1.5 text-xs font-medium text-slate-200 hover:border-blue-300/40 hover:text-white"
                      onClick={() => void beginPairing(device)}
                    >
                      Verify as my device
                    </button>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="glass-panel p-5" aria-labelledby="my-devices-title">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="page-eyebrow">Your devices</p>
            <h2
              id="my-devices-title"
              className="mt-1 text-lg font-semibold text-[var(--fg-primary)]"
            >
              My Devices
            </h2>
          </div>
          <span className="chrome-pill">{pairedDevices.length} verified</span>
        </div>
        <p className="meta-copy mt-2">
          Saved identities make familiar devices easy to recognize. Incoming
          offers ask for your approval unless you open a short Ready to Catch
          session for one verified device.
        </p>
        {readySession ? (
          <ReadyToCatchNotice
            deviceName={
              pairedDevices.find(
                (device) => device.node_id === readySession.nodeId,
              )?.name ?? "verified device"
            }
            expiresAtMs={readySession.expiresAtMs}
            onCancel={() => void toggleReadyToCatch(readySession.nodeId)}
            onExpire={expireReadySession}
          />
        ) : null}
        {pairedDevices.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-4 text-sm leading-6 text-[var(--fg-secondary)]">
            Verify a nearby device to add it here. Compare the verification code
            on both devices in person.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {pairedDevices.map((device) => (
              <li
                key={device.node_id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3"
              >
                {renamingNodeId === device.node_id ? (
                  <form
                    className="flex min-w-0 flex-1 gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveRename(device.node_id);
                    }}
                  >
                    <input
                      autoFocus
                      value={renamingValue}
                      onChange={(event) => setRenamingValue(event.target.value)}
                      maxLength={64}
                      aria-label="Device name"
                      className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-2 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                    />
                    <button
                      className="min-h-11 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                      type="submit"
                    >
                      Save
                    </button>
                    <button
                      className="min-h-11 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                      type="button"
                      onClick={() => setRenamingNodeId(null)}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--fg-primary)]">
                        {safeDisplayText(device.name, "Saved device")}
                      </p>
                      <p className="mt-1 truncate font-mono text-xs text-[var(--fg-muted)]">
                        {device.node_id}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`min-h-11 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] ${readySession?.nodeId === device.node_id ? "border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-primary)]" : ""}`}
                      onClick={() => void toggleReadyToCatch(device.node_id)}
                    >
                      {readySession?.nodeId === device.node_id
                        ? "Cancel Catch"
                        : "Ready to Catch · 30s"}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-0)] px-3 py-2 text-sm font-medium text-[var(--fg-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
                      onClick={() => {
                        setRenamingNodeId(device.node_id);
                        setRenamingValue(
                          safeDisplayText(device.name, "Saved device"),
                        );
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm font-medium text-[var(--danger-copy)] hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger-copy)]"
                      onClick={() => void revokeDevice(device.node_id)}
                    >
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {pairingCandidate && pairingCode ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3 backdrop-blur-sm sm:p-4"
          role="presentation"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !savingPair) {
              setPairingCandidate(null);
              setPairingCode(null);
            }
          }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingPair) {
              setPairingCandidate(null);
              setPairingCode(null);
            }
          }}
        >
          <section
            tabIndex={-1}
            onKeyDown={handlePairingDialogKeyDown}
            role="dialog"
            aria-modal="true"
            aria-labelledby="pair-device-title"
            aria-describedby="pair-device-details"
            className="max-h-[min(90dvh,720px)] w-full max-w-md overflow-y-auto rounded-3xl border border-[var(--border-strong)] bg-[var(--surface-0)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.3)] sm:p-6"
          >
            <p className="page-eyebrow">Verify identity</p>
            <h2
              id="pair-device-title"
              className="mt-2 text-xl font-semibold text-[var(--fg-primary)]"
            >
              Is this your device?
            </h2>
            <p
              id="pair-device-details"
              className="mt-2 text-sm leading-6 text-[var(--fg-secondary)]"
            >
              On{" "}
              <strong>
                {safeDisplayText(pairingCandidate.device_name, "Nearby device")}
              </strong>
              , open Devices and verify this device too. Compare the code in
              person before saving.
            </p>
            <p className="my-5 rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-subtle)] py-4 text-center font-mono text-2xl font-semibold tracking-[0.18em] text-[var(--accent-primary)]">
              {pairingCode}
            </p>
            <label
              className="block text-sm font-medium text-[var(--fg-secondary)]"
              htmlFor="paired-device-name"
            >
              Name on this device
            </label>
            <input
              ref={pairingNameRef}
              autoFocus
              id="paired-device-name"
              value={pairingName}
              onChange={(event) => setPairingName(event.target.value)}
              maxLength={64}
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-3 py-2.5 text-sm text-[var(--fg-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)]"
            />
            <p className="mt-3 text-sm leading-5 text-[var(--fg-muted)]">
              The code is derived from both authenticated public device
              identities. A saved identity does not enable automatic receiving.
            </p>
            <label className="mt-4 flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-5 text-[var(--fg-primary)]">
              <input
                type="checkbox"
                checked={codesConfirmed}
                onChange={(event) => setCodesConfirmed(event.target.checked)}
                className="mt-1 accent-[var(--accent-primary)]"
              />
              <span>I compared both codes in person and they match.</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={savingPair}
                onClick={() => {
                  setPairingCandidate(null);
                  setPairingCode(null);
                }}
                className="min-h-11 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-1)] px-4 py-2.5 text-sm font-medium text-[var(--fg-primary)] transition hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] disabled:opacity-55"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  savingPair ||
                  !codesConfirmed ||
                  pairingName.trim().length === 0
                }
                onClick={() => void confirmPairing()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--accent-primary)] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[var(--accent-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-0)] disabled:opacity-55"
              >
                <Check className="h-4 w-4" />
                {savingPair ? "Saving…" : "Save verified device"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
