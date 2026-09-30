export interface FlickMeasurement {
  dx: number;
  dy: number;
  elapsedMs: number;
  targetX: number;
  targetY: number;
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

export const MIN_FLICK_DISTANCE_PX = 48;
export const MIN_FLICK_VELOCITY_PX_PER_MS = 0.65;

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
  targetX,
  targetY,
}: FlickMeasurement): boolean {
  if (elapsedMs <= 0) return false;
  const distance = Math.hypot(dx, dy);
  const targetDistance = Math.hypot(targetX, targetY);
  if (distance < MIN_FLICK_DISTANCE_PX || targetDistance === 0) return false;

  const towardTarget = (dx * targetX + dy * targetY) / targetDistance;
  return towardTarget / elapsedMs >= MIN_FLICK_VELOCITY_PX_PER_MS;
}
