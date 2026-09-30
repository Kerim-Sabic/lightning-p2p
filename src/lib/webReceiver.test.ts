import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserReceiver,
  saveReceivedFileStreaming,
} from "./webReceiver";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saveReceivedFileStreaming", () => {
  it("aborts the writable promptly when cancellation occurs during a write", async () => {
    const controller = new AbortController();
    let rejectWrite: ((error: DOMException) => void) | null = null;
    let signalWriteStarted: (() => void) | null = null;
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const abort = vi.fn(async () => {
      rejectWrite?.(new DOMException("Writable aborted.", "AbortError"));
    });
    const write = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
          signalWriteStarted?.();
        }),
    );
    const createWritable = vi.fn(async () => ({
      write,
      close: vi.fn(async () => undefined),
      abort,
    }));
    vi.stubGlobal("window", {
      isSecureContext: true,
      showSaveFilePicker: vi.fn(async () => ({ createWritable })),
    });

    const receiver = {
      supportsStreamingReceive: () => true,
      streamBlobTo: async (
        _hash: string,
        _size: number,
        onChunk: (chunk: Uint8Array) => Promise<void>,
      ) => {
        await onChunk(new Uint8Array([1]));
        return 1;
      },
    } as unknown as BrowserReceiver;

    const saving = saveReceivedFileStreaming(
      receiver,
      { name: "payload.bin", hash: "hash", size: 1 },
      undefined,
      controller.signal,
    );
    await writeStarted;
    controller.abort();

    await expect(saving).rejects.toMatchObject({ name: "AbortError" });
    expect(abort).toHaveBeenCalledOnce();
    expect(write).toHaveBeenCalledOnce();
  });
});
