/**
 * Pure hand-gesture detection from joint positions. No WebXR types in here:
 * the detectors take plain numbers, so they run in tests on simulated joints.
 * Everything uses hysteresis (separate on/off thresholds plus a short dwell)
 * because hand tracking is noisy and a flickering pinch feels broken.
 */

import { Vec3Like } from '../sequencer/mapping';

export type Handedness = 'left' | 'right';

/** The joints gestures care about, in world space. */
export interface HandJoints {
  wrist: Vec3Like;
  thumbTip: Vec3Like;
  indexTip: Vec3Like;
  middleTip: Vec3Like;
  ringTip: Vec3Like;
  pinkyTip: Vec3Like;
  indexMeta: Vec3Like;
  middleMeta: Vec3Like;
  pinkyMeta: Vec3Like;
}

export function createHandJoints(): HandJoints {
  const v = (): Vec3Like => ({ x: 0, y: 0, z: 0 });
  return {
    wrist: v(),
    thumbTip: v(),
    indexTip: v(),
    middleTip: v(),
    ringTip: v(),
    pinkyTip: v(),
    indexMeta: v(),
    middleMeta: v(),
    pinkyMeta: v(),
  };
}

export function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** Thumb-to-index distance that starts a pinch. */
export const PINCH_ON_DISTANCE = 0.02;
/** Thumb-to-index distance that ends one. */
export const PINCH_OFF_DISTANCE = 0.036;
const PINCH_ON_DWELL = 0.03;
const PINCH_OFF_DWELL = 0.06;
/** How long tracking may drop out before a held pinch lets go. */
const PINCH_LOST_GRACE = 0.2;

/** Thumb-to-index distance where a pinch starts to be felt coming. */
const PINCH_FELT_DISTANCE = 0.075;

/** How close to a pinch the fingers are: 0 well apart, 1 about to touch. */
export function pinchCloseness(gap: number | null): number {
  if (gap === null) return 0;
  const span = PINCH_FELT_DISTANCE - PINCH_ON_DISTANCE;
  const closed = (PINCH_FELT_DISTANCE - gap) / span;
  return Math.max(0, Math.min(1, closed));
}

export interface PinchEdges {
  active: boolean;
  started: boolean;
  ended: boolean;
  /**
   * The fingers have parted but the release is still being debounced. Hand
   * speed must be read from this moment: by the time `ended` fires, a throw
   * is already over and the hand is slowing down.
   */
  opening: boolean;
}

export class PinchDetector {
  private active = false;
  private candidateTime = 0;
  private lostTime = 0;
  private readonly edges: PinchEdges = {
    active: false,
    started: false,
    ended: false,
    opening: false,
  };

  get isActive(): boolean {
    return this.active;
  }

  /**
   * @param gap thumb-to-index distance in metres, or null when untracked.
   * @param dt seconds since the previous update.
   */
  update(gap: number | null, dt: number): PinchEdges {
    const { edges } = this;
    edges.started = false;
    edges.ended = false;
    edges.opening = false;

    if (gap === null) {
      this.candidateTime = 0;
      if (this.active) {
        this.lostTime += dt;
        if (this.lostTime >= PINCH_LOST_GRACE) this.setActive(false);
      }
      edges.active = this.active;
      return edges;
    }

    this.lostTime = 0;
    const wantsChange = this.active
      ? gap > PINCH_OFF_DISTANCE
      : gap < PINCH_ON_DISTANCE;
    if (wantsChange) {
      this.candidateTime += dt;
      const dwell = this.active ? PINCH_OFF_DWELL : PINCH_ON_DWELL;
      if (this.candidateTime >= dwell) {
        this.setActive(!this.active);
        this.candidateTime = 0;
      } else {
        edges.opening = this.active;
      }
    } else {
      this.candidateTime = 0;
    }
    edges.active = this.active;
    return edges;
  }

  /** Same as the update for a held digital button (controllers). */
  updateButton(pressed: boolean, dt: number): PinchEdges {
    return this.update(pressed ? 0 : 1, dt + PINCH_OFF_DWELL + PINCH_ON_DWELL);
  }

  reset(): void {
    this.active = false;
    this.candidateTime = 0;
    this.lostTime = 0;
    this.edges.active = false;
    this.edges.started = false;
    this.edges.ended = false;
    this.edges.opening = false;
  }

  private setActive(active: boolean): void {
    this.active = active;
    this.edges.started = active;
    this.edges.ended = !active;
  }
}

/** Unit vector pointing out of the palm, written to `out`. */
export function palmNormal(
  hand: HandJoints,
  handedness: Handedness,
  out: Vec3Like,
): Vec3Like {
  const ax = hand.indexMeta.x - hand.wrist.x;
  const ay = hand.indexMeta.y - hand.wrist.y;
  const az = hand.indexMeta.z - hand.wrist.z;
  const bx = hand.pinkyMeta.x - hand.wrist.x;
  const by = hand.pinkyMeta.y - hand.wrist.y;
  const bz = hand.pinkyMeta.z - hand.wrist.z;
  const sign = handedness === 'left' ? -1 : 1;
  const nx = sign * (ay * bz - az * by);
  const ny = sign * (az * bx - ax * bz);
  const nz = sign * (ax * by - ay * bx);
  const length = Math.hypot(nx, ny, nz) || 1;
  out.x = nx / length;
  out.y = ny / length;
  out.z = nz / length;
  return out;
}

/** Mean fingertip distance from the wrist that counts as an open hand. */
const OPEN_FINGER_REACH = 0.125;
const PALM_ON_DOT = 0.7;
const PALM_OFF_DOT = 0.4;
/** The palm must also roughly face the eyes. */
const PALM_ON_FACING = 0.35;
const PALM_OFF_FACING = 0.05;
const PALM_ON_DWELL = 0.22;
const PALM_OFF_DWELL = 0.18;
const PALM_MAX_HEAD_DISTANCE = 0.85;
/**
 * The right hand reaching over to press the menu hides the left one from the
 * cameras, over and over. That is not the user closing the menu.
 */
const PALM_LOST_GRACE = 0.4;

export function fingerReach(hand: HandJoints): number {
  return (
    (distance(hand.wrist, hand.indexTip) +
      distance(hand.wrist, hand.middleTip) +
      distance(hand.wrist, hand.ringTip) +
      distance(hand.wrist, hand.pinkyTip)) /
    4
  );
}

/** Detects an open palm turned up towards the user's face. */
export class PalmUpDetector {
  private active = false;
  private candidateTime = 0;
  private lostTime = 0;
  private readonly normal: Vec3Like = { x: 0, y: 0, z: 0 };

  get isActive(): boolean {
    return this.active;
  }

  update(
    hand: HandJoints | null,
    handedness: Handedness,
    head: Vec3Like,
    pinching: boolean,
    dt: number,
  ): boolean {
    if (hand === null) {
      this.candidateTime = 0;
      if (this.active) {
        this.lostTime += dt;
        if (this.lostTime >= PALM_LOST_GRACE) this.reset();
      }
      return this.active;
    }
    this.lostTime = 0;
    const wanted = !pinching && this.matches(hand, handedness, head);
    if (wanted === this.active) {
      this.candidateTime = 0;
      return this.active;
    }
    this.candidateTime += dt;
    if (this.candidateTime >= (wanted ? PALM_ON_DWELL : PALM_OFF_DWELL)) {
      this.active = wanted;
      this.candidateTime = 0;
    }
    return this.active;
  }

  reset(): void {
    this.active = false;
    this.candidateTime = 0;
    this.lostTime = 0;
  }

  private matches(
    hand: HandJoints,
    handedness: Handedness,
    head: Vec3Like,
  ): boolean {
    const normal = palmNormal(hand, handedness, this.normal);
    const toHeadX = head.x - hand.middleMeta.x;
    const toHeadY = head.y - hand.middleMeta.y;
    const toHeadZ = head.z - hand.middleMeta.z;
    const headDistance = Math.hypot(toHeadX, toHeadY, toHeadZ) || 1;
    if (headDistance > PALM_MAX_HEAD_DISTANCE) return false;
    const facing =
      (normal.x * toHeadX + normal.y * toHeadY + normal.z * toHeadZ) /
      headDistance;
    const upDot = this.active ? PALM_OFF_DOT : PALM_ON_DOT;
    const facingDot = this.active ? PALM_OFF_FACING : PALM_ON_FACING;
    return (
      normal.y >= upDot &&
      facing >= facingDot &&
      fingerReach(hand) >= (this.active ? OPEN_FINGER_REACH * 0.85 : OPEN_FINGER_REACH)
    );
  }
}

const VELOCITY_WINDOW = 0.1;
/**
 * When tracking drops out, the newest sample can be the only one in the
 * window. The last one before the gap still says how fast the hand went.
 */
const VELOCITY_MAX_SPAN = 0.35;
const SAMPLE_CAPACITY = 16;

/** Hand speed over the last ~100 ms, averaging out single-frame jumps. */
export class VelocityTracker {
  private readonly times = new Float64Array(SAMPLE_CAPACITY);
  private readonly xs = new Float64Array(SAMPLE_CAPACITY);
  private readonly ys = new Float64Array(SAMPLE_CAPACITY);
  private readonly zs = new Float64Array(SAMPLE_CAPACITY);
  private head = 0;
  private count = 0;

  push(time: number, p: Vec3Like): void {
    this.times[this.head] = time;
    this.xs[this.head] = p.x;
    this.ys[this.head] = p.y;
    this.zs[this.head] = p.z;
    this.head = (this.head + 1) % SAMPLE_CAPACITY;
    this.count = Math.min(this.count + 1, SAMPLE_CAPACITY);
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  velocity(out: Vec3Like): Vec3Like {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    if (this.count < 2) return out;
    const newest = (this.head - 1 + SAMPLE_CAPACITY) % SAMPLE_CAPACITY;
    const newestTime = this.times[newest];
    let oldest = newest;
    for (let i = 1; i < this.count; i++) {
      const index = (newest - i + SAMPLE_CAPACITY * 2) % SAMPLE_CAPACITY;
      const age = newestTime - this.times[index];
      const spanning = oldest === newest && age <= VELOCITY_MAX_SPAN;
      if (age > VELOCITY_WINDOW && !spanning) break;
      oldest = index;
      if (age > VELOCITY_WINDOW) break;
    }
    const dt = newestTime - this.times[oldest];
    if (dt <= 1e-4) return out;
    out.x = (this.xs[newest] - this.xs[oldest]) / dt;
    out.y = (this.ys[newest] - this.ys[oldest]) / dt;
    out.z = (this.zs[newest] - this.zs[oldest]) / dt;
    return out;
  }
}

/** How long a hand must keep pointing at a far orb before it can be taken. */
export const AIM_DWELL = 0.35;
/**
 * A frame or two with nothing aimed at (the hand lost for a moment, the ray
 * wobbling at the edge of the orb) does not start the wait over.
 */
const AIM_GAP = 0.1;

/**
 * Pointing has to be deliberate. A hand pinching in the air usually happens to
 * point at the walls too, so without this every new orb would risk calling
 * back one already stuck there. The tether only shows once this passes, so
 * what a pinch will do is never a surprise.
 */
export class AimDwell {
  private target = -1;
  private time = 0;
  private gap = 0;

  /** @returns the orb that can be taken now, or -1. */
  update(candidate: number, dt: number): number {
    if (candidate < 0 && this.target >= 0 && this.gap + dt < AIM_GAP) {
      this.gap += dt;
      this.time += dt;
      return this.time >= AIM_DWELL ? this.target : -1;
    }
    this.gap = 0;
    if (candidate !== this.target) {
      this.target = candidate;
      this.time = 0;
      return -1;
    }
    this.time += dt;
    return candidate >= 0 && this.time >= AIM_DWELL ? candidate : -1;
  }

  reset(): void {
    this.target = -1;
    this.time = 0;
    this.gap = 0;
  }
}

/** Seconds of stillness before concert mode begins. */
export const LISTEN_AFTER = 9;
/** A hand must move faster than this to count as playing again, in m/s. */
const STILL_SPEED = 0.1;
const SPEED_SMOOTHING = 0.15;
/**
 * Tracking trembles by a millimetre or so every frame. Measured raw, that
 * alone is faster than STILL_SPEED, so a still hand would never count as
 * still. The position is smoothed first.
 */
const POSITION_SMOOTHING = 0.08;
/** A brief twitch does not end the music. */
const WAKE_DWELL = 0.1;

export interface ListeningHand {
  /** A steady point on the hand, or null when it is not tracked. */
  position: Vec3Like | null;
  pinching: boolean;
}

interface HandMotion {
  x: number;
  y: number;
  z: number;
  known: boolean;
  speed: number;
}

/**
 * Notices when the user has sat back. Hands that are out of tracking, resting
 * on the lap, or simply still all count as listening, so nothing has to be
 * learned: lower your hands and the concert starts. Any hand that comes up and
 * moves ends it at once.
 */
export class ListeningDetector {
  private readonly motion: HandMotion[] = [
    { x: 0, y: 0, z: 0, known: false, speed: 0 },
    { x: 0, y: 0, z: 0, known: false, speed: 0 },
  ];
  private quiet = 0;
  private waking = 0;
  private listening = false;

  get isListening(): boolean {
    return this.listening;
  }

  /**
   * @param restY hands below this height are resting, however they move.
   * @param allowed false while something else needs the user's attention.
   */
  update(
    hands: readonly ListeningHand[],
    restY: number,
    allowed: boolean,
    dt: number,
  ): boolean {
    let active = false;
    let pinching = false;
    hands.forEach((hand, index) => {
      pinching = pinching || hand.pinching;
      if (this.isPlaying(hand, this.motion[index], restY, dt)) active = true;
    });

    if (!allowed) {
      this.reset();
      return false;
    }
    if (this.listening) {
      this.waking = active ? this.waking + dt : 0;
      if (pinching || this.waking >= WAKE_DWELL) this.reset();
    } else if (active || pinching) {
      this.quiet = 0;
    } else {
      this.quiet += dt;
      if (this.quiet >= LISTEN_AFTER) this.listening = true;
    }
    return this.listening;
  }

  reset(): void {
    this.listening = false;
    this.quiet = 0;
    this.waking = 0;
  }

  private isPlaying(
    hand: ListeningHand,
    motion: HandMotion,
    restY: number,
    dt: number,
  ): boolean {
    if (hand.position === null) {
      motion.known = false;
      motion.speed = 0;
      return false;
    }
    const { x, y, z } = hand.position;
    if (motion.known && dt > 0) {
      const k = Math.min(1, dt / POSITION_SMOOTHING);
      const dx = (x - motion.x) * k;
      const dy = (y - motion.y) * k;
      const dz = (z - motion.z) * k;
      const speed = Math.hypot(dx, dy, dz) / dt;
      motion.speed += (speed - motion.speed) * Math.min(1, dt / SPEED_SMOOTHING);
      motion.x += dx;
      motion.y += dy;
      motion.z += dz;
    } else {
      motion.x = x;
      motion.y = y;
      motion.z = z;
    }
    motion.known = true;
    return y >= restY && motion.speed >= STILL_SPEED;
  }
}
