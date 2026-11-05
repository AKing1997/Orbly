/**
 * One hand's orb state machine: hover, create, drag, release, throw. The
 * host owns the orbs; this decides what the hand means.
 */

import { Vec3Like } from '../sequencer/mapping';
import { PinchEdges, VelocityTracker } from './gestures';

/** What the grab controller needs from the rest of the app. */
export interface OrbHost {
  /** Closest orb within `radius`, or -1. */
  pick(point: Vec3Like, radius: number): number;
  /** Creates an orb at `point`; returns its id or -1 when not possible. */
  create(point: Vec3Like): number;
  beginDrag(id: number): void;
  drag(id: number, point: Vec3Like): void;
  drop(id: number, point: Vec3Like): void;
  discard(id: number, velocity: Vec3Like): void;
  setHover(hand: number, id: number): void;
}

/** A pinch this close to an orb grabs it instead of making a new one. */
export const GRAB_RADIUS = 0.075;
/** Larger than the grab radius, so the glow warns before contact. */
export const HOVER_RADIUS = 0.1;
/** Release speed that counts as a throw, in m/s. */
export const THROW_SPEED = 1.5;
/** Avoids reading the jerk of a quick pinch as a throw. */
const MIN_HOLD_BEFORE_THROW = 0.14;

export class GrabController {
  private heldId = -1;
  private heldFor = 0;
  private hoverId = -1;
  private readonly tracker = new VelocityTracker();
  private readonly velocity: Vec3Like = { x: 0, y: 0, z: 0 };
  private wasOpening = false;

  constructor(
    private readonly hand: number,
    private readonly host: OrbHost,
  ) {}

  get held(): number {
    return this.heldId;
  }

  /**
   * @param point pinch position, or null when the hand is unavailable.
   * @param enabled false while the hand is busy with UI.
   */
  update(
    point: Vec3Like | null,
    pinch: PinchEdges,
    enabled: boolean,
    time: number,
    dt: number,
  ): void {
    if (point === null) {
      this.setHover(-1);
      if (this.heldId >= 0 && !pinch.active) this.cancelToLastPoint();
      return;
    }

    this.tracker.push(time, point);
    this.lastPoint.x = point.x;
    this.lastPoint.y = point.y;
    this.lastPoint.z = point.z;

    if (this.heldId >= 0) {
      this.setHover(-1);
      this.heldFor += dt;
      this.host.drag(this.heldId, point);
      if (pinch.opening && !this.wasOpening) {
        this.tracker.velocity(this.velocity);
      }
      if (pinch.ended) this.release(point, this.wasOpening);
      this.wasOpening = pinch.opening;
      return;
    }

    if (!enabled) {
      this.setHover(-1);
      return;
    }

    const hover = pinch.active ? -1 : this.host.pick(point, HOVER_RADIUS);
    this.setHover(hover);

    if (pinch.started) {
      const near = this.host.pick(point, GRAB_RADIUS);
      const id = near >= 0 ? near : this.host.create(point);
      if (id >= 0) {
        this.heldId = id;
        this.heldFor = 0;
        this.wasOpening = false;
        this.setHover(-1);
        this.host.beginDrag(id);
      }
    }
  }

  /** Drops whatever is held, as when the session pauses. */
  cancel(): void {
    this.setHover(-1);
    this.tracker.clear();
    if (this.heldId >= 0) this.cancelToLastPoint();
  }

  private readonly lastPoint: Vec3Like = { x: 0, y: 0, z: 0 };

  private cancelToLastPoint(): void {
    const id = this.heldId;
    this.heldId = -1;
    this.host.drop(id, this.lastPoint);
  }

  /** @param measured true when `velocity` was captured as the fingers parted. */
  private release(point: Vec3Like, measured: boolean): void {
    const id = this.heldId;
    this.heldId = -1;
    const velocity = measured
      ? this.velocity
      : this.tracker.velocity(this.velocity);
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed >= THROW_SPEED && this.heldFor >= MIN_HOLD_BEFORE_THROW) {
      this.host.discard(id, velocity);
    } else {
      this.host.drop(id, point);
    }
    this.tracker.clear();
  }

  private setHover(id: number): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.host.setHover(this.hand, id);
  }
}
