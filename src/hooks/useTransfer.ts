import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useEffectEvent } from "react";
import {
  desktopRuntimeMessage,
  onDiscoveredSharesUpdated,
  onTransferProgress,
  type NodeOnlineState,
  type TransferEvent,
} from "../lib/tauri";
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

export function useTransfer(): void {
  const setError = useTransferStore((state) => state.setError);
  const inTauriRuntime = isTauri();
  const hydrateApp = useEffectEvent(async () => {
    const store = useTransferStore.getState();

    await Promise.all([
      store.refreshNodeStatus(),
      store.refreshSettings(),
      store.refreshActiveTransfers(),
      store.refreshHistory(),
      useNearbyShareStore.getState().refreshShares(),
    ]);

    const settings = useTransferStore.getState().settings;
    if (settings?.auto_update_enabled) {
      await useTransferStore.getState().checkForUpdates(true);
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
}
