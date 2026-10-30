import type { BrowserReceiver, CollectionFile } from "./webReceiver";
import { numberedFileName, safeRelativeSegments } from "./browserReceiveFiles";

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: (options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: string;
  }) => Promise<FileSystemDirectoryHandle>;
};

/** Minimal writable surface used here; matches FileSystemWritableFileStream. */
export interface FolderWritable {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** Folder operations used here; matches FileSystemDirectoryHandle. */
export interface FolderHandle {
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FolderHandle>;
  getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<FolderWritable> }>;
  removeEntry(name: string): Promise<void>;
}

/** Progress across a whole folder save. */
export interface FolderSaveProgress {
  /** Index into the file list of the file being written. */
  fileIndex: number;
  /** Bytes written across all files in this save. */
  savedBytes: number;
  /** Bytes this save will write in total (skipped files excluded). */
  totalBytes: number;
}

/** Options for {@link saveFilesToFolder}. */
export interface FolderSaveOptions {
  /** True when the engine verifies and streams each file as it is written. */
  streamed: boolean;
  /** Skips files the user already saved. */
  skip?: (index: number) => boolean;
  onFileSaved?: (index: number) => void;
  onProgress?: (progress: FolderSaveProgress) => void;
  signal?: AbortSignal;
}

const READ_SLICE_BYTES = 8 * 1024 * 1024;
const MAX_NAME_ATTEMPTS = 1_000;

/** True when the browser can save into a user-chosen folder (Chromium). */
export function hasDirectoryPicker(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function"
  );
}

/** Asks the user for a destination folder. Call directly from a click. */
export async function pickReceiveFolder(): Promise<FolderHandle> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (!picker || !window.isSecureContext) {
    throw new Error("This browser cannot save into a folder.");
  }
  // FolderHandle narrows write() to Uint8Array; lib.dom types it as an
  // ArrayBuffer-backed BufferSource, which WASM-returned views do not claim
  // statically even though browsers accept them.
  return picker.call(window, {
    id: "lightning-p2p-receive",
    mode: "readwrite",
    startIn: "downloads",
  }) as Promise<FolderHandle>;
}

/**
 * Saves every received file into one folder, recreating the shared folder
 * structure. Existing files are never overwritten (`name (1).ext` is used),
 * and a file that fails part-way is removed so no truncated copy is left.
 * Returns the number of bytes written.
 */
export async function saveFilesToFolder(
  receiver: BrowserReceiver,
  root: FolderHandle,
  files: readonly CollectionFile[],
  options: FolderSaveOptions,
): Promise<number> {
  const pending = files
    .map((file, index) => ({ file, index }))
    .filter(({ index }) => !options.skip?.(index));
  const totalBytes = pending.reduce((sum, { file }) => sum + file.size, 0);
  const folders = new Map<string, FolderHandle>();
  let savedBytes = 0;
  for (const { file, index } of pending) {
    throwIfAborted(options.signal);
    const segments = safeRelativeSegments(file.name);
    const leaf = segments.pop() ?? "download";
    const folder = await ensureFolder(root, segments, folders);
    const before = savedBytes;
    const report = (fileBytes: number): void => {
      savedBytes = before + fileBytes;
      options.onProgress?.({ fileIndex: index, savedBytes, totalBytes });
    };
    report(0);
    await writeNewFile(folder, leaf, (writable) =>
      writeContents(receiver, file, writable, options, report),
    );
    savedBytes = before + file.size;
    options.onFileSaved?.(index);
  }
  return savedBytes;
}

async function ensureFolder(
  root: FolderHandle,
  segments: readonly string[],
  cache: Map<string, FolderHandle>,
): Promise<FolderHandle> {
  let current = root;
  let path = "";
  for (const segment of segments) {
    path = path ? `${path}/${segment}` : segment;
    const known = cache.get(path);
    if (known) {
      current = known;
      continue;
    }
    current = await current.getDirectoryHandle(segment, { create: true });
    cache.set(path, current);
  }
  return current;
}

async function writeNewFile(
  folder: FolderHandle,
  name: string,
  write: (writable: FolderWritable) => Promise<void>,
): Promise<string> {
  const finalName = await reserveFileName(folder, name);
  const handle = await folder.getFileHandle(finalName, { create: true });
  const writable = await handle.createWritable();
  try {
    await write(writable);
    await writable.close();
    return finalName;
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await folder.removeEntry(finalName).catch(() => undefined);
    throw error;
  }
}

async function reserveFileName(
  folder: FolderHandle,
  name: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const candidate = numberedFileName(name, attempt);
    try {
      await folder.getFileHandle(candidate);
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return candidate;
      }
      // TypeMismatchError: a folder already uses this name; try the next.
    }
  }
  throw new Error(`Could not find a free file name for ${name}.`);
}

async function writeContents(
  receiver: BrowserReceiver,
  file: CollectionFile,
  writable: FolderWritable,
  options: FolderSaveOptions,
  report: (fileBytes: number) => void,
): Promise<void> {
  let written: number;
  if (options.streamed) {
    written = await receiver.streamBlobTo(
      file.hash,
      file.size,
      async (chunk) => {
        throwIfAborted(options.signal);
        await writable.write(chunk);
      },
      report,
    );
  } else if (receiver.supportsRangedReads()) {
    written = 0;
    while (written < file.size) {
      throwIfAborted(options.signal);
      const length = Math.min(READ_SLICE_BYTES, file.size - written);
      const slice = await receiver.readBlobRange(file.hash, written, length);
      if (slice.byteLength !== length) break;
      await writable.write(slice);
      written += length;
      report(written);
    }
  } else {
    const bytes = await receiver.readBlob(file.hash);
    throwIfAborted(options.signal);
    await writable.write(bytes);
    written = bytes.byteLength;
    report(written);
  }
  if (written !== file.size) {
    throw new Error(
      `${file.name} did not match its verified size and was not saved.`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Folder save cancelled.", "AbortError");
  }
}
