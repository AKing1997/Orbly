/** Wires input, state, sound and visuals together, once per frame. */

import { Group, Vector3, World } from '@iwsdk/core';
import { PinchDetector } from '../interaction/gestures';
import { GrabController, OrbHost } from '../interaction/grab';
import { HandState, XRHandReader } from '../interaction/xr-hands';
import {
  canCreateAt,
  clampToStage,
  makeStage,
  positionToSlot,
  Slot,
  slotToPosition,
  Stage,
  Vec3Like,
} from '../sequencer/mapping';
import { MAX_ORBS } from '../state/composition';
import { CompositionStore } from '../state/store';
import { OrbField } from '../visuals/orbs';
import { HeadPose } from './stage-pose';

const MAX_DT = 0.1;

export class OrblyApp implements OrbHost {
  readonly store = new CompositionStore();
  readonly root = new Group();
  readonly head: HeadPose;
  readonly hands = new XRHandReader();
  readonly orbs = new OrbField(MAX_ORBS + 12);

  stage: Stage | null = null;

  private readonly pinches = [new PinchDetector(), new PinchDetector()];
  private readonly grabs: GrabController[];
  private readonly scratch = new Vector3();
  private readonly dropSlot: Slot = { step: 0, degree: 0, band: 0 };
  private readonly hoverIds = [-1, -1];

  constructor(private readonly world: World) {
    this.head = new HeadPose(world);
    world.createTransformEntity(this.root);
    this.root.add(this.orbs.object);
    this.grabs = [new GrabController(0, this), new GrabController(1, this)];
    this.store.subscribe((event) => {
      if (event.type === 'remove') this.orbs.dissolve(event.orb.id);
    });
  }

  update(dt: number, time: number): void {
    const delta = Math.min(dt, MAX_DT);
    this.head.update();

    const frame = this.world.xrFrame;
    const session = this.world.session;
    const space = this.world.xrReferenceSpace;
    if (frame !== null && session !== undefined && space !== null) {
      if (this.stage === null) this.calibrate();
      this.hands.read(frame, session, space);
    } else {
      this.hands.clear();
    }

    if (this.stage !== null) {
      this.updateHand(this.hands.left, 0, delta, time);
      this.updateHand(this.hands.right, 1, delta, time);
    }
    this.orbs.update(delta);
  }

  /** Fits the grid to the current seat position and heading. */
  calibrate(): void {
    const { position, yaw } = this.head;
    if (position.lengthSq() === 0) return;
    this.stage = makeStage(position, yaw, position.y > 0.6 ? 0 : position.y - 1.15);
  }

  private updateHand(
    hand: HandState,
    index: number,
    dt: number,
    time: number,
  ): void {
    const pinch = this.pinches[index];
    const edges = hand.kind === 'controller'
      ? pinch.updateButton(hand.triggerPressed, dt)
      : pinch.update(hand.pinchGap, dt);
    this.grabs[index].update(
      hand.tracked ? hand.pinchPoint : null,
      edges,
      true,
      time,
      dt,
    );
  }

  // OrbHost ---------------------------------------------------------------

  pick(point: Vec3Like, radius: number): number {
    return this.orbs.nearest(point, radius);
  }

  create(point: Vec3Like): number {
    const stage = this.stage;
    if (stage === null || !canCreateAt(point, stage)) return -1;
    const spot = clampToStage(this.scratch.copy(point as Vector3), stage);
    const orb = this.store.add(positionToSlot(spot, stage, this.dropSlot));
    if (orb === null) return -1;
    this.orbs.spawn(orb.id, orb.band, spot);
    return orb.id;
  }

  beginDrag(id: number): void {
    this.orbs.setHeld(id, true);
  }

  drag(id: number, point: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    const spot = clampToStage(this.scratch.copy(point as Vector3), stage);
    this.orbs.place(id, spot);
    this.orbs.setBand(id, positionToSlot(spot, stage, this.dropSlot).band);
  }

  drop(id: number, point: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    const spot = clampToStage(this.scratch.copy(point as Vector3), stage);
    const orb = this.store.move(id, positionToSlot(spot, stage, this.dropSlot));
    this.orbs.setHeld(id, false);
    if (orb === null) return;
    this.orbs.setBand(id, orb.band);
    this.orbs.moveTo(id, slotToPosition(orb, stage, this.scratch));
    this.orbs.pulse(id);
  }

  discard(id: number, velocity: Vec3Like): void {
    this.orbs.fling(id, velocity);
    this.store.remove(id);
  }

  setHover(hand: number, id: number): void {
    const previous = this.hoverIds[hand];
    this.hoverIds[hand] = id;
    if (previous >= 0 && !this.hoverIds.includes(previous)) {
      this.orbs.setHover(previous, false);
    }
    if (id >= 0) this.orbs.setHover(id, true);
  }
}
