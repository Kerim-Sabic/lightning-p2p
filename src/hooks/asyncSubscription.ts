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

export function attachAsyncUnlisten(
  subscription: Promise<() => void>,
  reportError: (error: unknown) => void,
): () => void {
  let disposed = false;
  let unlisten: (() => void) | null = null;

  void subscription
    .then((stopListening) => {
      if (disposed) {
        stopListening();
      } else {
        unlisten = stopListening;
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
  let unlisten: (() => void)[] = [];

  void Promise.allSettled(subscriptions)
    .then(async (results) => {
      const stopListening = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      const failed = results.find((result) => result.status === "rejected");
      if (disposed || failed) {
        stopListening.forEach((stop) => stop());
        if (!disposed && failed?.status === "rejected") {
          reportError(failed.reason);
        }
        return;
      }
      unlisten = stopListening;
      try {
        const snapshot = await getSnapshot();
        if (!disposed) applySnapshot(snapshot);
      } catch (error) {
        if (!disposed) reportError(error);
      }
    });

  return () => {
    disposed = true;
    unlisten.forEach((stop) => stop());
    unlisten = [];
  };
}
