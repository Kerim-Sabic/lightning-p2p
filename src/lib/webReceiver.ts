// Typed bridge to the `web-receiver` WASM engine (the same iroh + iroh-blobs
// Rust core the desktop app runs, compiled to WebAssembly). The glue is loaded
// lazily from `/webrx/` on first use so it never touches the initial page
// budget — nothing here runs until the visitor opts into browser receive.
//
// The engine is relay-only (browsers cannot hole-punch) and memory-bound (the
// blob lives in WASM memory), which is why the UI gates on size before calling
// `fetch`. See docs/browser-receiver-spike.md.

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
interface WebReceiverInstance {
  fetch(ticket: string): Promise<string>;
  list_collection(rootHex: string): Promise<string>;
  read_blob(hashHex: string): Promise<Uint8Array>;
}
interface WebSenderInstance {
  add_file(name: string, bytes: Uint8Array): Promise<void>;
  staged_bytes(): number;
  publish(label: string): Promise<string>;
}
interface WasmModule {
  default: (moduleOrPath?: unknown) => Promise<unknown>;
  inspect_ticket: (ticket: string) => string;
  WebReceiver: { spawn: () => Promise<WebReceiverInstance> };
  WebSender: { spawn: () => Promise<WebSenderInstance> };
}

const MODULE_URL = `${import.meta.env.BASE_URL}webrx/web_receiver.js`;

let modulePromise: Promise<WasmModule> | null = null;

/** Loads and initializes the WASM module exactly once. */
async function loadModule(): Promise<WasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const mod = (await import(/* @vite-ignore */ MODULE_URL)) as WasmModule;
      await mod.default();
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

  /** Stages one file's bytes under its name. */
  async addFile(name: string, bytes: Uint8Array): Promise<void> {
    await this.inner.add_file(name, bytes);
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
}

/** Builds the shareable receive link for a ticket. */
export function receiveLinkForTicket(ticket: string): string {
  return `${window.location.origin}/receive#t=${ticket}`;
}

/** True when the browser exposes the File System Access save picker (Chromium). */
export function hasSaveFilePicker(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
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
