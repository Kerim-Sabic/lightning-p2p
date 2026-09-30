import { describe, expect, it } from "vitest";
import {
  arrivalDirectionFromSenderFlick,
  classifyFlickDirection,
  isDeliberateFlick,
} from "./flickGesture";

describe("classifyFlickDirection", () => {
  it("maps gestures to the matching screen edge", () => {
    expect(classifyFlickDirection(100, 0)).toBe("right");
    expect(classifyFlickDirection(-100, 0)).toBe("left");
    expect(classifyFlickDirection(0, -100)).toBe("up");
    expect(classifyFlickDirection(0, 100)).toBe("down");
    expect(classifyFlickDirection(100, 100)).toBe("down_right");
    expect(classifyFlickDirection(-100, -100)).toBe("up_left");
  });

  it("rejects vectors without a usable direction", () => {
    expect(classifyFlickDirection(0, 0)).toBeNull();
    expect(classifyFlickDirection(Number.NaN, 1)).toBeNull();
  });
});

describe("arrivalDirectionFromSenderFlick", () => {
  it("shows the sender's approximate side on the receiving screen", () => {
    expect(arrivalDirectionFromSenderFlick("right")).toBe("left");
    expect(arrivalDirectionFromSenderFlick("down_right")).toBe("up_left");
    expect(arrivalDirectionFromSenderFlick("down")).toBe("up");
    expect(arrivalDirectionFromSenderFlick("down_left")).toBe("up_right");
    expect(arrivalDirectionFromSenderFlick("left")).toBe("right");
    expect(arrivalDirectionFromSenderFlick("up_left")).toBe("down_right");
    expect(arrivalDirectionFromSenderFlick("up")).toBe("down");
    expect(arrivalDirectionFromSenderFlick("up_right")).toBe("down_left");
  });
});

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
