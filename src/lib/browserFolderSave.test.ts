import { describe, expect, it } from "vitest";
import {
  saveFilesToFolder,
  type FolderHandle,
  type FolderSaveProgress,
  type FolderWritable,
} from "./browserFolderSave";
import type { BrowserReceiver, CollectionFile } from "./webReceiver";

class MemoryFolder implements FolderHandle {
  readonly folders = new Map<string, MemoryFolder>();
  readonly files = new Map<string, Uint8Array>();

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<MemoryFolder> {
    const existing = this.folders.get(name);
    if (existing) return existing;
    if (this.files.has(name) || !options?.create) {
      throw new DOMException(name, "NotFoundError");
    }
    const created = new MemoryFolder();
    this.folders.set(name, created);
    return created;
  }

  async getFileHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<{ createWritable(): Promise<FolderWritable> }> {
    if (this.folders.has(name))
      throw new DOMException(name, "TypeMismatchError");
    if (!this.files.has(name)) {
      if (!options?.create) throw new DOMException(name, "NotFoundError");
      this.files.set(name, new Uint8Array());
    }
    return {
      createWritable: async () => {
        const parts: Uint8Array[] = [];
        return {
          write: async (chunk: Uint8Array) => {
            parts.push(chunk.slice());
          },
          close: async () => {
            this.files.set(name, concat(parts));
          },
          abort: async () => undefined,
        };
      },
    };
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
    this.folders.delete(name);
  }

  read(path: string): string | undefined {
    const parts = path.split("/");
    const leaf = parts.pop() ?? "";
    const folder = parts.reduce<MemoryFolder | undefined>(
      (current, part) => current?.folders.get(part),
      this,
    );
    const bytes = folder?.files.get(leaf);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function fakeReceiver(
  contents: Record<string, string>,
  failOn?: string,
): BrowserReceiver {
  const encoder = new TextEncoder();
  const receiver = {
    async streamBlobTo(
      hash: string,
      _size: number,
      onChunk: (chunk: Uint8Array) => Promise<void>,
      onProgress?: (bytes: number) => void,
    ): Promise<number> {
      const bytes = encoder.encode(contents[hash] ?? "");
      let sent = 0;
      for (let offset = 0; offset < bytes.length; offset += 3) {
        if (hash === failOn && offset > 0) throw new Error("sender went away");
        const chunk = bytes.slice(offset, offset + 3);
        await onChunk(chunk);
        sent += chunk.length;
        onProgress?.(sent);
      }
      return sent;
    },
  };
  return receiver as unknown as BrowserReceiver;
}

function file(name: string, hash: string, body: string): CollectionFile {
  return { name, hash, size: new TextEncoder().encode(body).length };
}

describe("saveFilesToFolder", () => {
  it("recreates the shared folder tree and reports whole-save progress", async () => {
    const root = new MemoryFolder();
    const contents = { a: "first file", b: "second", c: "third one" };
    const files = [
      file("trip/day1/a.txt", "a", contents.a),
      file("trip/day1/b.txt", "b", contents.b),
      file("trip/c.txt", "c", contents.c),
    ];
    const progress: FolderSaveProgress[] = [];
    const saved: number[] = [];

    const written = await saveFilesToFolder(
      fakeReceiver(contents),
      root,
      files,
      {
        streamed: true,
        onProgress: (item) => progress.push(item),
        onFileSaved: (index) => saved.push(index),
      },
    );

    expect(root.read("trip/day1/a.txt")).toBe(contents.a);
    expect(root.read("trip/day1/b.txt")).toBe(contents.b);
    expect(root.read("trip/c.txt")).toBe(contents.c);
    expect(saved).toEqual([0, 1, 2]);
    const total = files.reduce((sum, item) => sum + item.size, 0);
    expect(written).toBe(total);
    expect(progress.at(-1)).toMatchObject({
      savedBytes: total,
      totalBytes: total,
    });
    const values = progress.map((item) => item.savedBytes);
    expect(values).toEqual([...values].sort((left, right) => left - right));
  });

  it("never overwrites an existing file", async () => {
    const root = new MemoryFolder();
    root.files.set("notes.txt", new TextEncoder().encode("keep me"));

    await saveFilesToFolder(
      fakeReceiver({ n: "new notes" }),
      root,
      [file("notes.txt", "n", "new notes")],
      { streamed: true },
    );

    expect(root.read("notes.txt")).toBe("keep me");
    expect(root.read("notes (1).txt")).toBe("new notes");
  });

  it("removes a file that failed part-way and stops", async () => {
    const root = new MemoryFolder();
    const contents = { ok: "complete", bad: "interrupted body" };

    await expect(
      saveFilesToFolder(
        fakeReceiver(contents, "bad"),
        root,
        [
          file("ok.txt", "ok", contents.ok),
          file("bad.txt", "bad", contents.bad),
        ],
        { streamed: true },
      ),
    ).rejects.toThrow("sender went away");

    expect(root.read("ok.txt")).toBe(contents.ok);
    expect(root.files.has("bad.txt")).toBe(false);
  });

  it("skips files already saved and neutralises unsafe names", async () => {
    const root = new MemoryFolder();
    const contents = { s: "skip", w: "write" };

    await saveFilesToFolder(
      fakeReceiver(contents),
      root,
      [file("s.txt", "s", contents.s), file("CON.txt", "w", contents.w)],
      { streamed: true, skip: (index) => index === 0 },
    );

    expect(root.files.has("s.txt")).toBe(false);
    expect(root.read("_CON.txt")).toBe(contents.w);
  });

  it("refuses to escape the chosen folder", async () => {
    await expect(
      saveFilesToFolder(
        fakeReceiver({ x: "x" }),
        new MemoryFolder(),
        [file("../outside.txt", "x", "x")],
        { streamed: true },
      ),
    ).rejects.toThrow("unsafe path");
  });

  it("stops when cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      saveFilesToFolder(
        fakeReceiver({ x: "x" }),
        new MemoryFolder(),
        [file("x.txt", "x", "x")],
        { streamed: true, signal: controller.signal },
      ),
    ).rejects.toThrow("cancelled");
  });
});
