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

export type FlickDirection =
  | "right"
  | "down_right"
  | "down"
  | "down_left"
  | "left"
  | "up_left"
  | "up"
  | "up_right";

const OPPOSITE_FLICK_DIRECTION: Record<FlickDirection, FlickDirection> = {
  right: "left",
  down_right: "up_left",
  down: "up",
  down_left: "up_right",
  left: "right",
  up_left: "down_right",
  up: "down",
  up_right: "down_left",
};

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

/** Maps the sender's destination direction to the side the sender is on. */
export function arrivalDirectionFromSenderFlick(
  direction: FlickDirection,
): FlickDirection {
  return OPPOSITE_FLICK_DIRECTION[direction];
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
