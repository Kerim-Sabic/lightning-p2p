import { describe, expect, it } from "vitest";
import {
  appErrorFromCode,
  normalizeAppError,
  redactSensitiveText,
  type BackendAppErrorPayload,
} from "./appErrors";

describe("normalizeAppError", () => {
  it("parses structured backend payloads", () => {
    const payload: BackendAppErrorPayload = {
      schema_version: 1,
      code: "sender_offline",
      category: "network",
      severity: "error",
      title: "Sender is not reachable",
      message: "Could not reach the sender.",
      hint: "Keep both apps open.",
      retryable: true,
      redacted_diagnostics: "phase=connecting route=relay",
      docs_slug: "sender-online",
    };

    const error = normalizeAppError(payload);

    expect(error.source).toBe("structured");
    expect(error.code).toBe("sender_offline");
    expect(error.category).toBe("network");
    expect(error.retryable).toBe(true);
    expect(error.helpUrl).toContain("sender-online.md");
  });

  it("redacts structured payload messages, hints, and diagnostics", () => {
    const ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
    const payload: BackendAppErrorPayload = {
      schema_version: 1,
      code: "connection_timeout",
      category: "network",
      severity: "error",
      title: "Connection timed out",
      message: `Timed out for ${ticket}`,
      hint: `Ask for https://lightning-p2p.netlify.app/receive#t=${ticket}`,
      retryable: true,
      redacted_diagnostics: `phase=connecting ticket=${ticket}`,
      docs_slug: "network-troubleshooting",
    };

    const error = normalizeAppError(payload);

    expect(error.message).not.toContain(ticket);
    expect(error.hint).not.toContain(ticket);
    expect(error.redactedDiagnostics).not.toContain(ticket);
    expect(error.hint).toContain("[redacted-receive-link]");
  });

  it("maps legacy strings to stable codes", () => {
    const error = normalizeAppError("Peer not reachable");

    expect(error.source).toBe("legacy_string");
    expect(error.code).toBe("sender_offline");
    expect(error.message).not.toContain("Peer not reachable");
  });

  it("handles JavaScript Error instances", () => {
    const error = normalizeAppError(new Error("Permission denied"));

    expect(error.source).toBe("js_error");
    expect(error.code).toBe("permission_denied");
  });

  it("redacts legacy Error messages before storing them", () => {
    const ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
    const error = normalizeAppError(
      new Error(`Invalid ticket ${ticket} from /receive#t=${ticket}`),
    );

    expect(error.code).toBe("invalid_ticket");
    expect(error.legacyMessage).not.toContain(ticket);
    expect(error.legacyMessage).toContain("[redacted-ticket]");
  });

  it("preserves a safe unknown fallback", () => {
    const error = normalizeAppError({ unexpected: true });

    expect(error.source).toBe("unknown");
    expect(error.code).toBe("unknown");
    expect(error.message).toBe("Lightning P2P hit an unexpected error.");
  });

  it("normalizes already parsed app errors", () => {
    const error = normalizeAppError(appErrorFromCode("malformed_receive_link"));

    expect(error.code).toBe("malformed_receive_link");
    expect(error.hint).toContain("Paste the full receive link");
  });
});

describe("redactSensitiveText", () => {
  it("redacts tickets and receive links", () => {
    const text =
      "Use https://lightning-p2p.netlify.app/receive#t=fd2:abcdefghijklmnopqrstuvwxyzABCDEF or blobabc123abc123abc123abc123abc";

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain("fd2:abcdefghijklmnopqrstuvwxyzABCDEF");
    expect(redacted).not.toContain("blobabc123abc123abc123abc123abc");
    expect(redacted).toContain("[redacted-receive-link]");
    expect(redacted).toContain("[redacted-ticket]");
  });

  it("redacts query ticket parameters and deep links", () => {
    const ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
    const text = [
      `lightning-p2p://receive?t=${ticket}`,
      `https://lightning-p2p.netlify.app/receive?ticket=${ticket}`,
      `https://example.test/path?t=${ticket}`,
    ].join(" ");

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain(ticket);
    expect(redacted).toContain("[redacted-receive-link]");
    expect(redacted).toContain("t=[redacted-ticket]");
  });

  it("redacts tickets separated by unicode whitespace", () => {
    const nbsp = " ";
    const text = `first fd2:abcdefghijklmnopqrstuvwxyzABCDEF${nbsp}second blobabc123abc123abc123abc123abc`;

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain("fd2:abcdefghijklmnopqrstuvwxyzABCDEF");
    expect(redacted).not.toContain("blobabc123abc123abc123abc123abc");
    expect((redacted.match(/\[redacted-ticket\]/g) ?? []).length).toBe(2);
  });

  it("redacts tickets surrounded by punctuation", () => {
    const ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
    const text = `see (${ticket}) then ${ticket}. and ${ticket}! plus ${ticket},`;

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain(ticket);
    expect((redacted.match(/\[redacted-ticket\]/g) ?? []).length).toBe(4);
  });

  it("redacts mixed legacy and fd2 tickets in one line", () => {
    const fd2 = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
    const legacy = "blobabc123abc123abc123abc123abc";
    const text = `share emitted ${fd2} then ${legacy} during retry`;

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain(fd2);
    expect(redacted).not.toContain(legacy);
    expect((redacted.match(/\[redacted-ticket\]/g) ?? []).length).toBe(2);
  });

  it("redacts deep links with the fragment ticket form", () => {
    const ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";
    const text = `share opened lightning-p2p://receive#t=${ticket}`;

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain(ticket);
    expect(redacted).toContain("[redacted-receive-link]");
  });
});
