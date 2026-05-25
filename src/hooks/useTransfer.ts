import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent } from "react";
import {
  desktopRuntimeMessage,
  isMobileRuntime,
  onDiscoveredSharesUpdated,
  onIncomingOffer,
  onNearbyDevicesUpdated,
  onNearbyDiagnosticState,
  onNodeSupervisorStatus,
  onOfferResolved,
  onTransferProgress,
  recordFrontendDiagnostic,
  startBleDiscovery,
  type NodeOnlineState,
  type TransferEvent,
} from "../lib/tauri";
import { useIncomingOfferStore } from "../stores/incomingOfferStore";
import { useNearbyDeviceStore } from "../stores/nearbyDeviceStore";
import { useNearbyDiagnosticStore } from "../stores/nearbyDiagnosticStore";
import { useNearbyShareStore } from "../stores/nearbyShareStore";
import { useTransferStore } from "../stores/transferStore";

const FAST_NODE_STATUS_POLL_MS = 2500;
const STABLE_NODE_STATUS_POLL_MS = 12000;
const RELAY_NODE_STATUS_POLL_MS = 7000;
const HIDDEN_NODE_STATUS_POLL_MS = 30000;

function nextNodeStatusPollMs(onlineState: NodeOnlineState): number {
  switch (onlineState) {
    case "direct_ready":
      return STABLE_NODE_STATUS_POLL_MS;
    case "relay_ready":
      return RELAY_NODE_STATUS_POLL_MS;
    case "degraded":
    case "offline":
    case "starting":
    default:
      return FAST_NODE_STATUS_POLL_MS;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useTransfer(): void {
  const setError = useTransferStore((state) => state.setError);
  const inTauriRuntime = isTauri();
  const hydrateApp = useEffectEvent(async () => {
    const store = useTransferStore.getState();

    const runHydrationStep = async (
      name: string,
      action: () => Promise<void>,
    ): Promise<void> => {
      recordFrontendDiagnostic(`hydrate:${name}:start`);
      try {
        await action();
        recordFrontendDiagnostic(`hydrate:${name}:ok`);
      } catch (error) {
        const message = errorMessage(error);
        recordFrontendDiagnostic(`hydrate:${name}:failed:${message}`);
        store.setError(message);
      }
    };

    recordFrontendDiagnostic("hydrate:start");
    await Promise.all([
      runHydrationStep("platform-profile", store.refreshPlatformProfile),
      runHydrationStep("node-status", store.refreshNodeStatus),
      runHydrationStep(
        "node-supervisor-status",
        store.refreshNodeSupervisorStatus,
      ),
      runHydrationStep("ble-status", store.refreshBleDiscoveryStatus),
      runHydrationStep("settings", store.refreshSettings),
      runHydrationStep("active-transfers", store.refreshActiveTransfers),
      runHydrationStep("history", store.refreshHistory),
      runHydrationStep("nearby-shares", () =>
        useNearbyShareStore.getState().refreshShares(),
      ),
      runHydrationStep("nearby-devices", () =>
        useNearbyDeviceStore.getState().refreshDevices(),
      ),
    ]);
    recordFrontendDiagnostic("hydrate:complete");

    const settings = useTransferStore.getState().settings;
    if (settings?.auto_update_enabled && !isMobileRuntime()) {
      await useTransferStore.getState().checkForUpdates(true);
    }
    const latest = useTransferStore.getState();
    if (
      latest.settings?.bluetooth_discovery_enabled &&
      latest.platformProfile.capabilities.bluetooth_discovery &&
      latest.nodeStatus.node_id
    ) {
      const started = await startBleDiscovery(latest.nodeStatus.node_id);
      recordFrontendDiagnostic(
        `hydrate:ble-autostart:${started ? "ok" : "not-started"}`,
      );
      await latest.refreshBleDiscoveryStatus();
    }
  });

  const handleTransferEvent = useEffectEvent((event: TransferEvent) => {
    const store = useTransferStore.getState();
    store.applyTransferEvent(event);

    if (event.type === "completed" || event.type === "failed") {
      void store.refreshActiveTransfers();
    }
    if (event.type === "completed") {
      void store.refreshHistory();
    }
  });

  const handleSubscriptionError = useEffectEvent((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to subscribe to transfers";
    setError(message);
  });

  useEffect(() => {
    if (!inTauriRuntime) {
      setError(desktopRuntimeMessage("Browser preview"));
      useNearbyShareStore.getState().clearShares();
      return;
    }

    void hydrateApp();
  }, [hydrateApp, inTauriRuntime, setError]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let timeoutId: number | null = null;
    let disposed = false;

    const clearScheduledPoll = (): void => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const schedulePoll = (delayMs: number): void => {
      if (disposed) {
        return;
      }

      clearScheduledPoll();
      timeoutId = window.setTimeout(() => {
        void pollNodeStatus();
      }, delayMs);
    };

    const pollNodeStatus = async (): Promise<void> => {
      if (document.hidden) {
        schedulePoll(HIDDEN_NODE_STATUS_POLL_MS);
        return;
      }

      await useTransferStore.getState().refreshNodeStatus();
      const onlineState = useTransferStore.getState().nodeStatus.online_state;
      schedulePoll(nextNodeStatusPollMs(onlineState));
    };

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        schedulePoll(HIDDEN_NODE_STATUS_POLL_MS);
        return;
      }

      void pollNodeStatus();
    };

    schedulePoll(
      nextNodeStatusPollMs(useTransferStore.getState().nodeStatus.online_state),
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      disposed = true;
      clearScheduledPoll();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onTransferProgress(handleTransferEvent)
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, handleTransferEvent, inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onNodeSupervisorStatus((status) => {
      useTransferStore.getState().applyNodeSupervisorStatus(status);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onDiscoveredSharesUpdated((shares) => {
      useNearbyShareStore.getState().applySharesUpdated(shares);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onNearbyDevicesUpdated((devices) => {
      useNearbyDeviceStore.getState().applyDevicesUpdated(devices);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onNearbyDiagnosticState((state) => {
      useNearbyDiagnosticStore.getState().applyState(state);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onIncomingOffer((offer) => {
      useIncomingOfferStore.getState().pushIncoming(offer);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, inTauriRuntime]);

  useEffect(() => {
    if (!inTauriRuntime) {
      return;
    }

    let unlisten: (() => void) | null = null;

    void onOfferResolved((resolved) => {
      useIncomingOfferStore.getState().applyOfferResolved(resolved);
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(handleSubscriptionError);

    return () => {
      unlisten?.();
    };
  }, [handleSubscriptionError, inTauriRuntime]);
}
