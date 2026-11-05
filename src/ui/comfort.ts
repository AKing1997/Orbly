/**
 * Keeps what the user needs in view on every Meta VR device. Meta VR Glasses
 * see far less than a Quest (37 degrees to each side, 25 up, 43 down), so
 * essential UI is designed for that narrowest view, with a few degrees to
 * spare. A Quest simply has room left over.
 *
 * Angles are measured against the view axis, as a headset's projection does,
 * so a point both far to the side and low is judged correctly.
 */

import { Vec3Like } from '../sequencer/mapping';

export interface HeadView {
  position: Vec3Like;
  /** Unit vector the head faces. */
  forward: Vec3Like;
  /** Unit vector out of the top of the head. */
  up: Vec3Like;
}

const toTangent = (degrees: number): number =>
  Math.tan((degrees * Math.PI) / 180);

/** Limits of the comfortable zone, as tangents of the angle to the view axis. */
export const COMFORT_SIDE = toTangent(34);
export const COMFORT_UP = toTangent(22);
export const COMFORT_DOWN = toTangent(40);

const NEAREST_DEPTH = 0.05;

interface ViewPoint {
  x: number;
  y: number;
  z: number;
}

/** A point in head space: x right, y up, z straight ahead. */
function toHeadSpace(point: Vec3Like, view: HeadView): ViewPoint {
  const { forward: f, up: u } = view;
  const dx = point.x - view.position.x;
  const dy = point.y - view.position.y;
  const dz = point.z - view.position.z;
  const rightX = f.y * u.z - f.z * u.y;
  const rightY = f.z * u.x - f.x * u.z;
  const rightZ = f.x * u.y - f.y * u.x;
  return {
    x: dx * rightX + dy * rightY + dz * rightZ,
    y: dx * u.x + dy * u.y + dz * u.z,
    z: dx * f.x + dy * f.y + dz * f.z,
  };
}

/** True when a rectangle facing the user fits inside the comfortable zone. */
export function isInComfortZone(
  center: Vec3Like,
  view: HeadView,
  halfWidth: number,
  halfHeight: number,
): boolean {
  const { x, y, z } = toHeadSpace(center, view);
  if (z <= NEAREST_DEPTH) return false;
  return (
    (Math.abs(x) + halfWidth) / z <= COMFORT_SIDE &&
    (y + halfHeight) / z <= COMFORT_UP &&
    (y - halfHeight) / z >= -COMFORT_DOWN
  );
}

/**
 * Pulls a rectangle back inside the comfortable zone by the smallest amount,
 * keeping its distance from the eyes so a finger can still reach it. Writes to
 * `point`, and leaves anything already inside exactly where it is.
 */
export function keepInView<T extends Vec3Like>(
  point: T,
  view: HeadView,
  halfWidth: number,
  halfHeight: number,
): T {
  if (isInComfortZone(point, view, halfWidth, halfHeight)) return point;
  const { position, forward, up } = view;
  const head = toHeadSpace(point, view);
  const distance = Math.hypot(head.x, head.y, head.z);
  const depth = Math.max(head.z, distance * 0.5, NEAREST_DEPTH);

  // Half the size, as a tangent, at roughly the depth the result will have.
  const marginX = halfWidth / depth;
  const marginY = halfHeight / depth;
  const side = Math.max(0, COMFORT_SIDE - marginX);
  const top = COMFORT_UP - marginY;
  const bottom = -COMFORT_DOWN + marginY;
  const tanX = Math.max(-side, Math.min(side, head.x / depth));
  const tanY = top < bottom
    ? (top + bottom) / 2
    : Math.max(bottom, Math.min(top, head.y / depth));

  const z = distance / Math.hypot(1, tanX, tanY);
  const x = tanX * z;
  const y = tanY * z;
  const rightX = forward.y * up.z - forward.z * up.y;
  const rightY = forward.z * up.x - forward.x * up.z;
  const rightZ = forward.x * up.y - forward.y * up.x;
  point.x = position.x + rightX * x + up.x * y + forward.x * z;
  point.y = position.y + rightY * x + up.y * y + forward.y * z;
  point.z = position.z + rightZ * x + up.z * y + forward.z * z;
  return point;
}
