/** Shares one in-flight async operation across repeated lifecycle setup calls. */
export function createSingleFlightRunner<T>(): (
  operation: () => Promise<T>,
) => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return (operation) => {
    if (inFlight) return inFlight;

    const current = Promise.resolve().then(operation);
    inFlight = current;
    const clear = (): void => {
      if (inFlight === current) inFlight = null;
    };
    void current.then(clear, clear);
    return current;
  };
}

/** Serializes repeated lifecycle triggers and reruns once when they arrive mid-flight. */
export function createCoalescedAsyncRunner(): (
  operation: () => Promise<void>,
) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let pendingOperation: (() => Promise<void>) | null = null;

  return (operation) => {
    if (inFlight) {
      pendingOperation = operation;
      return inFlight;
    }

    const current = Promise.resolve().then(async () => {
      let firstError: unknown;
      let hasError = false;
      const runOperation = async (
        nextOperation: () => Promise<void>,
      ): Promise<void> => {
        try {
          await nextOperation();
        } catch (error) {
          if (!hasError) {
            firstError = error;
            hasError = true;
          }
        }
      };

      await runOperation(operation);
      while (pendingOperation) {
        const nextOperation = pendingOperation;
        pendingOperation = null;
        await runOperation(nextOperation);
      }
      if (hasError) throw firstError;
    });
    inFlight = current;
    const clear = (): void => {
      if (inFlight === current) inFlight = null;
    };
    void current.then(clear, clear);
    return current;
  };
}

export function attachAsyncUnlisten(
  subscription: Promise<() => void>,
  reportError: (error: unknown) => void,
  onReady?: () => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  void subscription
    .then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
        onReady?.();
      }
    })
    .catch((error: unknown) => {
      if (!disposed) reportError(error);
    });

  return () => {
    disposed = true;
    unlisten?.();
    unlisten = null;
  };
}

/** Registers async listeners before reconciling their current backend snapshot. */
export function attachAsyncUnlistenersWithSnapshot<T>(
  subscriptions: readonly Promise<() => void>[],
  getSnapshot: () => Promise<readonly T[]>,
  applySnapshot: (items: readonly T[]) => void,
  reportError: (error: unknown) => void,
): () => void {
  let disposed = false;
  let failed = false;
  let snapshotStarted = false;
  let resolvedSubscriptions = 0;
  const unlisten = new Set<() => void>();

  const stopListening = (): void => {
    for (const stop of unlisten) stop();
    unlisten.clear();
  };

  const fail = (error: unknown): void => {
    if (disposed || failed) return;
    failed = true;
    stopListening();
    reportError(error);
  };

  const reconcileWhenReady = (): void => {
    if (
      disposed ||
      failed ||
      snapshotStarted ||
      resolvedSubscriptions !== subscriptions.length
    ) {
      return;
    }
    snapshotStarted = true;
    void getSnapshot()
      .then((items) => {
        if (!disposed) applySnapshot(items);
      })
      .catch(fail);
  };

  for (const subscription of subscriptions) {
    void subscription
      .then((stop) => {
        if (disposed || failed) {
          stop();
          return;
        }
        unlisten.add(stop);
        resolvedSubscriptions += 1;
        reconcileWhenReady();
      })
      .catch(fail);
  }
  reconcileWhenReady();

  return () => {
    disposed = true;
    stopListening();
  };
}
