import type { NodeStatus, NodeSupervisorStatus } from "./tauri";

export type StatusTone = "ready" | "working" | "attention";

export interface StatusPresentation {
  label: string;
  copy: string;
  tone: StatusTone;
}

export function canRetryNodeStartup(status: NodeSupervisorStatus): boolean {
  return (
    status.phase === "failed" &&
    !status.last_error?.toLowerCase().includes("close and reopen lightning")
  );
}

export function engineStatusPresentation(
  status: NodeSupervisorStatus,
): StatusPresentation {
  if (
    status.last_error &&
    (status.phase === "starting" ||
      status.phase === "restarting" ||
      status.phase === "failed")
  ) {
    return {
      label: status.phase === "failed" ? "Needs attention" : "Taking longer",
      copy: status.last_error,
      tone: "attention",
    };
  }

  switch (status.phase) {
    case "idle":
      return {
        label: "Ready",
        copy: "The transfer engine is ready. Connection routes are shown separately.",
        tone: "ready",
      };
    case "starting":
      return {
        label: "Starting",
        copy: "Preparing local transfer storage and opening the secure endpoint.",
        tone: "working",
      };
    case "restarting":
      return {
        label: "Reconnecting",
        copy: "Applying a connection setting and reopening the endpoint.",
        tone: "working",
      };
    case "blocked_active_transfers":
      return {
        label: "Finishing a transfer",
        copy:
          status.last_error ??
          "A connection update will apply after current transfer work finishes.",
        tone: "working",
      };
    case "failed":
      return {
        label: "Needs attention",
        copy: "The transfer engine could not start. Retry or review its status in Settings.",
        tone: "attention",
      };
  }
}

export function routeStatusPresentation(
  status: NodeStatus,
): StatusPresentation {
  switch (status.online_state) {
    case "direct_ready":
      return {
        label: "Direct route ready",
        copy: "A direct network route is available for peer transfers.",
        tone: "ready",
      };
    case "relay_ready":
      return {
        label: "Relay route ready",
        copy: "Transfers can connect through an encrypted relay while direct routes warm up.",
        tone: "ready",
      };
    case "degraded":
      return {
        label: "No route yet",
        copy: "The engine is running, but no direct or relay route is ready. You can continue setup while Lightning keeps checking.",
        tone: "attention",
      };
    case "offline":
      return {
        label: "Unavailable",
        copy: "Connection routes will be checked after the transfer engine starts.",
        tone: "attention",
      };
    case "starting":
      return {
        label: "Checking routes",
        copy: "Direct and relay reachability are checked separately from engine startup.",
        tone: "working",
      };
  }
}
