import { describe, expect, it, vi } from "vitest";
import {
  attachAsyncUnlisten,
  attachAsyncUnlistenersWithSnapshot,
  createCoalescedAsyncRunner,
  createSingleFlightRunner,
} from "./asyncSubscription";

describe("createCoalescedAsyncRunner", () => {
  it("runs a queued trigger after the active task without overlapping", async () => {
    const run = createCoalescedAsyncRunner();
    const steps: string[] = [];
    let finishFirst: (() => void) | undefined;

    const first = run(async () => {
      steps.push("first:start");
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      steps.push("first:end");
    });
    const second = run(async () => {
      steps.push("second");
    });

    expect(second).toBe(first);
    await Promise.resolve();
    expect(steps).toEqual(["first:start"]);

    finishFirst?.();
    await first;
    expect(steps).toEqual(["first:start", "first:end", "second"]);
  });

  it("runs a queued trigger even when the active task fails", async () => {
    const run = createCoalescedAsyncRunner();
    const queued = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const first = run(async () => {
      throw new Error("first failed");
    });
    run(queued);

    await expect(first).rejects.toThrow("first failed");
    expect(queued).toHaveBeenCalledOnce();
  });
});

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
  it("runs reconciliation only after the listener is attached", async () => {
    let resolveSubscription: ((stop: () => void) => void) | undefined;
    const subscription = new Promise<() => void>((resolve) => {
      resolveSubscription = resolve;
    });
    const onReady = vi.fn();
    const cleanup = attachAsyncUnlisten(subscription, vi.fn(), onReady);

    expect(onReady).not.toHaveBeenCalled();
    resolveSubscription?.(vi.fn());
    await Promise.resolve();

    expect(onReady).toHaveBeenCalledOnce();
    cleanup();
  });

  it("does not reconcile when a listener resolves after disposal", async () => {
    let resolveSubscription: ((stop: () => void) => void) | undefined;
    const subscription = new Promise<() => void>((resolve) => {
      resolveSubscription = resolve;
    });
    const onReady = vi.fn();
    const cleanup = attachAsyncUnlisten(subscription, vi.fn(), onReady);

    cleanup();
    resolveSubscription?.(vi.fn());
    await Promise.resolve();

    expect(onReady).not.toHaveBeenCalled();
  });

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

describe("attachAsyncUnlistenersWithSnapshot", () => {
  it("waits for every listener before reconciling the backend snapshot", async () => {
    let resolveFirst: ((stop: () => void) => void) | undefined;
    let resolveSecond: ((stop: () => void) => void) | undefined;
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const snapshot = vi.fn().mockResolvedValue(["pending"]);
    const applySnapshot = vi.fn();
    const first = new Promise<() => void>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<() => void>((resolve) => {
      resolveSecond = resolve;
    });
    const cleanup = attachAsyncUnlistenersWithSnapshot(
      [first, second],
      snapshot,
      applySnapshot,
      vi.fn(),
    );

    resolveFirst?.(firstStop);
    await Promise.resolve();
    expect(snapshot).not.toHaveBeenCalled();

    resolveSecond?.(secondStop);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(snapshot).toHaveBeenCalledOnce();
    expect(applySnapshot).toHaveBeenCalledWith(["pending"]);

    cleanup();
    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
  });

  it("does not apply a snapshot that resolves after cleanup", async () => {
    let resolveSnapshot: ((items: readonly string[]) => void) | undefined;
    const stop = vi.fn();
    const applySnapshot = vi.fn();
    const subscription = Promise.resolve(stop);
    const cleanup = attachAsyncUnlistenersWithSnapshot(
      [subscription],
      () =>
        new Promise<readonly string[]>((resolve) => {
          resolveSnapshot = resolve;
        }),
      applySnapshot,
      vi.fn(),
    );
    await Promise.resolve();
    await Promise.resolve();

    cleanup();
    resolveSnapshot?.(["stale"]);
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledOnce();
    expect(applySnapshot).not.toHaveBeenCalled();
  });

  it("unlistens each resolved subscription immediately after cleanup", async () => {
    let resolvePending: ((stop: () => void) => void) | undefined;
    const firstStop = vi.fn();
    const pending = new Promise<() => void>((resolve) => {
      resolvePending = resolve;
    });
    const snapshot = vi.fn().mockResolvedValue([]);
    const cleanup = attachAsyncUnlistenersWithSnapshot(
      [Promise.resolve(firstStop), pending],
      snapshot,
      vi.fn(),
      vi.fn(),
    );

    await Promise.resolve();
    cleanup();
    expect(firstStop).toHaveBeenCalledOnce();
    expect(snapshot).not.toHaveBeenCalled();

    const pendingStop = vi.fn();
    resolvePending?.(pendingStop);
    await Promise.resolve();
    expect(pendingStop).toHaveBeenCalledOnce();
  });

  it("reports a failed subscription without waiting for slower listeners", async () => {
    let resolvePending: ((stop: () => void) => void) | undefined;
    const pending = new Promise<() => void>((resolve) => {
      resolvePending = resolve;
    });
    const reportError = vi.fn();
    const snapshot = vi.fn();
    const cleanup = attachAsyncUnlistenersWithSnapshot(
      [Promise.reject(new Error("listener failed")), pending],
      async () => [],
      snapshot,
      reportError,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(reportError).toHaveBeenCalledWith(new Error("listener failed"));
    expect(snapshot).not.toHaveBeenCalled();

    const pendingStop = vi.fn();
    resolvePending?.(pendingStop);
    await Promise.resolve();
    expect(pendingStop).toHaveBeenCalledOnce();
    cleanup();
  });
});
