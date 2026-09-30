export interface FlickMeasurement {
  dx: number;
  dy: number;
  elapsedMs: number;
  targetX: number;
  targetY: number;
}

export const MIN_FLICK_DISTANCE_PX = 48;
export const MIN_FLICK_VELOCITY_PX_PER_MS = 0.65;

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
