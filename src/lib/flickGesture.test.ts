import { describe, expect, it } from "vitest";
import { isDeliberateFlick } from "./flickGesture";

describe("isDeliberateFlick", () => {
  it("accepts a fast movement toward the locked target", () => {
    expect(
      isDeliberateFlick({
        dx: 0,
        dy: 120,
        elapsedMs: 100,
        targetX: 20,
        targetY: 260,
      }),
    ).toBe(true);
  });

  it("rejects slow drags, short movement, and movement away from the target", () => {
    expect(
      isDeliberateFlick({
        dx: 0,
        dy: 120,
        elapsedMs: 400,
        targetX: 0,
        targetY: 260,
      }),
    ).toBe(false);
    expect(
      isDeliberateFlick({
        dx: 30,
        dy: 0,
        elapsedMs: 10,
        targetX: 100,
        targetY: 0,
      }),
    ).toBe(false);
    expect(
      isDeliberateFlick({
        dx: 100,
        dy: 0,
        elapsedMs: 100,
        targetX: -200,
        targetY: 0,
      }),
    ).toBe(false);
  });
});
