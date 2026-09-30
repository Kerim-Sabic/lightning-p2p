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
