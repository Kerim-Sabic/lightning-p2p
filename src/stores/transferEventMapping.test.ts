import { describe, expect, it } from "vitest";
import type { BackendAppErrorPayload } from "../lib/appErrors";
import { mergeFailedTransferEvent, type FailedTransferEvent } from "./transferEventMapping";

describe("mergeFailedTransferEvent", () => {
  it("keeps legacy failed events compatible", () => {
    const event: FailedTransferEvent = {
      type: "failed",
      transfer_id: "rx-legacy",
      error: "Not enough free disk space",
      route_kind: "unknown",
    };

    const entry = mergeFailedTransferEvent(undefined, event);

    expect(entry.transferId).toBe("rx-legacy");
    expect(entry.status).toBe("failed");
    expect(entry.failureCategory).toBe("unknown");
    expect(entry.error).toBe("The receive folder does not have enough free disk space for this transfer.");
    expect(entry.appError?.source).toBe("legacy_string");
    expect(entry.appError?.code).toBe("disk_full");
  });

  it("prefers structured error payloads when present", () => {
    const payload: BackendAppErrorPayload = {
      schema_version: 1,
      code: "sender_offline",
      category: "network",
      severity: "error",
      title: "Sender is not reachable",
      message: "Lightning P2P could not reach the sender for this transfer.",
      hint: "Keep both apps open, confirm the sender still has the share active, then retry.",
      retryable: true,
      redacted_diagnostics: "phase=connecting route=relay",
      docs_slug: "sender-online",
    };
    const event: FailedTransferEvent = {
      type: "failed",
      transfer_id: "rx-structured",
      error: "Peer not reachable",
      route_kind: "relay",
      phase: "connecting",
      failure_category: "unreachable",
      error_payload: payload,
    };

    const entry = mergeFailedTransferEvent(undefined, event);

    expect(entry.routeKind).toBe("relay");
    expect(entry.phase).toBe("connecting");
    expect(entry.failureCategory).toBe("unreachable");
    expect(entry.error).toBe(payload.message);
    expect(entry.appError?.source).toBe("structured");
    expect(entry.appError?.code).toBe("sender_offline");
    expect(entry.appError?.redactedDiagnostics).toBe("phase=connecting route=relay");
  });
});
