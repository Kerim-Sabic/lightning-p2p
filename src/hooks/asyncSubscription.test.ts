import { describe, expect, it, vi } from "vitest";
import {
  attachAsyncUnlisten,
  createSingleFlightRunner,
} from "./asyncSubscription";

describe("createSingleFlightRunner", () => {
  it("shares concurrent lifecycle setup and allows a later retry", async () => {
    const runOnce = createSingleFlightRunner<number>();
    let resolve: ((value: number) => void) | undefined;
    const operation = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(
        () =>
          new Promise<number>((complete) => {
            resolve = complete;
          }),
      )
      .mockResolvedValueOnce(7);

    const first = runOnce(operation);
    const second = runOnce(operation);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(operation).toHaveBeenCalledOnce();

    resolve?.(7);
    await expect(first).resolves.toBe(7);
    await Promise.resolve();

    await expect(runOnce(operation)).resolves.toBe(7);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("clears a rejected operation so a later lifecycle can retry", async () => {
    const runOnce = createSingleFlightRunner<undefined>();
    const operation = vi
      .fn<() => Promise<undefined>>()
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(undefined);

    await expect(runOnce(operation)).rejects.toThrow("temporary failure");
    await expect(runOnce(operation)).resolves.toBeUndefined();
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

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
