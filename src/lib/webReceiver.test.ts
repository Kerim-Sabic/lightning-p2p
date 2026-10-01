import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowserSender,
  BrowserReceiver,
  MAX_COMPAT_BUFFERED_IMPORT_BYTES,
  saveReceivedFile,
  saveReceivedFileStreaming,
  supportsStreamingReceiveApi,
  verifiedCollectionSize,
} from "./webReceiver";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BrowserReceiver.streamBlobTo", () => {
  it("rejects a WASM byte count that differs from bytes delivered to the sink", async () => {
    const inner = {
      stream_blob_to: async (
        _hash: string,
        _size: number,
        onChunk: (chunk: Uint8Array) => Promise<void>,
      ) => {
        await onChunk(new Uint8Array([1, 2]));
        return 1;
      },
    };
    const receiver = { inner } as unknown as BrowserReceiver;

    await expect(
      BrowserReceiver.prototype.streamBlobTo.call(
        receiver,
        "hash",
        2,
        async () => undefined,
      ),
    ).rejects.toThrow("streamed file length did not match");
  });
});

describe("BrowserSender.addFile compatibility import", () => {
  it("refuses to buffer beyond the aggregate safety limit", async () => {
    const addFile = vi.fn();
    const file = {
      size: MAX_COMPAT_BUFFERED_IMPORT_BYTES - 32 + 1,
      arrayBuffer: vi.fn(),
    } as unknown as Blob;
    const sender = {
      inner: { staged_bytes: () => 32, add_file: addFile },
    } as unknown as BrowserSender;

    await expect(
      BrowserSender.prototype.addFile.call(sender, "large.bin", file),
    ).rejects.toThrow("cannot safely import more than 64 MiB");
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    expect(addFile).not.toHaveBeenCalled();
  });

  it("keeps the legacy buffered path available below the safety limit", async () => {
    const addFile = vi.fn(async () => undefined);
    const file = {
      size: 2,
      arrayBuffer: vi.fn(async () => new Uint8Array([3, 4]).buffer),
    } as unknown as Blob;
    const sender = {
      inner: { staged_bytes: () => 0, add_file: addFile },
    } as unknown as BrowserSender;

    await BrowserSender.prototype.addFile.call(sender, "small.bin", file);

    expect(addFile).toHaveBeenCalledWith("small.bin", new Uint8Array([3, 4]));
  });
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

describe("saveReceivedFile ranged reads", () => {
  it("does not publish a truncated range as a completed file", async () => {
    const close = vi.fn(async () => undefined);
    const abort = vi.fn(async () => undefined);
    const createWritable = vi.fn(async () => ({
      write: vi.fn(async () => undefined),
      close,
      abort,
    }));
    vi.stubGlobal("window", {
      isSecureContext: true,
      showSaveFilePicker: vi.fn(async () => ({ createWritable })),
    });
    const receiver = {
      supportsRangedReads: () => true,
      readBlobRange: async () => new Uint8Array([1]),
      readBlob: vi.fn(async () => new Uint8Array([1, 2])),
    } as unknown as BrowserReceiver;

    await expect(
      saveReceivedFile(receiver, {
        name: "payload.bin",
        hash: "hash",
        size: 2,
      }),
    ).rejects.toThrow("saved file length did not match");
    expect(close).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
    expect(receiver.readBlob).not.toHaveBeenCalled();
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
