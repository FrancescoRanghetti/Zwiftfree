/**
 * Virtual bike speed from power (spec §7). The speed shown and used to move the avatar comes from this model,
 * never from the trainer's flywheel.
 */

export const G = 9.80665;
/** Sea-level air density used by the spec, kg/m³. */
export const RHO0 = 1.2;
/** Scale height for the air density correction, metres. */
export const RHO_SCALE_HEIGHT_M = 8400;
/** Rotating mass of the wheels expressed as extra translational mass. */
export const WHEEL_INERTIA_KG = 0.5;
/** Floor of v in the P/v term, so that pedalling from a standstill does not divide by zero. */
export const V_MIN = 0.5;
/** Safety cap; the drag term alone already keeps descents around 70–75 km/h. */
export const MAX_SPEED_MS = 80 / 3.6;

export interface RiderParams {
  /** Rider + bike, kg. */
  massKg: number;
  cda: number;
  crr: number;
}

export function airDensity(eleM: number): number {
  return RHO0 * Math.exp(-Math.max(0, eleM) / RHO_SCALE_HEIGHT_M);
}

/** Net acceleration (m/s²) at speed v (m/s) with power P (W) on a grade (%) at elevation ele (m). */
export function acceleration(
  v: number,
  powerW: number,
  gradePercent: number,
  eleM: number,
  p: RiderParams,
): number {
  const theta = Math.atan(gradePercent / 100);
  const fGravity = p.massKg * G * Math.sin(theta);
  // Rolling resistance only opposes motion: a bike standing still is not pushed backwards by it.
  const moving = v > 0.01 || powerW > 0;
  const fRolling = moving ? p.massKg * G * Math.cos(theta) * p.crr : 0;
  const fAir = 0.5 * airDensity(eleM) * p.cda * v * v;
  const fPedal = powerW > 0 ? powerW / Math.max(v, V_MIN) : 0;
  return (fPedal - fGravity - fRolling - fAir) / (p.massKg + WHEEL_INERTIA_KG);
}

/** One explicit Euler step of dt seconds; the bike never rolls backwards and never exceeds MAX_SPEED_MS. */
export function stepSpeed(
  v: number,
  powerW: number,
  gradePercent: number,
  eleM: number,
  dt: number,
  p: RiderParams,
): number {
  const next = v + acceleration(v, powerW, gradePercent, eleM, p) * dt;
  return Math.min(MAX_SPEED_MS, Math.max(0, next));
}

/** Speed reached after holding the same power long enough (simulated at 10 Hz), m/s. */
export function steadySpeed(
  powerW: number,
  gradePercent: number,
  eleM: number,
  p: RiderParams,
  seconds = 600,
): number {
  let v = 0;
  for (let i = 0; i < seconds * 10; i++) v = stepSpeed(v, powerW, gradePercent, eleM, 0.1, p);
  return v;
}

export function riderParams(
  weightKg: number,
  bikeWeightKg: number,
  cda: number,
  crr: number,
): RiderParams {
  return { massKg: weightKg + bikeWeightKg, cda, crr };
}
