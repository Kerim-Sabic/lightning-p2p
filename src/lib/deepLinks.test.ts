import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepLinkHandler, extractTicketFromDeepLink } from "./deepLinks";

const ticket = "fd2:abcdefghijklmnopqrstuvwxyzABCDEF";

afterEach(() => {
  vi.useRealTimers();
});

describe("extractTicketFromDeepLink", () => {
  it("accepts the native scheme and the canonical receive page", () => {
    expect(
      extractTicketFromDeepLink(`lightning-p2p://receive?t=${ticket}`),
    ).toBe(ticket);
    expect(
      extractTicketFromDeepLink(
        `https://lightning-p2p.netlify.app/receive#t=${ticket}`,
      ),
    ).toBe(ticket);
  });

  it("rejects other schemes, hosts, and paths", () => {
    expect(extractTicketFromDeepLink(`https://example.com/receive?t=${ticket}`)).toBe(
      null,
    );
    expect(
      extractTicketFromDeepLink(`https://lightning-p2p.netlify.app/send?t=${ticket}`),
    ).toBeNull();
    expect(extractTicketFromDeepLink(`javascript:alert(1)?t=${ticket}`)).toBeNull();
  });
});

describe("createDeepLinkHandler", () => {
  it("deduplicates the startup snapshot racing with the initial URL event", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const handle = createDeepLinkHandler(callback);
    const urls = [`lightning-p2p://receive?t=${ticket}`];

    handle(urls);
    handle(urls);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(ticket);
  });

  it("allows reopening the same receive link after the startup race window", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const handle = createDeepLinkHandler(callback);
    const urls = [`lightning-p2p://receive?t=${ticket}`];

    handle(urls);
    vi.advanceTimersByTime(1501);
    handle(urls);

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("skips invalid links and delivers the first valid ticket", () => {
    const callback = vi.fn();
    const handle = createDeepLinkHandler(callback);

    handle([
      "https://example.com/receive#t=fd2:abcdefghijklmnopqrstuvwxyzABCDEF",
      `lightning-p2p://receive?t=${ticket}`,
      "lightning-p2p://receive?t=invalid",
    ]);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(ticket);
  });
});
