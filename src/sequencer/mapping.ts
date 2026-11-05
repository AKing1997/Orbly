/**
 * Pure mapping between the space around the seated user and the musical grid.
 *
 *   angle around the user -> step (when it plays)
 *   height                -> scale degree (which note)
 *   horizontal distance   -> band (which instrument)
 *
 * Nothing here knows about rendering or audio.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** A cell of the musical grid. */
export interface Slot {
  step: number;
  degree: number;
  band: number;
}

/**
 * Where the sequencer sits in the room. Calibrated from the head pose, so the
 * grid fits any seat height and any facing direction.
 */
export interface Stage {
  /** Horizontal centre (under the user's head). */
  x: number;
  z: number;
  /** Rotation of step 0 around +Y, using the three.js yaw convention. */
  yaw: number;
  /** World height of degree 0. */
  baseY: number;
  /** World height of the floor, where the ring is drawn. */
  floorY: number;
}

export const STEP_COUNT = 16;
/** Two pentatonic octaves plus the top root. */
export const DEGREE_COUNT = 11;
export const DEGREE_HEIGHT = 0.07;
export const BAND_COUNT = 3;
/** Rest radius of each band. All of them fit the ~60 cm seated reach. */
export const BAND_RADII: readonly number[] = [0.27, 0.4, 0.53];
/** Boundaries between bands. */
export const BAND_EDGES: readonly number[] = [0.335, 0.465];
export const MIN_RADIUS = 0.14;
export const MAX_RADIUS = 0.62;
/** Degree 0 rests this far below the eyes: about lap height when seated. */
export const BASE_BELOW_HEAD = 0.6;
/** Pinches further below degree 0 than this are hands at rest, not intent. */
export const CREATE_MARGIN_BELOW = 0.1;

const TAU = Math.PI * 2;

export function wrapStep(step: number): number {
  return ((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
}

/** Clockwise angle (seen from above) of a possibly fractional step. */
export function stepToAngle(step: number): number {
  return (step / STEP_COUNT) * TAU;
}

export function makeStage(
  head: Vec3Like,
  yaw: number,
  floorY: number = 0,
): Stage {
  return {
    x: head.x,
    z: head.z,
    yaw,
    baseY: head.y - BASE_BELOW_HEAD,
    floorY,
  };
}

export interface Polar {
  /** Clockwise angle from the stage's forward direction, in [0, TAU). */
  angle: number;
  radius: number;
}

export function toPolar(
  p: Vec3Like,
  stage: Stage,
  out: Polar = { angle: 0, radius: 0 },
): Polar {
  const dx = p.x - stage.x;
  const dz = p.z - stage.z;
  const sin = Math.sin(stage.yaw);
  const cos = Math.cos(stage.yaw);
  // Forward is (-sin, -cos) and right is (cos, -sin) in the XZ plane.
  const forward = -dx * sin - dz * cos;
  const right = dx * cos - dz * sin;
  const angle = Math.atan2(right, forward);
  out.angle = angle < 0 ? angle + TAU : angle;
  out.radius = Math.hypot(dx, dz);
  return out;
}

const scratchPolar: Polar = { angle: 0, radius: 0 };

export function bandForRadius(radius: number): number {
  if (radius < BAND_EDGES[0]) return 0;
  return radius < BAND_EDGES[1] ? 1 : 2;
}

export function degreeForHeight(y: number, stage: Stage): number {
  const degree = Math.round((y - stage.baseY) / DEGREE_HEIGHT);
  return Math.max(0, Math.min(DEGREE_COUNT - 1, degree));
}

export function heightForDegree(degree: number, stage: Stage): number {
  return stage.baseY + degree * DEGREE_HEIGHT;
}

export function positionToSlot(
  p: Vec3Like,
  stage: Stage,
  out: Slot = { step: 0, degree: 0, band: 0 },
): Slot {
  toPolar(p, stage, scratchPolar);
  out.step = wrapStep(Math.round((scratchPolar.angle / TAU) * STEP_COUNT));
  out.degree = degreeForHeight(p.y, stage);
  out.band = bandForRadius(scratchPolar.radius);
  return out;
}

export function slotToPosition<T extends Vec3Like>(
  slot: Slot,
  stage: Stage,
  out: T,
): T {
  const angle = stepToAngle(slot.step);
  polarToPosition(angle, BAND_RADII[slot.band], stage, out);
  out.y = heightForDegree(slot.degree, stage);
  return out;
}

/** Places `out` on the stage at a polar coordinate, leaving `out.y` alone. */
export function polarToPosition<T extends Vec3Like>(
  angle: number,
  radius: number,
  stage: Stage,
  out: T,
): T {
  const absolute = stage.yaw;
  const forwardX = -Math.sin(absolute);
  const forwardZ = -Math.cos(absolute);
  const rightX = Math.cos(absolute);
  const rightZ = -Math.sin(absolute);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.x = stage.x + radius * (c * forwardX + s * rightX);
  out.z = stage.z + radius * (c * forwardZ + s * rightZ);
  return out;
}

/** Keeps a dragged point inside the playable volume. */
export function clampToStage<T extends Vec3Like>(p: T, stage: Stage): T {
  const dx = p.x - stage.x;
  const dz = p.z - stage.z;
  const radius = Math.hypot(dx, dz);
  if (radius > MAX_RADIUS) {
    p.x = stage.x + (dx / radius) * MAX_RADIUS;
    p.z = stage.z + (dz / radius) * MAX_RADIUS;
  } else if (radius < MIN_RADIUS && radius > 1e-5) {
    p.x = stage.x + (dx / radius) * MIN_RADIUS;
    p.z = stage.z + (dz / radius) * MIN_RADIUS;
  }
  const top = stage.baseY + (DEGREE_COUNT - 1) * DEGREE_HEIGHT;
  p.y = Math.max(stage.baseY - 0.03, Math.min(top + 0.03, p.y));
  return p;
}

/** True when a pinch here is plausibly meant to create something. */
export function canCreateAt(p: Vec3Like, stage: Stage): boolean {
  return p.y >= stage.baseY - CREATE_MARGIN_BELOW;
}

/** Spiral search for the closest free cell, so two orbs never overlap. */
export function nearestFreeSlot(
  desired: Slot,
  isTaken: (step: number, degree: number, band: number) => boolean,
): Slot | null {
  const { step, band } = desired;
  if (!isTaken(step, desired.degree, band)) return { ...desired };
  for (let offset = 1; offset < DEGREE_COUNT; offset++) {
    for (const sign of [1, -1]) {
      const degree = desired.degree + sign * offset;
      if (degree < 0 || degree >= DEGREE_COUNT) continue;
      if (!isTaken(step, degree, band)) return { step, degree, band };
    }
  }
  return null;
}
