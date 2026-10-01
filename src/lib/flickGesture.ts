export interface FlickMeasurement {
  dx: number;
  dy: number;
  elapsedMs: number;
  recentDx?: number;
  recentDy?: number;
  recentElapsedMs?: number;
}

export interface FlickPointerSample {
  x: number;
  y: number;
  at: number;
}

export interface FlickGestureSnapshot {
  samples: FlickPointerSample[];
  measurement: FlickMeasurement;
}

export type FlickReleaseAction =
  | { kind: "send"; direction?: FlickDirection }
  | { kind: "tap" };

export interface FlickTargetBounds {
  nodeId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Returns the current live device only when the frozen recipient is still present. */
export function liveFlickRecipient<T extends { node_id: string }>(
  nodeId: string | null,
  devices: readonly T[],
): T | null {
  if (!nodeId) return null;
  return devices.find((device) => device.node_id === nodeId) ?? null;
}

/** Returns true when a second non-primary pointer should cancel an active flick. */
export function isAdditionalFlickPointer(
  activePointerId: number | null,
  incomingPointerId: number,
  isPrimary: boolean,
): boolean {
  return (
    activePointerId !== null &&
    incomingPointerId !== activePointerId &&
    !isPrimary
  );
}

export type FlickDirection =
  | "right"
  | "down_right"
  | "down"
  | "down_left"
  | "left"
  | "up_left"
  | "up"
  | "up_right";

const FLICK_DIRECTIONS: readonly FlickDirection[] = [
  "right",
  "down_right",
  "down",
  "down_left",
  "left",
  "up_left",
  "up",
  "up_right",
];

/** Keeps the intended screen side consistent between sender and receiver. */
export function arrivalDirectionFromSenderFlick(
  direction: FlickDirection,
): FlickDirection {
  return direction;
}

export const MIN_FLICK_DISTANCE_PX = 48;
export const MIN_FLICK_VELOCITY_PX_PER_MS = 0.65;
const FLICK_CLICK_SLOP_PX = 8;
const FLICK_VELOCITY_WINDOW_MS = 120;
const FLICK_MOTION_EXPIRY_MS = 250;

/** Measures total travel and recent velocity with a bounded pointer history. */
export function snapshotFlickGesture(
  startX: number,
  startY: number,
  startedAt: number,
  previousSamples: readonly FlickPointerSample[],
  x: number,
  y: number,
  at: number,
): FlickGestureSnapshot {
  const retainedCutoff = at - FLICK_MOTION_EXPIRY_MS;
  const olderSample = previousSamples
    .filter((sample) => sample.at < retainedCutoff)
    .at(-1);
  const recentSamples = previousSamples.filter(
    (sample) => sample.at >= retainedCutoff,
  );
  const lastSample = recentSamples.at(-1) ?? olderSample;
  const moved = !lastSample || lastSample.x !== x || lastSample.y !== y;
  const samples = [
    ...(olderSample ? [olderSample] : []),
    ...recentSamples,
    ...(moved ? [{ x, y, at }] : []),
  ];
  const motionEnd = samples.at(-1);
  const motionIsFresh =
    motionEnd !== undefined && at - motionEnd.at <= FLICK_MOTION_EXPIRY_MS;
  const velocityStart = motionIsFresh
    ? samples.find(
        (sample) =>
          motionEnd.at - sample.at <= FLICK_VELOCITY_WINDOW_MS &&
          sample.at < motionEnd.at,
      )
    : undefined;

  return {
    samples,
    measurement: {
      dx: x - startX,
      dy: y - startY,
      elapsedMs: at - startedAt,
      recentDx:
        velocityStart && motionEnd ? motionEnd.x - velocityStart.x : 0,
      recentDy:
        velocityStart && motionEnd ? motionEnd.y - velocityStart.y : 0,
      recentElapsedMs:
        velocityStart && motionEnd ? motionEnd.at - velocityStart.at : 0,
    },
  };
}

/** Distinguishes a tap from a pointer gesture that should not trigger its click action. */
export function movedBeyondFlickClickSlop(dx: number, dy: number): boolean {
  return (
    Number.isFinite(dx) &&
    Number.isFinite(dy) &&
    Math.hypot(dx, dy) >= FLICK_CLICK_SLOP_PX
  );
}

/** Accepts a deliberate slow drop while keeping short pointer movement inert. */
export function hasIntentionalFlickTravel(dx: number, dy: number): boolean {
  return (
    Number.isFinite(dx) &&
    Number.isFinite(dy) &&
    Math.hypot(dx, dy) >= MIN_FLICK_DISTANCE_PX
  );
}

/** Resolves a pointer location against target geometry frozen for one gesture. */
export function flickTargetAtPoint(
  targets: readonly FlickTargetBounds[],
  x: number,
  y: number,
): string | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    targets.find(
      ({ left, top, right, bottom }) =>
        x >= left && x <= right && y >= top && y <= bottom,
    )?.nodeId ?? null
  );
}

export function classifyFlickDirection(
  dx: number,
  dy: number,
): FlickDirection | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    return null;
  }
  const octant = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return (
    FLICK_DIRECTIONS[
      (octant + FLICK_DIRECTIONS.length) % FLICK_DIRECTIONS.length
    ] ?? null
  );
}

/** Returns a direction only when the gesture meets the send threshold. */
export function flickDirectionForGesture({
  dx,
  dy,
  elapsedMs,
  recentDx,
  recentDy,
  recentElapsedMs,
}: FlickMeasurement): FlickDirection | null {
  const measurement = { dx, dy, elapsedMs, recentDx, recentDy, recentElapsedMs };
  if (!isDeliberateFlick(measurement)) return null;
  const directionX = recentDx ?? dx;
  const directionY = recentDy ?? dy;
  return directionX !== 0 || directionY !== 0
    ? classifyFlickDirection(directionX, directionY)
    : null;
}

/** Preserves a selected-device send when motion is too soft for direction. */
export function resolveFlickRelease(
  measurement: FlickMeasurement,
  movedBeyondClickSlop: boolean,
): FlickReleaseAction {
  const direction = flickDirectionForGesture(measurement);
  if (direction) return { kind: "send", direction };
  return movedBeyondClickSlop ? { kind: "send" } : { kind: "tap" };
}

export function isDeliberateFlick({
  dx,
  dy,
  elapsedMs,
  recentDx,
  recentDy,
  recentElapsedMs,
}: FlickMeasurement): boolean {
  const velocityX = recentDx ?? dx;
  const velocityY = recentDy ?? dy;
  const velocityElapsed = recentElapsedMs ?? elapsedMs;
  if (velocityElapsed <= 0) return false;
  const distance = Math.hypot(dx, dy);
  return (
    distance >= MIN_FLICK_DISTANCE_PX &&
    Math.hypot(velocityX, velocityY) / velocityElapsed >=
      MIN_FLICK_VELOCITY_PX_PER_MS
  );
}
