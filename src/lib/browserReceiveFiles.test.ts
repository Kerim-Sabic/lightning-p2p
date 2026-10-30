import { describe, expect, it } from "vitest";
import {
  browserReceiveFileKey,
  numberedFileName,
  safeRelativeSegments,
} from "./browserReceiveFiles";

describe("browserReceiveFileKey", () => {
  it("keeps duplicate-content collection entries independently saveable", () => {
    const hash = "same-content-hash";
    expect(browserReceiveFileKey(hash, 0)).not.toBe(
      browserReceiveFileKey(hash, 1),
    );
  });
});

describe("safeRelativeSegments", () => {
  it("keeps ordinary nested paths", () => {
    expect(safeRelativeSegments("photos/2026/beach.jpg")).toEqual([
      "photos",
      "2026",
      "beach.jpg",
    ]);
  });

  it("normalises separators and drops empty or dot segments", () => {
    expect(safeRelativeSegments("\\a//./b\\c.txt")).toEqual([
      "a",
      "b",
      "c.txt",
    ]);
    expect(safeRelativeSegments("")).toEqual(["download"]);
  });

  it("rejects traversal", () => {
    expect(() => safeRelativeSegments("a/../../etc/passwd")).toThrow();
  });

  it("neutralises names Windows and macOS refuse", () => {
    expect(safeRelativeSegments("bad:name?.txt")).toEqual(["bad_name_.txt"]);
    expect(safeRelativeSegments("nul.txt")).toEqual(["_nul.txt"]);
    expect(safeRelativeSegments("trailing. ")).toEqual(["trailing"]);
    expect(safeRelativeSegments("...")).toEqual(["_"]);
  });
});

describe("numberedFileName", () => {
  it("adds a counter before the extension", () => {
    expect(numberedFileName("report.pdf", 0)).toBe("report.pdf");
    expect(numberedFileName("report.pdf", 2)).toBe("report (2).pdf");
    expect(numberedFileName("README", 1)).toBe("README (1)");
    expect(numberedFileName(".env", 1)).toBe(".env (1)");
  });
});
