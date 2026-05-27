import { messageFromAppError, normalizeAppError } from "../lib/appErrors";
import type { TransferEvent } from "../lib/tauri";
import type { TransferEntry } from "./transferStore";

export type FailedTransferEvent = Extract<TransferEvent, { type: "failed" }>;

function createFailedTransferEntry(event: FailedTransferEvent): TransferEntry {
  return {
    transferId: event.transfer_id,
    direction: "receive",
    name: event.transfer_id,
    peer: null,
    bytes: 0,
    total: 0,
    speedBps: 0,
    routeKind: event.route_kind,
    phase: event.phase ?? "failed",
    failureCategory: event.failure_category ?? "unknown",
    outputPath: null,
    connectMs: 0,
    downloadMs: 0,
    exportMs: 0,
    providerCount: 0,
    directProviderCount: 0,
    relayProviderCount: 0,
    strategy: "unknown",
    firstByteMs: 0,
    effectiveMbps: 0,
    status: "failed",
    hash: null,
    size: null,
    timestamp: null,
    error: null,
    appError: null,
    retryTicket: null,
  };
}

export function mergeFailedTransferEvent(
  current: TransferEntry | undefined,
  event: FailedTransferEvent,
): TransferEntry {
  const appError = normalizeAppError(event.error_payload ?? event.error);
  return {
    ...(current ?? createFailedTransferEntry(event)),
    routeKind: event.route_kind,
    phase: event.phase ?? "failed",
    failureCategory: event.failure_category ?? "unknown",
    status: "failed",
    error: messageFromAppError(appError),
    appError,
  };
}
