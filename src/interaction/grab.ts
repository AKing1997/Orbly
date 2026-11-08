/**
 * One hand's orb state machine: hover, create, drag, release, throw, and
 * calling back orbs stuck to the room. The host owns the orbs; this decides
 * what the hand means.
 */

import { Vec3Like } from '../sequencer/mapping';
import { PinchEdges, VelocityTracker } from './gestures';

/** What the grab controller needs from the rest of the app. */
export interface OrbHost {
  /** Closest orb within `radius`, or -1. */
  pick(point: Vec3Like, radius: number): number;
  /** The orb on a surface this hand is pointing at, or -1. */
  pickFar(hand: number): number;
  /** Creates an orb at `point`; returns its id or -1 when not possible. */
  create(point: Vec3Like): number;
  beginDrag(id: number): void;
  /** Starts flying a far orb back to the hand. */
  recall(id: number): void;
  drag(id: number, point: Vec3Like): void;
  drop(id: number, point: Vec3Like): void;
  /** Throws the orb at the room. */
  fling(id: number, velocity: Vec3Like): void;
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
  /** Where the held orb is, ignoring the jump of fingers letting go. */
  private readonly settled: Vec3Like = { x: 0, y: 0, z: 0 };
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
   * @param steady a part of the hand that keeps still as the fingers open. The
   * pinch point jumps at that very moment, which would bend every throw.
   */
  update(
    point: Vec3Like | null,
    pinch: PinchEdges,
    enabled: boolean,
    time: number,
    dt: number,
    steady: Vec3Like | null = point,
  ): void {
    if (point === null) {
      this.setHover(-1);
      if (this.heldId >= 0 && !pinch.active) this.releaseUnseen();
      return;
    }

    this.tracker.push(time, steady ?? point);
    this.lastPoint.x = point.x;
    this.lastPoint.y = point.y;
    this.lastPoint.z = point.z;

    if (this.heldId >= 0) {
      this.setHover(-1);
      this.heldFor += dt;
      // Parting fingers drag the point between them along, so the orb stays
      // where it was when they began to open: otherwise it would land a note
      // above where the user let it go.
      if (!pinch.opening && !pinch.ended) {
        this.settled.x = point.x;
        this.settled.y = point.y;
        this.settled.z = point.z;
      }
      this.host.drag(this.heldId, this.settled);
      if (pinch.opening && !this.wasOpening) {
        this.tracker.velocity(this.velocity);
      }
      if (pinch.ended) this.release(this.settled, this.wasOpening);
      this.wasOpening = pinch.opening;
      return;
    }

    if (!enabled) {
      this.setHover(-1);
      return;
    }

    this.setHover(pinch.active ? -1 : this.findHover(point));

    if (pinch.started) {
      let id = this.host.pick(point, GRAB_RADIUS);
      if (id < 0) {
        id = this.host.pickFar(this.hand);
        if (id >= 0) this.host.recall(id);
      }
      if (id < 0) id = this.host.create(point);
      if (id >= 0) {
        this.heldId = id;
        this.heldFor = 0;
        this.wasOpening = false;
        this.settled.x = point.x;
        this.settled.y = point.y;
        this.settled.z = point.z;
        this.setHover(-1);
        this.host.beginDrag(id);
      }
    }
  }

  /** What a pinch would take right now: something close wins over far. */
  private findHover(point: Vec3Like): number {
    const near = this.host.pick(point, HOVER_RADIUS);
    return near >= 0 ? near : this.host.pickFar(this.hand);
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

  /**
   * The hand was lost and the pinch timed out without being seen to open. A
   * fast hand is exactly what tracking loses, so if it was swinging when it
   * vanished, that was a throw. Otherwise the orb stays where it was last seen.
   */
  private releaseUnseen(): void {
    const velocity = this.tracker.velocity(this.velocity);
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed >= THROW_SPEED && this.heldFor >= MIN_HOLD_BEFORE_THROW) {
      const id = this.heldId;
      this.heldId = -1;
      this.host.fling(id, velocity);
    } else {
      this.cancelToLastPoint();
    }
    this.tracker.clear();
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
      this.host.fling(id, velocity);
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
