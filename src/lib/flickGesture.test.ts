import { describe, expect, it } from "vitest";
import {
  arrivalDirectionFromSenderFlick,
  classifyFlickDirection,
  flickDirectionForGesture,
  flickTargetAtPoint,
  hasIntentionalFlickTravel,
  isAdditionalFlickPointer,
  isDeliberateFlick,
  liveFlickRecipient,
  movedBeyondFlickClickSlop,
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
  it("shows the sender entering from the opposite side of the receiver", () => {
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

describe("flickDirectionForGesture", () => {
  it("uses the same deliberate threshold for the preview and sent direction", () => {
    expect(flickDirectionForGesture({ dx: 100, dy: 0, elapsedMs: 100 })).toBe(
      "right",
    );
    expect(flickDirectionForGesture({ dx: 100, dy: 0, elapsedMs: 200 })).toBe(
      null,
    );
    expect(flickDirectionForGesture({ dx: 20, dy: 0, elapsedMs: 5 })).toBe(
      null,
    );
  });
});

describe("hasIntentionalFlickTravel", () => {
  it("accepts a long slow drop without treating it as a directional flick", () => {
    expect(hasIntentionalFlickTravel(100, 0)).toBe(true);
    expect(flickDirectionForGesture({ dx: 100, dy: 0, elapsedMs: 500 })).toBe(
      null,
    );
  });

  it("rejects short or non-finite movement", () => {
    expect(hasIntentionalFlickTravel(47, 0)).toBe(false);
    expect(hasIntentionalFlickTravel(Number.NaN, 100)).toBe(false);
  });
});

describe("movedBeyondFlickClickSlop", () => {
  it("keeps ordinary taps clickable while suppressing drag-generated clicks", () => {
    expect(movedBeyondFlickClickSlop(3, 4)).toBe(false);
    expect(movedBeyondFlickClickSlop(8, 0)).toBe(true);
    expect(movedBeyondFlickClickSlop(Number.NaN, 10)).toBe(false);
  });
});

describe("isAdditionalFlickPointer", () => {
  it("cancels an active gesture when another non-primary pointer starts", () => {
    expect(isAdditionalFlickPointer(1, 2, false)).toBe(true);
  });

  it("keeps primary pointer starts and idle state from canceling a gesture", () => {
    expect(isAdditionalFlickPointer(1, 2, true)).toBe(false);
    expect(isAdditionalFlickPointer(1, 1, false)).toBe(false);
    expect(isAdditionalFlickPointer(null, 2, false)).toBe(false);
  });
});

describe("flickTargetAtPoint", () => {
  const frozenTargets = [
    { nodeId: "device-left", left: 10, top: 20, right: 90, bottom: 80 },
    { nodeId: "device-right", left: 110, top: 20, right: 190, bottom: 80 },
  ];

  it("locks hit testing to the target geometry captured at gesture start", () => {
    expect(flickTargetAtPoint(frozenTargets, 130, 50)).toBe("device-right");
    expect(flickTargetAtPoint(frozenTargets, 90, 80)).toBe("device-left");
    expect(flickTargetAtPoint(frozenTargets, 100, 50)).toBeNull();
  });

  it("does not select a target for non-finite pointer coordinates", () => {
    expect(flickTargetAtPoint(frozenTargets, Number.NaN, 50)).toBeNull();
  });
});

describe("liveFlickRecipient", () => {
  it("keeps the frozen recipient and returns its latest discovered record", () => {
    const devices = [
      { node_id: "device-left", device_name: "Left" },
      { node_id: "device-right", device_name: "Updated name" },
    ];

    expect(liveFlickRecipient("device-right", devices)).toEqual(devices[1]);
    expect(liveFlickRecipient("device-moved", devices)).toBeNull();
    expect(liveFlickRecipient(null, devices)).toBeNull();
  });
});
