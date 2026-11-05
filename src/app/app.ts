/** Wires input, state, sound and visuals together, once per frame. */

import { Group, Vector3, World } from '@iwsdk/core';
import { PalmUpDetector, PinchDetector } from '../interaction/gestures';
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
import { CompositionStore, StoreEvent } from '../state/store';
import { EntryOverlay } from '../ui/overlay';
import { MenuAction, PalmMenu } from '../ui/palm-menu';
import { t } from '../ui/strings';
import { Toast } from '../ui/toast';
import { Beam } from '../visuals/beam';
import { OrbField } from '../visuals/orbs';
import { Palette, PALETTES } from '../visuals/palettes';
import { Particles } from '../visuals/particles';
import { FloorRing } from '../visuals/ring';
import { BEAT_FLASH, Music } from './music';
import { SessionLifecycle } from './session';
import { HeadPose } from './stage-pose';

const MAX_DT = 0.1;
const MAX_PARTICLES = 360;
const BPM_STEP = 4;
const QUARTER_TURN = Math.PI / 2;
const ROTATE_RATE = 5;

export class OrblyApp implements OrbHost {
  readonly store = new CompositionStore();
  readonly root = new Group();
  readonly head: HeadPose;
  readonly hands = new XRHandReader();
  readonly orbs = new OrbField(MAX_ORBS + 12);
  readonly music: Music;
  readonly menu = new PalmMenu();

  stage: Stage | null = null;

  private readonly beam = new Beam();
  private readonly ring = new FloorRing();
  private readonly particles = new Particles(MAX_PARTICLES);
  private readonly toast = new Toast();
  private readonly overlay: EntryOverlay;
  private readonly palm = new PalmUpDetector();
  private readonly pinches = [new PinchDetector(), new PinchDetector()];
  private readonly grabs: GrabController[];
  private readonly scratch = new Vector3();
  /** Separate from `scratch`: store events fire in the middle of its users. */
  private readonly eventScratch = new Vector3();
  /** Orbs still in the gesture that created them: one gesture, one undo. */
  private readonly freshOrbs = new Set<number>();
  private readonly dropSlot: Slot = { step: 0, degree: 0, band: 0 };
  private readonly dragSlot: Slot = { step: -1, degree: -1, band: -1 };
  private readonly hoverIds = [-1, -1];
  private palette: Palette = PALETTES[0];
  private inSession = false;
  private level = 0;
  private yawTarget = 0;
  private controllerMenuOpen = false;
  private menuButtonWasDown = false;

  constructor(private readonly world: World) {
    this.head = new HeadPose(world);
    this.music = new Music(this.store, (id) => this.isHeld(id));
    this.grabs = [new GrabController(0, this), new GrabController(1, this)];

    world.createTransformEntity(this.root);
    this.root.visible = false;
    this.root.add(
      this.ring.object,
      this.beam.object,
      this.orbs.object,
      this.particles.object,
      this.menu.object,
      this.toast.object,
    );
    this.menu.onAction = (action) => this.onMenuAction(action);
    this.menu.setTempo(this.store.bpm);
    this.menu.setGoal('', false);
    this.orbs.onFlingEnd = (x, y, z, band) => {
      this.particles.burst(x, y, z, this.palette.instruments[band], {
        count: 26,
        speed: 0.5,
        size: 0.014,
        life: 0.7,
      });
      this.music.audio.ui('pop');
    };
    this.applyPalette();

    this.store.subscribe((event) => this.onStoreEvent(event));

    this.overlay = new EntryOverlay(() => this.enter());
    this.overlay.show('ready');
    new SessionLifecycle(world, {
      onStart: () => this.onSessionStart(),
      onEnd: () => this.onSessionEnd(),
      onActiveChange: (active) => this.onActiveChange(active),
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

    const stage = this.stage;
    if (stage === null) return;

    this.updateStageRotation(delta);
    this.updateMenu(delta);
    this.updateHand(this.hands.left, 0, !this.menu.isOpen, delta, time);
    this.updateHand(this.hands.right, 1, !this.menu.fingerNear, delta, time);

    this.music.clock.tick();
    this.music.drainFlashes((id) => this.flash(id));
    this.music.setListener(this.head.position, this.head.forward, this.head.up);

    const target = this.music.paused ? 0.35 : 1;
    this.level += (target - this.level) * (1 - Math.exp(-delta * 3));
    const angle = this.music.beamAngle();
    this.beam.update(angle, stage.yaw, this.head.position, this.level);
    this.ring.update(angle, delta, this.level);
    this.orbs.update(delta);
    this.particles.update(delta);
    this.toast.update(delta);
  }

  /** Fits the grid to the current seat position and heading. */
  calibrate(): void {
    const { position, yaw } = this.head;
    if (position.lengthSq() === 0) return;
    const floorY = position.y > 0.6 ? 0 : position.y - 1.15;
    this.stage = makeStage(position, yaw, floorY);
    this.yawTarget = yaw;
    this.beam.setStage(this.stage);
    this.ring.setStage(this.stage);
    this.root.visible = true;
    this.relocateOrbs();
    this.music.run();
  }

  private enter(): void {
    this.music.unlock();
    this.world.launchXR();
  }

  private onSessionStart(): void {
    this.inSession = true;
    this.overlay.hide();
    this.music.unlock();
    this.particles.setPixelsPerUnit(820);
    const session = this.world.session;
    session?.addEventListener('selectstart', this.onSelect);
  }

  /** A pinch counts as a user gesture, in case audio is still locked. */
  private readonly onSelect = (): void => {
    if (!this.music.audio.isRunning) this.music.unlock();
  };

  private onSessionEnd(): void {
    this.inSession = false;
    this.grabs.forEach((grab) => grab.cancel());
    this.pinches.forEach((pinch) => pinch.reset());
    this.palm.reset();
    this.menu.setOpen(false, this.head.position, this.head.position);
    this.music.halt();
    this.stage = null;
    this.root.visible = false;
    this.overlay.show('ready');
  }

  private onActiveChange(active: boolean): void {
    if (active) {
      this.music.audio.resume();
    } else {
      this.grabs.forEach((grab) => grab.cancel());
      this.music.audio.suspend();
    }
  }

  private onStoreEvent(event: StoreEvent): void {
    const stage = this.stage;
    switch (event.type) {
      case 'add':
      case 'move':
        if (stage !== null) {
          slotToPosition(event.orb, stage, this.eventScratch);
          this.music.audio.setOrbPosition(event.orb.id, this.eventScratch);
        }
        break;
      case 'remove':
        this.orbs.dissolve(event.orb.id);
        this.music.audio.releaseOrb(event.orb.id);
        break;
      case 'reset':
        this.relocateOrbs();
        break;
      case 'bpm':
        this.music.setBpm(event.bpm);
        this.menu.setTempo(event.bpm);
        break;
      case 'scene':
        this.applyPalette();
        break;
    }
  }

  /** Brings views and panners in line with the store, whatever changed. */
  private relocateOrbs(): void {
    const stage = this.stage;
    if (stage === null) return;
    const position = this.eventScratch;
    for (const id of this.orbs.liveIds([])) {
      if (this.store.find(id) === undefined) {
        this.orbs.dissolve(id);
        this.music.audio.releaseOrb(id);
      }
    }
    for (const orb of this.store.orbs) {
      slotToPosition(orb, stage, position);
      if (this.orbs.has(orb.id)) {
        this.orbs.setBand(orb.id, orb.band);
        this.orbs.moveTo(orb.id, position);
      } else {
        this.orbs.spawn(orb.id, orb.band, position);
      }
      this.music.audio.setOrbPosition(orb.id, position);
    }
  }

  private applyPalette(): void {
    this.palette = PALETTES[this.store.sceneId];
    this.orbs.setPalette(this.palette);
    this.beam.setColor(this.palette.beam);
    this.ring.setPalette(this.palette);
    this.menu.setAccent(this.palette);
  }

  private flash(id: number): void {
    if (id === BEAT_FLASH) {
      this.ring.pulse(0.7);
      return;
    }
    this.orbs.pulse(id);
    const orb = this.store.find(id);
    if (orb === undefined) return;
    if (this.orbs.getPosition(id, this.scratch) !== null) {
      const { x, y, z } = this.scratch;
      this.particles.burst(x, y, z, this.palette.instruments[orb.band], {
        count: 6,
        speed: 0.16,
        size: 0.008,
        life: 0.55,
      });
    }
  }

  private isHeld(id: number): boolean {
    return this.grabs[0].held === id || this.grabs[1].held === id;
  }

  /** Eases the ring towards its target after the rotate button. */
  private updateStageRotation(dt: number): void {
    const stage = this.stage;
    if (stage === null) return;
    const remaining = this.yawTarget - stage.yaw;
    if (Math.abs(remaining) < 1e-4) return;
    stage.yaw += remaining * (1 - Math.exp(-dt * ROTATE_RATE));
    if (Math.abs(this.yawTarget - stage.yaw) < 1e-4) stage.yaw = this.yawTarget;
    this.ring.setStage(stage);
    this.relocateOrbs();
  }

  private updateMenu(dt: number): void {
    const { left, right } = this.hands;
    const head = this.head.position;
    let open = false;
    let anchor: Vec3Like = left.pinchPoint;
    if (left.kind === 'hand') {
      const pinching = this.pinches[0].isActive;
      open = this.palm.update(left.joints, 'left', head, pinching, dt);
      anchor = left.joints.middleMeta;
    } else {
      this.palm.update(null, 'left', head, false, dt);
      if (left.kind === 'controller') {
        if (left.menuPressed && !this.menuButtonWasDown) {
          this.controllerMenuOpen = !this.controllerMenuOpen;
        }
        open = this.controllerMenuOpen;
      }
    }
    this.menuButtonWasDown = left.menuPressed;
    this.menu.setOpen(open, anchor, head);
    this.menu.update(anchor, head, right.tracked ? right.pokeTip : null, dt);
  }

  private onMenuAction(action: MenuAction): void {
    const { audio } = this.music;
    audio.ui('tick');
    switch (action) {
      case 'slower':
        this.store.setBpm(this.store.bpm - BPM_STEP);
        break;
      case 'faster':
        this.store.setBpm(this.store.bpm + BPM_STEP);
        break;
      case 'playPause':
        this.music.setPaused(!this.music.paused);
        this.menu.setPaused(this.music.paused);
        break;
      case 'undo':
        if (!this.store.undo()) audio.ui('error');
        break;
      case 'rotate':
        // Brings what was on the user's right to the front.
        this.yawTarget -= QUARTER_TURN;
        audio.ui('whoosh');
        break;
      case 'scene':
        this.store.setScene(this.store.sceneId + 1);
        this.say(this.palette.name);
        break;
      case 'clear':
        if (this.store.orbs.length > 0) {
          this.store.clear();
          audio.ui('whoosh');
          this.say(t('cleared'));
        }
        break;
      case 'backdrop':
      case 'save':
      case 'home':
        break;
    }
  }

  private say(text: string): void {
    this.toast.show(text, this.head.position, this.head.forward);
  }

  private updateHand(
    hand: HandState,
    index: number,
    enabled: boolean,
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
      enabled,
      time,
      dt,
    );
  }

  private pulseHaptics(hand: number, strength: number, ms: number): void {
    const state = hand === 0 ? this.hands.left : this.hands.right;
    const actuator = state.gamepad?.hapticActuators?.[0];
    actuator?.pulse(strength, ms)?.catch?.(() => undefined);
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
    if (orb === null) {
      this.music.audio.ui('error');
      return -1;
    }
    this.orbs.spawn(orb.id, orb.band, spot);
    this.freshOrbs.add(orb.id);
    this.music.audio.ui('pop');
    return orb.id;
  }

  beginDrag(id: number): void {
    this.orbs.setHeld(id, true);
    this.dragSlot.step = -1;
    this.pulseHaptics(this.grabs[0].held === id ? 0 : 1, 0.5, 20);
  }

  drag(id: number, point: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    const spot = clampToStage(this.scratch.copy(point as Vector3), stage);
    this.orbs.place(id, spot);
    const slot = positionToSlot(spot, stage, this.dropSlot);
    this.orbs.setBand(id, slot.band);
    const moved = slot.degree !== this.dragSlot.degree ||
      slot.band !== this.dragSlot.band;
    if (moved && this.dragSlot.step >= 0) this.music.preview(slot);
    this.dragSlot.step = slot.step;
    this.dragSlot.degree = slot.degree;
    this.dragSlot.band = slot.band;
  }

  drop(id: number, point: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    const spot = clampToStage(this.scratch.copy(point as Vector3), stage);
    const slot = positionToSlot(spot, stage, this.dropSlot);
    const orb = this.store.move(id, slot, !this.freshOrbs.delete(id));
    this.orbs.setHeld(id, false);
    if (orb === null) return;
    this.orbs.setBand(id, orb.band);
    this.orbs.moveTo(id, slotToPosition(orb, stage, this.scratch));
    this.orbs.pulse(id);
    this.music.sound(orb);
  }

  discard(id: number, velocity: Vec3Like): void {
    this.orbs.fling(id, velocity);
    this.store.remove(id);
    this.music.audio.ui('whoosh');
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
