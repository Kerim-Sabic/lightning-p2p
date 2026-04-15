import { useShallow } from "zustand/react/shallow";
import {
  type UpdatePhase,
  useTransferStore,
  type TransferEntry,
} from "./transferStore";

function isActiveTransfer(transfer: TransferEntry): boolean {
  return transfer.status === "starting" || transfer.status === "running";
}

function compareTransferIdDescending(
  left: TransferEntry,
  right: TransferEntry,
): number {
  return right.transferId.localeCompare(left.transferId);
}

function latestTransfer(
  transfers: TransferEntry[],
  direction?: TransferEntry["direction"],
): TransferEntry | null {
  let latest: TransferEntry | null = null;

  for (const transfer of transfers) {
    if (direction && transfer.direction !== direction) {
      continue;
    }

    if (
      latest === null ||
      transfer.transferId.localeCompare(latest.transferId) > 0
    ) {
      latest = transfer;
    }
  }

  return latest;
}

export interface OverviewSnapshot {
  nodeStatus: ReturnType<typeof useTransferStore.getState>["nodeStatus"];
  downloadDir: string | null;
  updatePhase: UpdatePhase;
  activeTransferCount: number;
  combinedSpeedBps: number;
  latestTransfer: TransferEntry | null;
}

export function useOverviewSnapshot(): OverviewSnapshot {
  return useTransferStore(
    useShallow((state) => {
      const transfers = Object.values(state.transfers);
      let activeTransferCount = 0;
      let combinedSpeedBps = 0;

      for (const transfer of transfers) {
        if (isActiveTransfer(transfer)) {
          activeTransferCount += 1;
          combinedSpeedBps += transfer.speedBps;
        }
      }

      return {
        nodeStatus: state.nodeStatus,
        downloadDir: state.downloadDir,
        updatePhase: state.updateState.phase,
        activeTransferCount,
        combinedSpeedBps,
        latestTransfer: latestTransfer(transfers),
      };
    }),
  );
}

export function useNavigationSnapshot(): {
  nodeStatus: ReturnType<typeof useTransferStore.getState>["nodeStatus"];
  activeTransferCount: number;
  receiveTransferCount: number;
  updatePhase: UpdatePhase;
} {
  return useTransferStore(
    useShallow((state) => {
      const transfers = Object.values(state.transfers);
      let activeTransferCount = 0;
      let receiveTransferCount = 0;

      for (const transfer of transfers) {
        if (!isActiveTransfer(transfer)) {
          continue;
        }

        activeTransferCount += 1;
        if (transfer.direction === "receive") {
          receiveTransferCount += 1;
        }
      }

      return {
        nodeStatus: state.nodeStatus,
        activeTransferCount,
        receiveTransferCount,
        updatePhase: state.updateState.phase,
      };
    }),
  );
}

export function useLatestSendTransfer(): TransferEntry | null {
  return useTransferStore((state) =>
    latestTransfer(Object.values(state.transfers), "send"),
  );
}

export function useReceiveTransfers(): TransferEntry[] {
  return useTransferStore(
    useShallow((state) =>
      Object.values(state.transfers)
        .filter((transfer) => transfer.direction === "receive")
        .sort(compareTransferIdDescending),
    ),
  );
}
