/**
 * The real room as the music sees it. Plain data and geometry: no WebXR and
 * no rendering, so all of it runs in tests on made-up rooms.
 */

import {
  BASE_BELOW_HEAD,
  DEGREE_COUNT,
  Slot,
  Stage,
  STEP_COUNT,
  toPolar,
  Vec3Like,
  wrapStep,
} from '../sequencer/mapping';

export type SurfaceKind = 'wall' | 'table' | 'floor' | 'soft' | 'air';

/** Where an orb sits, seen from the user's eyes. */
export interface RoomSpot {
  /** Clockwise from the stage's forward direction, radians. */
  azimuth: number;
  /** Above the horizon, radians. */
  elevation: number;
  /** Metres from the eyes. */
  distance: number;
}

export interface Surface {
  kind: SurfaceKind;
  origin: Vec3Like;
  axisU: Vec3Like;
  normal: Vec3Like;
  axisV: Vec3Like;
  /** Outline in plane coordinates, as u0, v0, u1, v1... */
  outline: readonly number[];
}

export interface RoomHit {
  point: Vec3Like;
  /** Unit vector facing the thrower. */
  normal: Vec3Like;
  kind: SurfaceKind;
  /** Lies flat, so height says nothing: distance sets its pitch instead. */
  flat: boolean;
}

/** The instrument each kind of surface plays. */
export const SURFACE_BAND: Readonly<Record<SurfaceKind, number>> = {
  wall: 3,
  table: 4,
  floor: 5,
  soft: 6,
  air: 7,
};

const TAU = Math.PI * 2;
/** Maximum distance a saved spot looks for a surface in a new room. */
const RESOLVE_REACH = 8;
const ON_SURFACE_TOLERANCE = 0.04;
/** A snapped orb must stay close to where it landed. */
const SNAP_MAX_SHIFT = 0.7;
/** Wall orbs span floor to ceiling across the scale. */
const WALL_BASE_ABOVE_FLOOR = 0.2;
const WALL_DEGREE_HEIGHT = 0.22;
/** Flat surfaces rise in pitch away from the user, like a marimba's bars. */
const FLAT_NEAREST = 0.4;
const FLAT_DEGREE_DEPTH = 0.26;

export function kindForLabel(
  label: string | undefined,
  orientation: string | undefined,
): SurfaceKind {
  const name = (label ?? '').toLowerCase();
  if (name === 'floor' || name === 'rug') return 'floor';
  if (name === 'couch' || name === 'bed' || name === 'chair') return 'soft';
  if (name === 'table' || name === 'desk' || name === 'storage') return 'table';
  if (orientation === 'horizontal' && name !== 'ceiling') return 'table';
  return 'wall';
}

const dot = (a: Vec3Like, b: Vec3Like): number =>
  a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Builds a surface from a detected plane.
 * @param polygon outline in plane space, where the plane is local XZ.
 * @param matrix the plane's pose, column-major.
 */
export function surfaceFromPlane(
  polygon: readonly Vec3Like[],
  matrix: ArrayLike<number>,
  label: string | undefined,
  orientation: string | undefined,
): Surface {
  const outline: number[] = [];
  for (const point of polygon) outline.push(point.x, point.z);
  const column = (index: number): Vec3Like => ({
    x: matrix[index],
    y: matrix[index + 1],
    z: matrix[index + 2],
  });
  return {
    kind: kindForLabel(label, orientation),
    axisU: column(0),
    normal: column(4),
    axisV: column(8),
    origin: column(12),
    outline,
  };
}

/** Even-odd test, which also copes with outlines that repeat their start. */
function outlineContains(outline: readonly number[], u: number, v: number): boolean {
  let inside = false;
  const count = outline.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const ui = outline[i * 2];
    const vi = outline[i * 2 + 1];
    const uj = outline[j * 2];
    const vj = outline[j * 2 + 1];
    if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) {
      inside = !inside;
    }
  }
  return inside;
}

/** True when a point on the surface's plane falls inside its outline. */
function containsPoint(surface: Surface, point: Vec3Like): boolean {
  const offset = {
    x: point.x - surface.origin.x,
    y: point.y - surface.origin.y,
    z: point.z - surface.origin.z,
  };
  return outlineContains(
    surface.outline,
    dot(offset, surface.axisU),
    dot(offset, surface.axisV),
  );
}

function toHit(surface: Surface, point: Vec3Like, facing: Vec3Like): RoomHit {
  const side = dot(surface.normal, facing) > 0 ? 1 : -1;
  return {
    point: { x: point.x, y: point.y, z: point.z },
    normal: {
      x: surface.normal.x * side,
      y: surface.normal.y * side,
      z: surface.normal.z * side,
    },
    kind: surface.kind,
    flat: Math.abs(surface.normal.y) > 0.7,
  };
}

/** The first surface along a ray, or null. `direction` must be unit length. */
export function raycast(
  surfaces: readonly Surface[],
  origin: Vec3Like,
  direction: Vec3Like,
  maxDistance: number,
): RoomHit | null {
  let best: Surface | null = null;
  let bestDistance = maxDistance;
  const point = { x: 0, y: 0, z: 0 };
  for (const surface of surfaces) {
    const facing = dot(direction, surface.normal);
    if (Math.abs(facing) < 1e-6) continue;
    const toPlane = {
      x: surface.origin.x - origin.x,
      y: surface.origin.y - origin.y,
      z: surface.origin.z - origin.z,
    };
    const distance = dot(toPlane, surface.normal) / facing;
    if (distance < 0 || distance >= bestDistance) continue;
    point.x = origin.x + direction.x * distance;
    point.y = origin.y + direction.y * distance;
    point.z = origin.z + direction.z * distance;
    if (!containsPoint(surface, point)) continue;
    best = surface;
    bestDistance = distance;
  }
  if (best === null) return null;
  return toHit(
    best,
    {
      x: origin.x + direction.x * bestDistance,
      y: origin.y + direction.y * bestDistance,
      z: origin.z + direction.z * bestDistance,
    },
    { x: -direction.x, y: -direction.y, z: -direction.z },
  );
}

/** The user's eyes, by way of the stage. */
export function stageEye(stage: Stage): Vec3Like {
  return { x: stage.x, y: stage.baseY + BASE_BELOW_HEAD, z: stage.z };
}

export function toSpot(point: Vec3Like, stage: Stage): RoomSpot {
  const eye = stageEye(stage);
  const { angle, radius } = toPolar(point, stage);
  const rise = point.y - eye.y;
  return {
    azimuth: angle,
    elevation: Math.atan2(rise, radius),
    distance: Math.hypot(radius, rise),
  };
}

function spotDirection(azimuth: number, elevation: number, stage: Stage): Vec3Like {
  const sinYaw = Math.sin(stage.yaw);
  const cosYaw = Math.cos(stage.yaw);
  const forward = Math.cos(azimuth);
  const right = Math.sin(azimuth);
  const flat = Math.cos(elevation);
  return {
    x: (forward * -sinYaw + right * cosYaw) * flat,
    y: Math.sin(elevation),
    z: (forward * -cosYaw + right * -sinYaw) * flat,
  };
}

function along(origin: Vec3Like, direction: Vec3Like, distance: number): Vec3Like {
  return {
    x: origin.x + direction.x * distance,
    y: origin.y + direction.y * distance,
    z: origin.z + direction.z * distance,
  };
}

/**
 * Finds where a saved spot belongs now. In the same room it stays exactly
 * where it was; in a different room it lands on whatever is in that direction,
 * which is how one song turns into a different band in every room.
 */
export function resolveSpot(
  spot: RoomSpot,
  stage: Stage,
  surfaces: readonly Surface[],
): RoomHit {
  const eye = stageEye(stage);
  const direction = spotDirection(spot.azimuth, spot.elevation, stage);
  const stored = along(eye, direction, spot.distance);
  const toEye = { x: -direction.x, y: -direction.y, z: -direction.z };
  for (const surface of surfaces) {
    const offset = {
      x: stored.x - surface.origin.x,
      y: stored.y - surface.origin.y,
      z: stored.z - surface.origin.z,
    };
    if (
      Math.abs(dot(offset, surface.normal)) < ON_SURFACE_TOLERANCE &&
      containsPoint(surface, stored)
    ) {
      return toHit(surface, stored, toEye);
    }
  }
  return (
    raycast(surfaces, eye, direction, RESOLVE_REACH) ?? {
      point: stored,
      normal: toEye,
      kind: 'air',
      flat: false,
    }
  );
}

/**
 * Slides a landing onto the exact angle of its step, so the beam reaches the
 * orb at the moment it sounds. Stays put if that would change surface.
 */
export function snapToStep(
  hit: RoomHit,
  stage: Stage,
  surfaces: readonly Surface[],
): RoomHit {
  if (hit.kind === 'air') return hit;
  const spot = toSpot(hit.point, stage);
  const step = Math.round((spot.azimuth / TAU) * STEP_COUNT);
  const direction = spotDirection((step / STEP_COUNT) * TAU, spot.elevation, stage);
  const snapped = raycast(surfaces, stageEye(stage), direction, RESOLVE_REACH);
  if (snapped === null || snapped.kind !== hit.kind) return hit;
  const shift = Math.hypot(
    snapped.point.x - hit.point.x,
    snapped.point.y - hit.point.y,
    snapped.point.z - hit.point.z,
  );
  return shift <= SNAP_MAX_SHIFT ? snapped : hit;
}

function clampDegree(degree: number): number {
  return Math.max(0, Math.min(DEGREE_COUNT - 1, Math.round(degree)));
}

/** The note and instrument a landing plays. */
export function roomSlot(hit: RoomHit, stage: Stage): Slot {
  const { angle, radius } = toPolar(hit.point, stage);
  const degree = hit.flat
    ? (radius - FLAT_NEAREST) / FLAT_DEGREE_DEPTH
    : (hit.point.y - stage.floorY - WALL_BASE_ABOVE_FLOOR) / WALL_DEGREE_HEIGHT;
  return {
    step: wrapStep(Math.round((angle / TAU) * STEP_COUNT)),
    degree: clampDegree(degree),
    band: SURFACE_BAND[hit.kind],
  };
}
