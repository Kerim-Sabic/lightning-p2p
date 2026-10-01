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
  resolveFlickRelease,
  snapshotFlickGesture,
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
  it("shows the file arriving from the same screen side the sender flicked toward", () => {
    const directions = [
      "right",
      "down_right",
      "down",
      "down_left",
      "left",
      "up_left",
      "up",
      "up_right",
    ] as const;
    for (const direction of directions) {
      expect(arrivalDirectionFromSenderFlick(direction)).toBe(direction);
    }
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

describe("resolveFlickRelease", () => {
  it("sends with the direction for a deliberate flick", () => {
    expect(
      resolveFlickRelease({ dx: 100, dy: 0, elapsedMs: 100 }, true),
    ).toEqual({ kind: "send", direction: "right" });
  });

  it("keeps a slower intentional swipe as a normal send", () => {
    expect(
      resolveFlickRelease({ dx: 30, dy: 0, elapsedMs: 100 }, true),
    ).toEqual({ kind: "send" });
  });

  it("leaves an ordinary tap to the button click handler", () => {
    expect(resolveFlickRelease({ dx: 3, dy: 4, elapsedMs: 100 }, false)).toEqual(
      { kind: "tap" },
    );
  });

  it("keeps a directional cue after holding before a quick swipe", () => {
    const { measurement } = snapshotFlickGesture(
      0,
      0,
      0,
      [
        { x: 0, y: 0, at: 0 },
        { x: 0, y: 0, at: 1000 },
        { x: 80, y: 0, at: 1080 },
      ],
      80,
      0,
      1100,
    );
    expect(measurement.elapsedMs).toBe(1100);
    expect(flickDirectionForGesture(measurement)).toBe("right");
  });

  it("drops stale directional motion but preserves the send on release", () => {
    const snapshot = snapshotFlickGesture(
      0,
      0,
      0,
      [
        { x: 0, y: 0, at: 0 },
        { x: 80, y: 0, at: 80 },
      ],
      80,
      0,
      500,
    );
    expect(flickDirectionForGesture(snapshot.measurement)).toBeNull();
    expect(resolveFlickRelease(snapshot.measurement, true)).toEqual({
      kind: "send",
    });
  });

  it("does not turn a slow drag into a direction cue", () => {
    const snapshot = snapshotFlickGesture(
      0,
      0,
      0,
      [
        { x: 0, y: 0, at: 0 },
        { x: 40, y: 0, at: 200 },
      ],
      100,
      0,
      400,
    );
    expect(flickDirectionForGesture(snapshot.measurement)).toBeNull();
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
