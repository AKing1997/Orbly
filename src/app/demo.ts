/**
 * `?demo=1`: a self-playing film of orbly for recording the submission video.
 * Ghost hands perform through the same code paths a real hand uses (create,
 * drag, drop, throw, poke), so what is filmed is the real app.
 */

import { Group, Quaternion, Vector3 } from '@iwsdk/core';
import { OrbHost } from '../interaction/grab';
import {
  polarToPosition,
  Slot,
  slotToPosition,
  Stage,
} from '../sequencer/mapping';
import { MenuAction, PalmMenu } from '../ui/palm-menu';
import { handQuaternion } from '../ui/tutorial';
import { GhostHand, GhostPose } from '../visuals/ghost-hand';

export interface DemoHost extends OrbHost {
  readonly menu: PalmMenu;
  readonly stage: Stage | null;
  addOrb(slot: Slot): void;
  clearAll(): void;
  menuAction(action: MenuAction): void;
  setStarfield(on: boolean): void;
  setConcert(on: boolean): void;
  setCamera(position: Vector3, target: Vector3): void;
  orbAt(slot: Slot): number;
}

/** Placed by hand, one at a time, while the loop builds. */
const HAND_PLACED: readonly Slot[] = [
  { step: 0, degree: 0, band: 2 },
  { step: 1, degree: 7, band: 0 },
  { step: 3, degree: 8, band: 0 },
  { step: 14, degree: 3, band: 0 },
  { step: 15, degree: 4, band: 0 },
  { step: 12, degree: 3, band: 2 },
];

/** The rest of the composition, which blooms in during the wide shot. */
const BLOOM: readonly Slot[] = [
  { step: 0, degree: 5, band: 1 },
  { step: 0, degree: 7, band: 1 },
  { step: 8, degree: 4, band: 1 },
  { step: 8, degree: 7, band: 1 },
  { step: 8, degree: 4, band: 2 },
  { step: 6, degree: 2, band: 2 },
  { step: 5, degree: 7, band: 0 },
  { step: 6, degree: 5, band: 0 },
  { step: 9, degree: 6, band: 0 },
  { step: 10, degree: 5, band: 0 },
  { step: 11, degree: 4, band: 0 },
];

/** Orbs that leave the ring, and where they are thrown. */
const ROOM_THROWS: readonly [Slot, Vector3][] = [
  [{ step: 3, degree: 8, band: 0 }, new Vector3(0.75, 0.25, -0.6).normalize()],
  [{ step: 14, degree: 3, band: 0 }, new Vector3(-0.8, 0.2, -0.55).normalize()],
  [{ step: 15, degree: 4, band: 0 }, new Vector3(-0.1, -0.5, -0.85).normalize()],
];

const EYE_HEIGHT = 1.22;

interface Segment {
  duration: number;
  begin?: () => void;
  update?: (progress: number, dt: number) => void;
  end?: () => void;
}

/** Runs segments one after another. */
class Track {
  private index = 0;
  private elapsed = 0;
  private started = false;

  constructor(private readonly segments: readonly Segment[]) {}

  get finished(): boolean {
    return this.index >= this.segments.length;
  }

  update(dt: number): void {
    let remaining = dt;
    while (!this.finished) {
      const segment = this.segments[this.index];
      if (!this.started) {
        this.started = true;
        segment.begin?.();
      }
      const room = segment.duration - this.elapsed;
      const step = Math.min(room, remaining);
      this.elapsed += step;
      const progress = segment.duration > 0 ? this.elapsed / segment.duration : 1;
      segment.update?.(Math.min(1, progress), dt);
      remaining -= step;
      if (this.elapsed < segment.duration) return;
      segment.end?.();
      this.index++;
      this.elapsed = 0;
      this.started = false;
      if (remaining <= 0) return;
    }
  }
}

function ease(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

const wait = (duration: number): Segment => ({ duration });

interface CameraKey {
  /** Angle around the user, radians, 0 is behind the seat looking forward. */
  angle: number;
  radius: number;
  height: number;
  /** The point looked at: height, then distance ahead and to the right. */
  lookHeight: number;
  lookAhead: number;
  lookRight?: number;
}

/** Over the shoulder: at eye level an orb 27 cm away would fill a flat video. */
const POV: CameraKey = {
  angle: 0,
  radius: 0.62,
  height: 1.42,
  lookHeight: 0.98,
  lookAhead: 0.35,
};
/** Behind the seat at eye level: the room fills the frame for the throws. */
const ROOM_SHOT: CameraKey = {
  angle: 0,
  radius: 0.7,
  height: 1.4,
  lookHeight: 1.2,
  lookAhead: 2,
};
/** Close on the palm menu, so its buttons read in a flat video. */
const MENU_SHOT: CameraKey = {
  angle: -0.1,
  radius: 0.34,
  height: 1.2,
  lookHeight: 1.02,
  lookAhead: 0.3,
  lookRight: -0.1,
};
const OPENING: CameraKey = {
  angle: 0.5,
  radius: 2.5,
  height: 2.3,
  lookHeight: 0.75,
  lookAhead: 0,
};
const RAISED: CameraKey = {
  angle: -0.5,
  radius: 1.9,
  height: 1.8,
  lookHeight: 0.85,
  lookAhead: 0,
};
const LOW_ORBIT: CameraKey = {
  angle: 2.4,
  radius: 1.5,
  height: 1.05,
  lookHeight: 1.0,
  lookAhead: 0,
};
const HIGH_ORBIT: CameraKey = {
  angle: 5.4,
  radius: 2.1,
  height: 2.0,
  lookHeight: 0.85,
  lookAhead: 0,
};

export class DemoDirector {
  private camera: Track;
  private performance: Track;
  private readonly right = new GhostHand('right');
  private readonly left = new GhostHand('left');
  private readonly rightPose: GhostPose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    pinch: 0,
    fold: 0,
  };
  private readonly leftPose: GhostPose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    pinch: 0,
    fold: 0,
  };
  private readonly goal = new Vector3();
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly tip = new Vector3();
  private readonly palm = new Vector3();
  private readonly fingers = new Vector3();
  private readonly cameraPosition = new Vector3();
  private readonly cameraTarget = new Vector3();
  private readonly rest = new Vector3();
  private readonly palmCenter = new Vector3();
  private readonly cameraForward = new Vector3(0, 0, -1);
  private readonly cameraUp = new Vector3(0, 1, 0);
  private menuOpen = false;
  private fingerActive = false;
  private held = -1;
  private key: CameraKey = OPENING;

  constructor(
    private readonly host: DemoHost,
    private readonly stage: Stage,
    parent: Group,
    private readonly accent: () => readonly [number, number, number],
  ) {
    parent.add(this.right.object, this.left.object);
    this.rest.set(stage.x + 0.3, EYE_HEIGHT - 0.5, stage.z - 0.22);
    this.performance = new Track(this.script());
    this.camera = new Track(this.cameraScript());
    this.applyCamera(OPENING);
  }

  update(dt: number): void {
    this.right.setColor(this.accent());
    this.left.setColor(this.accent());
    this.camera.update(dt);
    this.performance.update(dt);
    this.updateMenu(dt);
    if (this.performance.finished) this.restart();
  }

  /** The film loops, so a long recording never runs out. */
  private restart(): void {
    this.key = OPENING;
    this.performance = new Track(this.script());
    this.camera = new Track(this.cameraScript());
  }

  private cameraScript(): Segment[] {
    return [
      this.hold(9),
      this.moveCamera(POV, 5),
      this.hold(20),
      this.moveCamera(ROOM_SHOT, 2),
      this.hold(10.5),
      this.moveCamera(MENU_SHOT, 1.8),
      this.hold(11),
      this.moveCamera(RAISED, 6),
      this.moveCamera(LOW_ORBIT, 18),
      this.moveCamera(HIGH_ORBIT, 24),
      this.moveCamera(POV, 6),
      this.hold(5),
      this.moveCamera(OPENING, 7),
      this.hold(4),
    ];
  }

  private hold(duration: number): Segment {
    return {
      duration,
      update: () => this.applyCamera(this.key),
    };
  }

  private moveCamera(to: CameraKey, duration: number): Segment {
    let from = this.key;
    return {
      duration,
      begin: () => {
        from = this.key;
      },
      update: (progress) => {
        const t = ease(progress);
        const mix = (a: number, b: number) => a + (b - a) * t;
        this.applyCamera({
          angle: mix(from.angle, to.angle),
          radius: mix(from.radius, to.radius),
          height: mix(from.height, to.height),
          lookHeight: mix(from.lookHeight, to.lookHeight),
          lookAhead: mix(from.lookAhead, to.lookAhead),
          lookRight: mix(from.lookRight ?? 0, to.lookRight ?? 0),
        });
      },
      end: () => {
        this.key = to;
      },
    };
  }

  private applyCamera(key: CameraKey): void {
    const { stage } = this;
    this.cameraPosition.set(
      stage.x + Math.sin(key.angle) * key.radius,
      key.height,
      stage.z + Math.cos(key.angle) * key.radius,
    );
    this.cameraTarget.set(
      stage.x + (key.lookRight ?? 0),
      key.lookHeight,
      stage.z - key.lookAhead,
    );
    this.cameraForward
      .subVectors(this.cameraTarget, this.cameraPosition)
      .normalize();
    this.cameraUp
      .set(0, 1, 0)
      .addScaledVector(this.cameraForward, -this.cameraForward.y)
      .normalize();
    this.host.setCamera(this.cameraPosition, this.cameraTarget);
  }

  private script(): Segment[] {
    const segments: Segment[] = [wait(13)];
    for (const slot of HAND_PLACED) segments.push(...this.place(slot));
    segments.push(wait(1.5));
    segments.push(...this.raise({ step: 1, degree: 7, band: 0 }, 9));
    segments.push(wait(1.5));
    // Three throws at the room, the moment the video is really about.
    for (const [slot, direction] of ROOM_THROWS) {
      segments.push(...this.throwOrb(slot, direction));
      segments.push(wait(1.2));
    }
    segments.push(wait(2));
    segments.push(...this.menuScene());
    segments.push(wait(1));
    for (const slot of BLOOM) {
      segments.push({
        duration: 0.55,
        end: () => this.host.addOrb(slot),
      });
    }
    segments.push(wait(3));
    // Hands down: the lights fall and orbly takes over the song.
    segments.push({ duration: 0, end: () => this.host.setConcert(true) });
    segments.push(wait(14));
    segments.push({ duration: 0, end: () => this.host.menuAction('scene') });
    segments.push(wait(14));
    segments.push({ duration: 0, end: () => this.host.setConcert(false) });
    segments.push(wait(4));
    segments.push({
      duration: 0,
      end: () => this.host.setStarfield(true),
    });
    segments.push(wait(8));
    segments.push({ duration: 0, end: () => this.host.menuAction('scene') });
    segments.push(wait(8));
    segments.push(wait(3));
    segments.push({
      duration: 1.2,
      end: () => {
        this.host.clearAll();
        this.host.setStarfield(false);
      },
    });
    segments.push(wait(3));
    return segments;
  }

  /**
   * Fingers across the view with the back of the hand towards the camera:
   * pointing straight at the goal would foreshorten the hand into a blob.
   */
  private aimRight(): void {
    this.fingers.set(-0.8, 0.08, -0.6).normalize();
    this.palm.set(-0.25, -0.9, -0.2);
    handQuaternion(this.fingers, this.palm, this.rightPose.quaternion);
  }

  /** Puts the right ghost's fingertip on `goal`. */
  private poseRight(pinch: number, fold: number, opacity: number): void {
    const { rightPose, tip } = this;
    rightPose.pinch = pinch;
    rightPose.fold = fold;
    this.aimRight();
    rightPose.position.set(0, 0, 0);
    this.right.pinchPoint(rightPose, tip);
    rightPose.position.subVectors(this.goal, tip);
    this.right.apply(rightPose);
    this.right.opacity = opacity;
  }

  private reach(duration: number, from: Vector3, to: Vector3): Segment {
    return {
      duration,
      update: (progress) => {
        const t = ease(progress);
        this.goal.lerpVectors(from, to, t);
        this.poseRight(0, 0, Math.min(1, progress * 3));
      },
    };
  }

  private place(slot: Slot): Segment[] {
    const target = new Vector3();
    const start = new Vector3();
    let id = -1;
    const stage = this.stage;
    return [
      {
        duration: 0.9,
        begin: () => {
          slotToPosition(slot, stage, target);
          start.copy(target);
          start.y -= 0.06;
          start.x += 0.03;
        },
        update: (progress) => {
          this.goal.lerpVectors(this.rest, start, ease(progress));
          this.poseRight(0, 0, Math.min(1, progress * 3));
        },
      },
      {
        duration: 0.22,
        update: (progress) => this.poseRight(ease(progress), 0, 1),
        end: () => {
          id = this.host.create(this.goal);
          if (id >= 0) this.host.beginDrag(id);
        },
      },
      {
        duration: 0.7,
        update: (progress) => {
          this.goal.lerpVectors(start, target, ease(progress));
          this.poseRight(1, 0, 1);
          if (id >= 0) this.host.drag(id, this.goal);
        },
      },
      {
        duration: 0.2,
        begin: () => {
          if (id >= 0) this.host.drop(id, this.goal);
        },
        update: (progress) => this.poseRight(1 - ease(progress), 0, 1),
      },
      {
        duration: 0.75,
        update: (progress) => {
          this.goal.lerpVectors(target, this.rest, ease(progress));
          this.poseRight(0, 0, 1 - ease(progress * 1.4 - 0.4));
        },
      },
    ];
  }

  /** Grabs an orb and lifts it, so the pitch audibly rises. */
  private raise(slot: Slot, toDegree: number): Segment[] {
    const target = new Vector3();
    const stage = this.stage;
    const lifted = new Vector3();
    return [
      {
        duration: 0.9,
        begin: () => {
          slotToPosition(slot, stage, target);
          slotToPosition({ ...slot, degree: toDegree }, stage, lifted);
          this.held = this.host.orbAt(slot);
        },
        update: (progress) => {
          this.goal.lerpVectors(this.rest, target, ease(progress));
          this.poseRight(0, 0, Math.min(1, progress * 3));
        },
      },
      {
        duration: 0.22,
        update: (progress) => this.poseRight(ease(progress), 0, 1),
        end: () => {
          if (this.held >= 0) this.host.beginDrag(this.held);
        },
      },
      {
        duration: 1.2,
        update: (progress) => {
          this.goal.lerpVectors(target, lifted, ease(progress));
          this.poseRight(1, 0, 1);
          if (this.held >= 0) this.host.drag(this.held, this.goal);
        },
      },
      {
        duration: 0.22,
        begin: () => {
          if (this.held >= 0) this.host.drop(this.held, this.goal);
          this.held = -1;
        },
        update: (progress) => this.poseRight(1 - ease(progress), 0, 1),
      },
      {
        duration: 0.8,
        update: (progress) => {
          this.goal.lerpVectors(lifted, this.rest, ease(progress));
          this.poseRight(0, 0, 1 - ease(progress * 1.4 - 0.4));
        },
      },
    ];
  }

  /** Grabs an orb, winds up and throws it at the room. */
  private throwOrb(slot: Slot, direction: Vector3): Segment[] {
    const target = new Vector3();
    const flung = new Vector3();
    const velocity = new Vector3();
    const stage = this.stage;
    return [
      {
        duration: 1,
        begin: () => {
          slotToPosition(slot, stage, target);
          this.held = this.host.orbAt(slot);
          flung.copy(target).addScaledVector(direction, 0.32);
          velocity.copy(direction).multiplyScalar(2.6);
        },
        update: (progress) => {
          this.goal.lerpVectors(this.rest, target, ease(progress));
          this.poseRight(0, 0, Math.min(1, progress * 3));
        },
      },
      {
        duration: 0.25,
        update: (progress) => this.poseRight(ease(progress), 0, 1),
        end: () => {
          if (this.held >= 0) this.host.beginDrag(this.held);
        },
      },
      {
        duration: 0.2,
        update: (progress) => {
          this.goal.lerpVectors(target, flung, progress * progress);
          this.poseRight(1, 0, 1);
          if (this.held >= 0) this.host.drag(this.held, this.goal);
        },
        end: () => {
          if (this.held >= 0) this.host.fling(this.held, velocity);
          this.held = -1;
        },
      },
      {
        duration: 0.9,
        update: (progress) => {
          this.goal.lerpVectors(flung, this.rest, ease(progress));
          this.poseRight(1 - ease(progress * 3), 0, 1 - ease(progress));
        },
      },
    ];
  }

  private menuScene(): Segment[] {
    const segments: Segment[] = [
      {
        duration: 1.3,
        update: (progress) => this.poseLeft(ease(progress), Math.min(1, progress * 3)),
        end: () => {
          this.menuOpen = true;
        },
      },
      wait(0.9),
    ];
    for (const action of ['faster', 'faster', 'scene'] as const) {
      segments.push(...this.poke(action));
    }
    segments.push({
      duration: 0.9,
      begin: () => {
        this.fingerActive = false;
      },
      update: (progress) => {
        this.goal.lerpVectors(this.tip, this.rest, ease(progress));
        this.poseRight(0, 1 - progress, 1 - progress);
      },
    });
    segments.push(wait(0.6));
    segments.push({
      duration: 1,
      begin: () => {
        this.menuOpen = false;
      },
      update: (progress) => this.poseLeft(1 - ease(progress), 1 - ease(progress)),
    });
    return segments;
  }

  /** Presses a palm-menu button with the ghost index finger, for real. */
  private poke(action: MenuAction): Segment[] {
    const button = new Vector3();
    const front = new Vector3();
    const start = new Vector3();
    const { menu } = this.host;
    const updateFront = () => {
      menu.buttonPosition(action, button);
      front.set(0, 0, 1).applyQuaternion(menu.object.quaternion);
    };
    return [
      {
        duration: 0.8,
        begin: () => {
          start.copy(this.goal);
          this.fingerActive = true;
        },
        update: (progress) => {
          updateFront();
          this.to.copy(button).addScaledVector(front, 0.05);
          this.goal.lerpVectors(start, this.to, ease(progress));
          this.poseRight(0, 1, 1);
        },
      },
      {
        duration: 0.22,
        update: (progress) => {
          updateFront();
          const depth = 0.05 - 0.058 * ease(progress);
          this.goal.copy(button).addScaledVector(front, depth);
          this.poseRight(0, 1, 1);
        },
      },
      {
        duration: 0.32,
        update: (progress) => {
          updateFront();
          const depth = -0.008 + 0.058 * ease(progress);
          this.goal.copy(button).addScaledVector(front, depth);
          this.poseRight(0, 1, 1);
        },
      },
    ];
  }

  /** Rolls the left ghost hand from palm-down to palm-up. */
  private poseLeft(turn: number, opacity: number): void {
    const { leftPose, stage } = this;
    polarToPosition(-0.5, 0.3, stage, leftPose.position);
    leftPose.position.y = EYE_HEIGHT - 0.32;
    polarToPosition(0.35, 1, { ...stage, x: 0, z: 0 }, this.fingers);
    this.fingers.y = 0.12;
    const roll = turn * Math.PI;
    const side = this.from
      .set(0, 1, 0)
      .cross(this.fingers)
      .normalize()
      .negate();
    this.palm.set(0, -1, 0).multiplyScalar(Math.cos(roll));
    this.palm.addScaledVector(side, -Math.sin(roll)).normalize();
    handQuaternion(this.fingers, this.palm, leftPose.quaternion);
    this.left.apply(leftPose);
    this.left.opacity = opacity;
  }

  private updateMenu(dt: number): void {
    const { menu } = this.host;
    const palm = this.leftPose.position;
    this.palmCenter.copy(palm);
    const view = {
      position: this.cameraPosition,
      forward: this.cameraForward,
      up: this.cameraUp,
    };
    menu.setOpen(this.menuOpen, this.palmCenter, view);
    menu.update(
      this.palmCenter,
      view,
      this.fingerActive ? this.goal : null,
      dt,
    );
  }
}
