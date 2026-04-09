import { useEffect } from "react";
import { onTransferProgress } from "../lib/tauri";
import { useTransferStore } from "../stores/transferStore";

const NODE_STATUS_POLL_MS = 5000;

export function useTransfer(): void {
  const refreshNodeStatus = useTransferStore((state) => state.refreshNodeStatus);
  const refreshDownloadDir = useTransferStore((state) => state.refreshDownloadDir);
  const refreshActiveTransfers = useTransferStore(
    (state) => state.refreshActiveTransfers,
  );
  const refreshHistory = useTransferStore((state) => state.refreshHistory);
  const setError = useTransferStore((state) => state.setError);

  useEffect(() => {
    void refreshNodeStatus();
    void refreshDownloadDir();
    void refreshActiveTransfers();
    void refreshHistory();

    const intervalId = window.setInterval(() => {
      void refreshNodeStatus();
    }, NODE_STATUS_POLL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    refreshActiveTransfers,
    refreshDownloadDir,
    refreshHistory,
    refreshNodeStatus,
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
          error instanceof Error ? error.message : "Failed to subscribe to transfers";
        setError(message);
      });

    return () => {
      unlisten?.();
    };
  }, [setError]);
}
