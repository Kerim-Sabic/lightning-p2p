// Typed bridge to the `web-receiver` WASM engine (the same iroh + iroh-blobs
// Rust core the desktop app runs, compiled to WebAssembly). The glue is loaded
// lazily from `/webrx/` on first use so it never touches the initial page
// budget — nothing here runs until the visitor opts into browser receive.
//
// The engine is relay-only (browsers cannot hole-punch) and memory-bound (the
// blob lives in WASM memory), which is why the UI gates on size before calling
// `fetch`. See docs/browser-receiver-spike.md.

import { WEBRX_VERSION } from "./webrxVersion";

/** Ticket metadata surfaced before any bytes are fetched, for the size gate. */
export interface TicketInfo {
  label: string;
  size: number;
}

/** One file inside a fetched collection. A single share is a one-entry list. */
export interface CollectionFile {
  name: string;
  hash: string;
  size: number;
}

// Minimal shape of the wasm-bindgen `--target web` module we depend on.
// Methods added after the first shipped engine are OPTIONAL: the glue is
// served from a stable URL that browsers cache, so a page can briefly run
// with an older engine than it was built against. Callers feature-detect
// and fall back rather than assume ("this.inner.begin_file is not a
// function" reached production exactly this way).
interface WebReceiverInstance {
  fetch(ticket: string): Promise<string>;
  list_collection(rootHex: string): Promise<string>;
  read_blob(hashHex: string): Promise<Uint8Array>;
  read_blob_range?(hashHex: string, offset: number, len: number): Promise<Uint8Array>;
}
interface WebSenderInstance {
  add_file(name: string, bytes: Uint8Array): Promise<void>;
  begin_file?(name: string): void;
  push_chunk?(chunk: Uint8Array): Promise<void>;
  finish_file?(): Promise<void>;
  staged_bytes(): number;
  publish(label: string): Promise<string>;
  shutdown?(): Promise<void>;
  free(): void;
}
interface WasmModule {
  default: (init?: { module_or_path: string }) => Promise<unknown>;
  inspect_ticket: (ticket: string) => string;
  render_qr_svg?: (text: string) => string;
  WebReceiver: { spawn: () => Promise<WebReceiverInstance> };
  WebSender: { spawn: () => Promise<WebSenderInstance> };
}

// ?v=<content hash> busts HTTP caches whenever the committed engine
// artifacts change; both the glue and the .wasm it loads must carry it.
const MODULE_URL = `${import.meta.env.BASE_URL}webrx/web_receiver.js?v=${WEBRX_VERSION}`;
const WASM_URL = `${import.meta.env.BASE_URL}webrx/web_receiver_bg.wasm?v=${WEBRX_VERSION}`;

let modulePromise: Promise<WasmModule> | null = null;

/** Loads and initializes the WASM module exactly once. */
async function loadModule(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await import(/* @vite-ignore */ MODULE_URL)) as WasmModule;
      await mod.default({ module_or_path: WASM_URL });
      return mod;
    })().catch((error) => {
      // Reset so a later retry can re-attempt the download.
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

/** True when browser receive can run here (a real browser, not the native app). */
export function browserReceiveSupported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    typeof window !== "undefined" &&
    !("__TAURI_INTERNALS__" in window)
  );
}

/** Reads a ticket's label and size without fetching any payload. */
export async function inspectTicket(ticket: string): Promise<TicketInfo> {
  const mod = await loadModule();
  const parsed = JSON.parse(mod.inspect_ticket(ticket)) as TicketInfo;
  return { label: parsed.label ?? "", size: Number(parsed.size ?? 0) };
}

/**
 * Renders text (a receive link) as an SVG QR code string — same renderer and
 * styling as the desktop app's ticket QR, running in the wasm engine.
 * Rejects on a stale-cached engine without QR support; callers treat the QR
 * as a bonus and catch.
 */
export async function renderQrSvg(text: string): Promise<string> {
  const mod = await loadModule();
  if (!mod.render_qr_svg) throw new Error("engine version without QR support");
  return mod.render_qr_svg(text);
}

/** A live browser receiver: a bound iroh endpoint plus an in-memory store. */
export class BrowserReceiver {
  private constructor(private readonly inner: WebReceiverInstance) {}

  /** Binds the endpoint and store. Cheap; call when the user opts in. */
  static async spawn(): Promise<BrowserReceiver> {
    const mod = await loadModule();
    return new BrowserReceiver(await mod.WebReceiver.spawn());
  }

  /**
   * Downloads the ticket's content, BLAKE3-verified as it lands, and returns
   * the root collection hash. A successful return means every byte is proven.
   */
  async fetch(ticket: string): Promise<string> {
    return this.inner.fetch(ticket);
  }

  /** Enumerates the files inside a fetched collection. */
  async listCollection(rootHex: string): Promise<CollectionFile[]> {
    const raw = await this.inner.list_collection(rootHex);
    const parsed = JSON.parse(raw) as CollectionFile[];
    return parsed.map((file) => ({
      name: file.name,
      hash: file.hash,
      size: Number(file.size),
    }));
  }

  /** Reads a fetched file's bytes out of the store, for saving to disk. */
  async readBlob(hashHex: string): Promise<Uint8Array> {
    return this.inner.read_blob(hashHex);
  }

  /**
   * Reads one slice of a fetched file, so big saves stream to disk. Check
   * [`supportsRangedReads`](BrowserReceiver#supportsRangedReads) first: a
   * stale-cached engine lacks this and the call throws.
   */
  async readBlobRange(hashHex: string, offset: number, len: number): Promise<Uint8Array> {
    if (!this.inner.read_blob_range) throw new Error("engine version without ranged reads");
    return this.inner.read_blob_range(hashHex, offset, len);
  }

  /** True when the engine supports slice reads for streamed saves. */
  supportsRangedReads(): boolean {
    return typeof this.inner.read_blob_range === "function";
  }
}

/**
 * A live browser share: staged files served from this tab over the iroh
 * relay. The tab must stay open while peers download — same rule as the
 * native sender.
 */
export class BrowserSender {
  private constructor(private readonly inner: WebSenderInstance) {}

  /** Binds the endpoint and starts accepting iroh-blobs requests. */
  static async spawn(): Promise<BrowserSender> {
    const mod = await loadModule();
    return new BrowserSender(await mod.WebSender.spawn());
  }

  /**
   * Streams one file into the share chunk by chunk. The engine hashes chunks
   * as they arrive (with backpressure), so the file is never duplicated
   * whole in memory — this is what lets big files fit in a tab.
   *
   * A stale-cached engine without the streaming API falls back to the
   * buffered import: more peak memory, identical result.
   */
  async addFile(name: string, file: Blob): Promise<void> {
    const inner = this.inner;
    if (!inner.begin_file || !inner.push_chunk || !inner.finish_file) {
      await inner.add_file(name, new Uint8Array(await file.arrayBuffer()));
      return;
    }
    inner.begin_file(name);
    const reader = file.stream().getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await inner.push_chunk(value);
      }
    } catch (error) {
      void reader.cancel().catch(() => undefined);
      throw error;
    }
    await inner.finish_file();
  }

  /** Total bytes staged so far, for the size gate. */
  stagedBytes(): number {
    return this.inner.staged_bytes();
  }

  /**
   * Publishes the staged files and returns the `fd2:` ticket. Waits for
   * relay reachability, so the ticket dials from anywhere.
   */
  async publish(label: string): Promise<string> {
    return this.inner.publish(label);
  }

  /**
   * Stops serving for real — shuts down the accept loop, closes the
   * endpoint, then releases the wasm object. (Freeing alone would leave the
   * engine's spawned accept task serving in the background; a stale-cached
   * engine without `shutdown` can only be freed.)
   */
  async stop(): Promise<void> {
    try {
      if (this.inner.shutdown) await this.inner.shutdown();
    } finally {
      this.inner.free();
    }
  }
}

/** Builds the shareable receive link for a ticket. */
export function receiveLinkForTicket(ticket: string): string {
  return `${window.location.origin}/receive#t=${ticket}`;
}

/** True when the browser exposes the File System Access save picker (Chromium). */
export function hasSaveFilePicker(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

// Slice size for streamed saves: big enough to keep disk writes efficient,
// small enough that peak extra memory stays negligible.
const SAVE_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Saves one received file the best way available: streamed out of the store
 * in slices when both the engine and the browser allow it (never duplicating
 * the file whole in memory), otherwise as full bytes.
 */
export async function saveReceivedFile(
  receiver: BrowserReceiver,
  file: CollectionFile,
): Promise<void> {
  if (receiver.supportsRangedReads()) {
    const streamed = await saveBlobStreamed(file.name, file.size, (offset, len) =>
      receiver.readBlobRange(file.hash, offset, len),
    );
    if (streamed) return;
  }
  await saveBytes(file.name, await receiver.readBlob(file.hash));
}

/**
 * Saves a fetched blob through the File System Access picker, reading it out
 * of the store in slices so the file is never duplicated whole in memory.
 * Returns false when the picker is unavailable — the caller falls back to
 * [`saveBytes`] with the full contents.
 */
async function saveBlobStreamed(
  name: string,
  size: number,
  read: (offset: number, len: number) => Promise<Uint8Array>,
): Promise<boolean> {
  if (!hasSaveFilePicker()) return false;
  const safeName = name.split(/[\\/]/).pop() || "download";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = await (window as any).showSaveFilePicker({ suggestedName: safeName });
  const writable = await handle.createWritable();
  try {
    for (let offset = 0; offset < size; offset += SAVE_CHUNK_BYTES) {
      const chunk = await read(offset, Math.min(SAVE_CHUNK_BYTES, size - offset));
      await writable.write(chunk);
    }
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // The write already failed; nothing more to clean up.
    }
    throw error;
  }
  return true;
}

/**
 * Saves bytes to disk. Prefers the File System Access API (a real "Save As"
 * dialog on Chromium); falls back to an anchor download (Firefox/Safari) that
 * lands in the browser's Downloads folder.
 */
export async function saveBytes(name: string, bytes: Uint8Array): Promise<void> {
  const safeName = name.split(/[\\/]/).pop() || "download";
  const blob = new Blob([bytes as BlobPart], { type: "application/octet-stream" });

  if (hasSaveFilePicker()) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showSaveFilePicker({ suggestedName: safeName });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      // AbortError = user cancelled the picker; propagate so the UI stays put.
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Any other failure: fall through to the anchor-download path.
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
