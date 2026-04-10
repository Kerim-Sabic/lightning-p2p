import { useEffect } from "react";
import { onTransferProgress } from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";

const NODE_STATUS_POLL_MS = 5000;

export function useTransfer(): void {
  const refreshNodeStatus = useTransferStore(
    (state) => state.refreshNodeStatus,
  );
  const refreshSettings = useTransferStore((state) => state.refreshSettings);
  const refreshActiveTransfers = useTransferStore(
    (state) => state.refreshActiveTransfers,
  );
  const refreshHistory = useTransferStore((state) => state.refreshHistory);
  const checkForUpdates = useTransferStore((state) => state.checkForUpdates);
  const setError = useTransferStore((state) => state.setError);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        refreshNodeStatus(),
        refreshSettings(),
        refreshActiveTransfers(),
        refreshHistory(),
      ]);

      const settings = useTransferStore.getState().settings;
      if (settings?.auto_update_enabled) {
        await checkForUpdates(true);
      }
    })();

    const intervalId = window.setInterval(() => {
      void refreshNodeStatus();
    }, NODE_STATUS_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    refreshActiveTransfers,
    refreshHistory,
    refreshNodeStatus,
    refreshSettings,
    checkForUpdates,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    void onTransferProgress((event) => {
      const store = useTransferStore.getState();
      store.applyTransferEvent(event);

      if (event.type === "completed" || event.type === "failed") {
        void store.refreshActiveTransfers();
      }
      if (event.type === "completed") {
        void store.refreshHistory();
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to subscribe to transfers";
        setError(message);
      });

    return () => {
      unlisten?.();
    };
  }, [setError]);
}
