export type AppErrorSource =
  | "structured"
  | "legacy_string"
  | "js_error"
  | "unknown";

export type AppErrorCategory =
  | "ticket"
  | "network"
  | "relay"
  | "discovery"
  | "permission"
  | "storage"
  | "disk"
  | "verification"
  | "platform"
  | "cancellation"
  | "configuration"
  | "unknown";

export type AppErrorSeverity = "info" | "warning" | "error" | "critical";

export type AppErrorCode =
  | "invalid_ticket"
  | "sender_offline"
  | "connection_timeout"
  | "relay_unavailable"
  | "permission_denied"
  | "destination_unavailable"
  | "disk_full"
  | "verification_failed"
  | "export_failed"
  | "transfer_cancelled"
  | "android_content_uri_failed"
  | "malformed_receive_link"
  | "node_not_ready"
  | "nearby_share_unavailable"
  | "custom_relay_invalid"
  | "share_selection_invalid"
  | "unknown";

export interface BackendAppErrorPayload {
  schema_version: number;
  code: AppErrorCode;
  category: AppErrorCategory;
  severity: AppErrorSeverity;
  title: string;
  message: string;
  hint?: string | null;
  retryable: boolean;
  redacted_diagnostics?: string | null;
  docs_slug?: string | null;
}

export interface AppError {
  source: AppErrorSource;
  schemaVersion: 1;
  code: AppErrorCode;
  category: AppErrorCategory;
  severity: AppErrorSeverity;
  title: string;
  message: string;
  hint: string | null;
  retryable: boolean;
  redactedDiagnostics: string | null;
  docsSlug: string | null;
  helpUrl: string | null;
  legacyMessage: string | null;
}

const APP_ERROR_SCHEMA_VERSION = 1 as const;
const DOCS_BASE_URL =
  "https://github.com/Kerim-Sabic/lightning-p2p/blob/main/docs";

const APP_ERROR_CODES = [
  "invalid_ticket",
  "sender_offline",
  "connection_timeout",
  "relay_unavailable",
  "permission_denied",
  "destination_unavailable",
  "disk_full",
  "verification_failed",
  "export_failed",
  "transfer_cancelled",
  "android_content_uri_failed",
  "malformed_receive_link",
  "node_not_ready",
  "nearby_share_unavailable",
  "custom_relay_invalid",
  "share_selection_invalid",
  "unknown",
] as const satisfies readonly AppErrorCode[];

const APP_ERROR_CATEGORIES = [
  "ticket",
  "network",
  "relay",
  "discovery",
  "permission",
  "storage",
  "disk",
  "verification",
  "platform",
  "cancellation",
  "configuration",
  "unknown",
] as const satisfies readonly AppErrorCategory[];

const APP_ERROR_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const satisfies readonly AppErrorSeverity[];

type ErrorDefaults = Omit<
  AppError,
  | "source"
  | "schemaVersion"
  | "code"
  | "redactedDiagnostics"
  | "docsSlug"
  | "helpUrl"
  | "legacyMessage"
>;

const DEFAULTS: Record<AppErrorCode, ErrorDefaults> = {
  invalid_ticket: {
    category: "ticket",
    severity: "error",
    title: "Invalid receive ticket",
    message: "This receive link or ticket could not be read.",
    hint: "Ask the sender for a fresh link, or scan the QR code again.",
    retryable: false,
  },
  sender_offline: {
    category: "network",
    severity: "error",
    title: "Sender is not reachable",
    message: "Lightning P2P could not reach the sender for this transfer.",
    hint: "Keep both apps open, confirm the sender still has the share active, then retry.",
    retryable: true,
  },
  connection_timeout: {
    category: "network",
    severity: "error",
    title: "Connection timed out",
    message: "The transfer stalled before it could complete.",
    hint: "Retry with both devices awake. If it repeats, check firewall, VPN, or relay settings.",
    retryable: true,
  },
  relay_unavailable: {
    category: "relay",
    severity: "warning",
    title: "Route is not ready",
    message: "Relay or direct routing is not ready yet.",
    hint: "Keep the app open while direct addresses and relay fallback warm up.",
    retryable: true,
  },
  permission_denied: {
    category: "permission",
    severity: "error",
    title: "Permission denied",
    message: "Lightning P2P does not have permission for this action.",
    hint: "Grant access in the operating system prompt or choose a different file or folder.",
    retryable: true,
  },
  destination_unavailable: {
    category: "storage",
    severity: "error",
    title: "Save location is unavailable",
    message: "The configured receive folder cannot be used.",
    hint: "Choose a writable receive folder in Settings, then retry.",
    retryable: true,
  },
  disk_full: {
    category: "disk",
    severity: "error",
    title: "Not enough free space",
    message:
      "The receive folder does not have enough free disk space for this transfer.",
    hint: "Free space on the destination drive, then retry.",
    retryable: true,
  },
  verification_failed: {
    category: "verification",
    severity: "critical",
    title: "Verification failed",
    message: "The received data did not pass integrity verification.",
    hint: "Do not use the partial output. Ask the sender to send it again.",
    retryable: false,
  },
  export_failed: {
    category: "storage",
    severity: "error",
    title: "Could not save verified files",
    message: "The verified download could not be exported.",
    hint: "Check destination folder access and retry.",
    retryable: true,
  },
  transfer_cancelled: {
    category: "cancellation",
    severity: "info",
    title: "Transfer cancelled",
    message: "The transfer was cancelled before it completed.",
    hint: "Start the transfer again when both devices are ready.",
    retryable: true,
  },
  android_content_uri_failed: {
    category: "platform",
    severity: "error",
    title: "Android file access failed",
    message: "Android could not stage the selected file for transfer.",
    hint: "Try the system file picker again, or copy the file into local device storage first.",
    retryable: true,
  },
  malformed_receive_link: {
    category: "ticket",
    severity: "warning",
    title: "Receive link not recognized",
    message: "This does not look like a Lightning P2P receive link or ticket.",
    hint: "Paste the full receive link, scan the QR code again, or ask the sender for a fresh link.",
    retryable: false,
  },
  node_not_ready: {
    category: "configuration",
    severity: "info",
    title: "Node is still starting",
    message: "Lightning P2P is still bringing the transfer engine online.",
    hint: "Wait a moment, then try again.",
    retryable: true,
  },
  nearby_share_unavailable: {
    category: "discovery",
    severity: "warning",
    title: "Nearby share expired",
    message: "The nearby share is no longer available.",
    hint: "Refresh nearby shares or ask the sender for a receive link.",
    retryable: true,
  },
  custom_relay_invalid: {
    category: "configuration",
    severity: "error",
    title: "Relay setting is invalid",
    message: "The custom relay URL could not be used.",
    hint: "Check the relay URL and save it again.",
    retryable: true,
  },
  share_selection_invalid: {
    category: "storage",
    severity: "warning",
    title: "Share selection needs attention",
    message: "Lightning P2P could not prepare this selection.",
    hint: "Choose a readable file or folder and try again.",
    retryable: true,
  },
  unknown: {
    category: "unknown",
    severity: "error",
    title: "Something went wrong",
    message: "Lightning P2P hit an unexpected error.",
    hint: "Retry the action. If it repeats, copy diagnostics from Settings.",
    retryable: false,
  },
};

interface AppErrorOverrides {
  source?: AppErrorSource;
  title?: string;
  message?: string;
  hint?: string | null;
  category?: AppErrorCategory;
  severity?: AppErrorSeverity;
  retryable?: boolean;
  redactedDiagnostics?: string | null;
  docsSlug?: string | null;
  legacyMessage?: string | null;
}

export function appErrorFromCode(
  code: AppErrorCode,
  overrides: AppErrorOverrides = {},
): AppError {
  const defaults = DEFAULTS[code];
  const docsSlug = overrides.docsSlug ?? null;
  return {
    source: overrides.source ?? "structured",
    schemaVersion: APP_ERROR_SCHEMA_VERSION,
    code,
    category: overrides.category ?? defaults.category,
    severity: overrides.severity ?? defaults.severity,
    title: overrides.title ?? defaults.title,
    message: redactSensitiveText(overrides.message ?? defaults.message),
    hint:
      overrides.hint === undefined
        ? defaults.hint
        : overrides.hint
          ? redactSensitiveText(overrides.hint)
          : null,
    retryable: overrides.retryable ?? defaults.retryable,
    redactedDiagnostics: overrides.redactedDiagnostics
      ? redactSensitiveText(overrides.redactedDiagnostics)
      : null,
    docsSlug,
    helpUrl: docsSlug ? `${DOCS_BASE_URL}/${docsSlug}.md` : null,
    legacyMessage: overrides.legacyMessage
      ? redactSensitiveText(overrides.legacyMessage)
      : null,
  };
}

export function normalizeAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return {
      ...error,
      message: redactSensitiveText(error.message),
      hint: error.hint ? redactSensitiveText(error.hint) : null,
      legacyMessage: error.legacyMessage
        ? redactSensitiveText(error.legacyMessage)
        : null,
    };
  }

  const structured = parseBackendPayload(error);
  if (structured) {
    return structured;
  }

  if (typeof error === "string") {
    return appErrorFromLegacyString(error, "legacy_string");
  }

  if (error instanceof Error) {
    return appErrorFromLegacyString(error.message, "js_error");
  }

  return appErrorFromCode("unknown", {
    source: "unknown",
    legacyMessage: null,
  });
}

export function messageFromAppError(error: AppError): string {
  return error.message;
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/lightning-p2p:\/\/receive[^\s<>"']*/gi, "[redacted-receive-link]")
    .replace(/https?:\/\/[^\s<>"']*\/receive[#?][^\s<>"']*/gi, (value) =>
      containsTicketMarker(value) ? "[redacted-receive-link]" : value,
    )
    .replace(/([?&](?:t|ticket)=)[^&\s<>"']+/gi, "$1[redacted-ticket]")
    .replace(/\bfd2:[A-Za-z0-9_-]{24,}\b/g, "[redacted-ticket]")
    .replace(/\bblob[A-Za-z0-9]{24,}\b/g, "[redacted-ticket]");
}

function appErrorFromLegacyString(
  message: string,
  source: AppErrorSource,
): AppError {
  const redacted = redactSensitiveText(message);
  const normalized = redacted.toLowerCase();

  if (normalized.includes("invalid ticket")) {
    return appErrorFromCode("invalid_ticket", {
      source,
      legacyMessage: redacted,
    });
  }
  if (normalized.includes("node not initialized")) {
    return appErrorFromCode("node_not_ready", {
      source,
      legacyMessage: redacted,
    });
  }
  if (normalized.includes("nearby share is no longer available")) {
    return appErrorFromCode("nearby_share_unavailable", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("peer not reachable") ||
    normalized.includes("sender offline")
  ) {
    return appErrorFromCode("sender_offline", {
      source,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("transfer interrupted") ||
    normalized.includes("timed out")
  ) {
    return appErrorFromCode("connection_timeout", {
      source,
      legacyMessage: redacted,
    });
  }
  if (normalized.includes("relay") && normalized.includes("invalid")) {
    return appErrorFromCode("custom_relay_invalid", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("no peer route") ||
    normalized.includes("relay unavailable")
  ) {
    return appErrorFromCode("relay_unavailable", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (normalized.includes("not enough free disk space")) {
    return appErrorFromCode("disk_full", { source, legacyMessage: redacted });
  }
  if (
    normalized.includes("permission denied") ||
    normalized.includes("access denied")
  ) {
    return appErrorFromCode("permission_denied", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("download folder") ||
    normalized.includes("download destination") ||
    normalized.includes("not writable")
  ) {
    return appErrorFromCode("destination_unavailable", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (normalized.includes("cancelled") || normalized.includes("canceled")) {
    return appErrorFromCode("transfer_cancelled", {
      source,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("content://") ||
    normalized.includes("system picker")
  ) {
    return appErrorFromCode("android_content_uri_failed", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("verification") ||
    normalized.includes("hash mismatch")
  ) {
    return appErrorFromCode("verification_failed", {
      source,
      legacyMessage: redacted,
    });
  }
  if (
    normalized.includes("no files selected") ||
    normalized.includes("empty directory") ||
    normalized.includes("duplicate share path")
  ) {
    return appErrorFromCode("share_selection_invalid", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  if (normalized.includes("export")) {
    return appErrorFromCode("export_failed", {
      source,
      message: redacted,
      legacyMessage: redacted,
    });
  }
  return appErrorFromCode("unknown", {
    source,
    message: redacted || DEFAULTS.unknown.message,
    legacyMessage: redacted || null,
  });
}

function parseBackendPayload(value: unknown): AppError | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = stringField(value, "code");
  const category = stringField(value, "category");
  const severity = stringField(value, "severity");
  const title = stringField(value, "title");
  const message = stringField(value, "message");
  const retryable = booleanField(value, "retryable");

  if (
    !isAppErrorCode(code) ||
    !isAppErrorCategory(category) ||
    !isAppErrorSeverity(severity) ||
    !title ||
    !message ||
    retryable === null
  ) {
    return null;
  }

  const docsSlug = nullableStringField(value, "docs_slug");
  const redactedDiagnostics = nullableStringField(
    value,
    "redacted_diagnostics",
  );

  return appErrorFromCode(code, {
    source: "structured",
    category,
    severity,
    title,
    message,
    hint: nullableStringField(value, "hint"),
    retryable,
    redactedDiagnostics,
    docsSlug,
    legacyMessage: null,
  });
}

function isAppError(value: unknown): value is AppError {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === APP_ERROR_SCHEMA_VERSION &&
    isAppErrorCode(value.code) &&
    isAppErrorCategory(value.category) &&
    isAppErrorSeverity(value.severity) &&
    typeof value.title === "string" &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function nullableStringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function booleanField(
  record: Record<string, unknown>,
  key: string,
): boolean | null {
  const value = record[key];
  return typeof value === "boolean" ? value : null;
}

function isAppErrorCode(value: unknown): value is AppErrorCode {
  return (
    typeof value === "string" && APP_ERROR_CODES.includes(value as AppErrorCode)
  );
}

function isAppErrorCategory(value: unknown): value is AppErrorCategory {
  return (
    typeof value === "string" &&
    APP_ERROR_CATEGORIES.includes(value as AppErrorCategory)
  );
}

function isAppErrorSeverity(value: unknown): value is AppErrorSeverity {
  return (
    typeof value === "string" &&
    APP_ERROR_SEVERITIES.includes(value as AppErrorSeverity)
  );
}

function containsTicketMarker(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("fd2:") ||
    normalized.includes("blob") ||
    normalized.includes("#t=") ||
    normalized.includes("?t=") ||
    normalized.includes("&t=") ||
    normalized.includes("?ticket=") ||
    normalized.includes("&ticket=")
  );
}
