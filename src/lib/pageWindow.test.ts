import { describe, expect, it } from "vitest";
import { pageWindow } from "./pageWindow";

describe("pageWindow", () => {
  it("bounds large selections to one page and clamps past the final page", () => {
    expect(pageWindow(10_000, 900, 24)).toEqual({
      pageIndex: 416,
      pageCount: 417,
      start: 9_984,
      end: 10_000,
    });
  });

  it("represents an empty list without producing invalid bounds", () => {
    expect(pageWindow(0, 5, 24)).toEqual({
      pageIndex: 0,
      pageCount: 1,
      start: 0,
      end: 0,
    });
  });

  it("sanitizes invalid indices and page sizes", () => {
    expect(pageWindow(25, Number.NaN, 0)).toEqual({
      pageIndex: 0,
      pageCount: 25,
      start: 0,
      end: 1,
    });
    expect(pageWindow(-4, Number.POSITIVE_INFINITY, 12)).toEqual({
      pageIndex: 0,
      pageCount: 1,
      start: 0,
      end: 0,
    });
  });
});
