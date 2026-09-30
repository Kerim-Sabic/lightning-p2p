import { describe, expect, it, vi } from "vitest";
import { attachAsyncUnlisten } from "./asyncSubscription";

describe("attachAsyncUnlisten", () => {
  it("unlistens when subscription resolves after disposal", async () => {
    let resolveSubscription: ((stop: () => void) => void) | undefined;
    const subscription = new Promise<() => void>((resolve) => {
      resolveSubscription = resolve;
    });
    const stop = vi.fn();
    const cleanup = attachAsyncUnlisten(subscription, vi.fn());

    cleanup();
    resolveSubscription?.(stop);
    await Promise.resolve();

    expect(stop).toHaveBeenCalledOnce();
  });

  it("reports subscription errors only while mounted", async () => {
    const reportError = vi.fn();
    const mounted = attachAsyncUnlisten(
      Promise.reject(new Error("listen failed")),
      reportError,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledOnce();

    const reportAfterUnmount = vi.fn();
    const unmounted = attachAsyncUnlisten(
      Promise.reject(new Error("late failure")),
      reportAfterUnmount,
    );
    unmounted();
    await Promise.resolve();
    await Promise.resolve();
    expect(reportAfterUnmount).not.toHaveBeenCalled();
    mounted();
  });
});
