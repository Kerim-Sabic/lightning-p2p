export interface FlickMeasurement {
  dx: number;
  dy: number;
  elapsedMs: number;
}

export interface FlickTargetBounds {
  nodeId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
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

/** Carries the sender's chosen approximate side onto the receiver's screen. */
export function arrivalDirectionFromSenderFlick(
  direction: FlickDirection,
): FlickDirection {
  return direction;
}

export const MIN_FLICK_DISTANCE_PX = 48;
export const MIN_FLICK_VELOCITY_PX_PER_MS = 0.65;

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
}: FlickMeasurement): FlickDirection | null {
  return isDeliberateFlick({ dx, dy, elapsedMs })
    ? classifyFlickDirection(dx, dy)
    : null;
}

export function isDeliberateFlick({
  dx,
  dy,
  elapsedMs,
}: FlickMeasurement): boolean {
  if (elapsedMs <= 0) return false;
  const distance = Math.hypot(dx, dy);
  return (
    distance >= MIN_FLICK_DISTANCE_PX &&
    distance / elapsedMs >= MIN_FLICK_VELOCITY_PX_PER_MS
  );
}
