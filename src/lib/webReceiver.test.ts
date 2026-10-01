import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserReceiver,
  saveReceivedFileStreaming,
  supportsStreamingReceiveApi,
  verifiedCollectionSize,
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

describe("supportsStreamingReceiveApi", () => {
  it("requires both manifest and streamed blob methods", () => {
    expect(
      supportsStreamingReceiveApi({
        prepare_streamed_collection: vi.fn(),
        stream_blob_to: vi.fn(),
      }),
    ).toBe(true);
    expect(
      supportsStreamingReceiveApi({
        prepare_streamed_collection: vi.fn(),
      }),
    ).toBe(false);
    expect(supportsStreamingReceiveApi(undefined)).toBe(false);
  });
});

describe("verifiedCollectionSize", () => {
  it("safely totals individually verified collection sizes", () => {
    expect(
      verifiedCollectionSize([
        { name: "a.bin", hash: "a", size: 32 },
        { name: "b.bin", hash: "b", size: 70 },
      ]),
    ).toBe(102);
  });

  it("rejects invalid sizes and aggregate precision loss", () => {
    expect(() =>
      verifiedCollectionSize([{ name: "bad", hash: "a", size: Number.NaN }]),
    ).toThrow("outside the browser-safe range");
    expect(() =>
      verifiedCollectionSize([
        { name: "large-a", hash: "a", size: Number.MAX_SAFE_INTEGER },
        { name: "large-b", hash: "b", size: 1 },
      ]),
    ).toThrow("too large for safe browser accounting");
  });
});
