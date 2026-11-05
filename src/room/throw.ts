/**
 * Works out where a thrown orb lands, ahead of time: the flight is decided at
 * release and only played back afterwards. A seated flick is slow, so launch
 * speed is boosted; low gravity gives it a floaty, forgiving arc.
 */

import { Vec3Like } from '../sequencer/mapping';
import { raycast, RoomHit, Surface } from './surfaces';

const SPEED_BOOST = 2.6;
const MIN_LAUNCH = 3.4;
const MAX_LAUNCH = 7;
export const THROW_GRAVITY = 1.6;
const TIME_STEP = 0.025;
const MAX_FLIGHT = 1.8;
/** With no room data the orb stops in mid-air, on an invisible dome. */
export const DOME_RADIUS = 1.9;
/** An orb that misses every surface stops about here. */
const MISS_RADIUS = 4;
/** How far a throw is pulled towards where the user is looking. */
const AIM_ASSIST = 0.3;
/** cos 70 degrees: past this a throw is clearly aimed somewhere else. */
const AIM_ASSIST_MIN_COSINE = 0.34;

export interface ThrowPlan {
  start: Vec3Like;
  velocity: Vec3Like;
  gravity: number;
  duration: number;
  hit: RoomHit;
}

/**
 * Seated throws are small and tracked hands are noisy, so a throw leans a
 * little towards where the user is looking. A throw far from the gaze is left
 * alone: that one is deliberate.
 * @param gaze unit vector the head is facing.
 */
export function assistAim(hand: Vec3Like, gaze: Vec3Like): Vec3Like {
  const speed = Math.hypot(hand.x, hand.y, hand.z);
  if (speed < 1e-3) return hand;
  const x = hand.x / speed;
  const y = hand.y / speed;
  const z = hand.z / speed;
  if (x * gaze.x + y * gaze.y + z * gaze.z < AIM_ASSIST_MIN_COSINE) return hand;
  const ax = x + (gaze.x - x) * AIM_ASSIST;
  const ay = y + (gaze.y - y) * AIM_ASSIST;
  const az = z + (gaze.z - z) * AIM_ASSIST;
  const length = Math.hypot(ax, ay, az) || 1;
  return {
    x: (ax / length) * speed,
    y: (ay / length) * speed,
    z: (az / length) * speed,
  };
}

export function launchVelocity(hand: Vec3Like): Vec3Like {
  const speed = Math.hypot(hand.x, hand.y, hand.z);
  if (speed < 1e-3) return { x: 0, y: 0, z: -MIN_LAUNCH };
  const launch = Math.max(MIN_LAUNCH, Math.min(MAX_LAUNCH, speed * SPEED_BOOST));
  return {
    x: (hand.x / speed) * launch,
    y: (hand.y / speed) * launch,
    z: (hand.z / speed) * launch,
  };
}

export function planThrow(
  start: Vec3Like,
  handVelocity: Vec3Like,
  surfaces: readonly Surface[],
  eye: Vec3Like,
  floorY: number,
): ThrowPlan {
  const velocity = launchVelocity(handVelocity);
  const limit = surfaces.length > 0 ? MISS_RADIUS : DOME_RADIUS;
  const positionAt = (time: number): Vec3Like => ({
    x: start.x + velocity.x * time,
    y: start.y + velocity.y * time - 0.5 * THROW_GRAVITY * time * time,
    z: start.z + velocity.z * time,
  });
  const backwards = { x: -velocity.x, y: -velocity.y, z: -velocity.z };
  const toEye = (point: Vec3Like): Vec3Like => {
    const dx = eye.x - point.x;
    const dy = eye.y - point.y;
    const dz = eye.z - point.z;
    const length = Math.hypot(dx, dy, dz) || 1;
    return { x: dx / length, y: dy / length, z: dz / length };
  };
  const plan = (hit: RoomHit, duration: number): ThrowPlan => ({
    start: { x: start.x, y: start.y, z: start.z },
    velocity,
    gravity: THROW_GRAVITY,
    duration,
    hit,
  });

  let previous = positionAt(0);
  for (let time = TIME_STEP; time <= MAX_FLIGHT; time += TIME_STEP) {
    const next = positionAt(time);
    const dx = next.x - previous.x;
    const dy = next.y - previous.y;
    const dz = next.z - previous.z;
    const length = Math.hypot(dx, dy, dz);
    const direction = { x: dx / length, y: dy / length, z: dz / length };
    const hit = raycast(surfaces, previous, direction, length);
    if (hit !== null) {
      const covered = Math.hypot(
        hit.point.x - previous.x,
        hit.point.y - previous.y,
        hit.point.z - previous.z,
      );
      return plan(hit, time - TIME_STEP + (covered / length) * TIME_STEP);
    }
    if (next.y <= floorY) {
      // No floor plane detected here: the floor is still there.
      const point = { x: next.x, y: floorY, z: next.z };
      return plan(
        { point, normal: { x: 0, y: 1, z: 0 }, kind: 'floor', flat: true },
        time,
      );
    }
    const reach = Math.hypot(next.x - eye.x, next.y - eye.y, next.z - eye.z);
    if (reach >= limit) {
      return plan(
        { point: next, normal: toEye(next), kind: 'air', flat: false },
        time,
      );
    }
    previous = next;
  }
  return plan(
    { point: previous, normal: backwards, kind: 'air', flat: false },
    MAX_FLIGHT,
  );
}

/** Where the orb is at a moment of its flight, written to `out`. */
export function flightPosition(plan: ThrowPlan, time: number, out: Vec3Like): Vec3Like {
  out.x = plan.start.x + plan.velocity.x * time;
  out.y = plan.start.y + plan.velocity.y * time -
    0.5 * plan.gravity * time * time;
  out.z = plan.start.z + plan.velocity.z * time;
  return out;
}
