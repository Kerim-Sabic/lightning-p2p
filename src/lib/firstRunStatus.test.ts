import { describe, expect, it } from "vitest";
import {
  canRetryNodeStartup,
  engineStatusPresentation,
  routeStatusPresentation,
} from "./firstRunStatus";
import type { NodeStatus, NodeSupervisorStatus } from "./tauri";

function supervisorStatus(
  phase: NodeSupervisorStatus["phase"],
  last_error: string | null = null,
): NodeSupervisorStatus {
  return {
    phase,
    last_error,
    last_reason: "app_startup",
    last_changed_unix: 0,
  };
}

function nodeStatus(online_state: NodeStatus["online_state"]): NodeStatus {
  return {
    online: online_state !== "offline" && online_state !== "starting",
    node_id: null,
    relay_connected: online_state === "relay_ready",
    relay_url: null,
    direct_address_count: online_state === "direct_ready" ? 1 : 0,
    lan_discovery_active: false,
    online_state,
  };
}

describe("first-run engine and route status", () => {
  it("shows a ready engine separately from routes that are still warming", () => {
    expect(engineStatusPresentation(supervisorStatus("idle")).label).toBe(
      "Ready",
    );
    expect(routeStatusPresentation(nodeStatus("starting")).label).toBe(
      "Checking routes",
    );
  });

  it("surfaces long-start warnings and failed startup messages", () => {
    expect(
      engineStatusPresentation(
        supervisorStatus("starting", "Storage is taking longer to open."),
      ),
    ).toMatchObject({ label: "Taking longer", tone: "attention" });
    expect(
      engineStatusPresentation(
        supervisorStatus("failed", "Could not open transfer storage."),
      ),
    ).toMatchObject({
      label: "Needs attention",
      copy: "Could not open transfer storage.",
      tone: "attention",
    });
  });

  it("does not offer an in-process retry when a full app restart is required", () => {
    expect(
      canRetryNodeStartup(
        supervisorStatus(
          "failed",
          "Close and reopen Lightning to release pending storage initialization.",
        ),
      ),
    ).toBe(false);
    expect(
      canRetryNodeStartup(
        supervisorStatus("failed", "Another app window has the data folder."),
      ),
    ).toBe(true);
    expect(canRetryNodeStartup(supervisorStatus("starting"))).toBe(false);
  });

  it("does not describe a transfer-gated restart as a failed startup", () => {
    expect(
      engineStatusPresentation(
        supervisorStatus(
          "blocked_active_transfers",
          "A connection update is queued until current transfers finish.",
        ),
      ),
    ).toMatchObject({
      label: "Finishing a transfer",
      tone: "working",
    });
  });

  it("describes direct and relay routes without implying server storage", () => {
    expect(routeStatusPresentation(nodeStatus("direct_ready")).tone).toBe(
      "ready",
    );
    expect(routeStatusPresentation(nodeStatus("relay_ready")).copy).toContain(
      "encrypted relay",
    );
  });
});
