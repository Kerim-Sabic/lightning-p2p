import { describe, expect, it } from "vitest";
import {
  arrivalDirectionFromSenderFlick,
  classifyFlickDirection,
  isDeliberateFlick,
} from "./flickGesture";

describe("classifyFlickDirection", () => {
  it("maps gestures to the matching screen edge", () => {
    expect(classifyFlickDirection(100, 0)).toBe("right");
    expect(classifyFlickDirection(100, 100)).toBe("down_right");
    expect(classifyFlickDirection(0, 100)).toBe("down");
    expect(classifyFlickDirection(-100, 100)).toBe("down_left");
    expect(classifyFlickDirection(-100, 0)).toBe("left");
    expect(classifyFlickDirection(-100, -100)).toBe("up_left");
    expect(classifyFlickDirection(0, -100)).toBe("up");
    expect(classifyFlickDirection(100, -100)).toBe("up_right");
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
  it("accepts a fast deliberate movement in any chosen direction", () => {
    expect(
      isDeliberateFlick({
        dx: 0,
        dy: 120,
        elapsedMs: 100,
      }),
    ).toBe(true);
  });

  it("rejects slow drags and short movements", () => {
    expect(
      isDeliberateFlick({
        dx: 0,
        dy: 120,
        elapsedMs: 400,
      }),
    ).toBe(false);
    expect(
      isDeliberateFlick({
        dx: 30,
        dy: 0,
        elapsedMs: 10,
      }),
    ).toBe(false);
  });

  it("does not require the motion to point at the device card", () => {
    expect(
      isDeliberateFlick({
        dx: 96,
        dy: 2,
        elapsedMs: 100,
      }),
    ).toBe(true);
  });
});
