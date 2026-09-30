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
