import { describe, expect, it } from 'vitest';
import { Vec3Like } from '../sequencer/mapping';
import {
  createHandJoints,
  HandJoints,
  Handedness,
  palmNormal,
  PalmUpDetector,
  PinchDetector,
  PINCH_OFF_DISTANCE,
  PINCH_ON_DISTANCE,
  VelocityTracker,
} from './gestures';
import { GrabController, OrbHost, THROW_SPEED } from './grab';

const DT = 1 / 72;

/**
 * Builds a hand in the shape real tracking reports: fingers along `fingers`,
 * the palm facing `palm`, thumb on the correct side for each hand.
 */
function simulateHand(
  handedness: Handedness,
  palm: Vec3Like,
  fingers: Vec3Like,
  curl = 0,
  origin: Vec3Like = { x: -0.15, y: 1.0, z: -0.35 },
): HandJoints {
  const hand = createHandJoints();
  const side = {
    x: palm.y * fingers.z - palm.z * fingers.y,
    y: palm.z * fingers.x - palm.x * fingers.z,
    z: palm.x * fingers.y - palm.y * fingers.x,
  };
  // Palm up with fingers forward, a left thumb points left (-X): that is the
  // direction of palm x fingers. A right thumb points the other way.
  const thumbSign = handedness === 'left' ? 1 : -1;
  const at = (along: number, across: number) => ({
    x: origin.x + fingers.x * along + side.x * across * thumbSign,
    y: origin.y + fingers.y * along + side.y * across * thumbSign,
    z: origin.z + fingers.z * along + side.z * across * thumbSign,
  });
  const reach = 0.18 * (1 - curl * 0.65);
  hand.wrist = at(0, 0);
  hand.indexMeta = at(0.09, 0.025);
  hand.middleMeta = at(0.095, 0.002);
  hand.pinkyMeta = at(0.08, -0.04);
  hand.thumbTip = at(0.07, 0.08);
  hand.indexTip = at(reach, 0.03);
  hand.middleTip = at(reach + 0.005, 0.005);
  hand.ringTip = at(reach - 0.005, -0.018);
  hand.pinkyTip = at(reach - 0.03, -0.04);
  return hand;
}

const up = { x: 0, y: 1, z: 0 };
const down = { x: 0, y: -1, z: 0 };
const forward = { x: 0, y: 0, z: -1 };
const head = { x: 0, y: 1.25, z: 0 };

describe('PinchDetector', () => {
  const feed = (detector: PinchDetector, gaps: (number | null)[]) =>
    gaps.map((gap) => detector.update(gap, DT).active);

  it('fires one start and one end edge', () => {
    const detector = new PinchDetector();
    let starts = 0;
    let ends = 0;
    for (const gap of [0.06, 0.01, 0.01, 0.01, 0.01, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06]) {
      const edges = detector.update(gap, DT);
      if (edges.started) starts++;
      if (edges.ended) ends++;
    }
    expect(starts).toBe(1);
    expect(ends).toBe(1);
  });

  it('ignores a single noisy frame while open', () => {
    const detector = new PinchDetector();
    expect(feed(detector, [0.06, 0.01, 0.06, 0.06]).some(Boolean)).toBe(false);
  });

  it('does not flicker while the gap sits between the thresholds', () => {
    const detector = new PinchDetector();
    feed(detector, [0.01, 0.01, 0.01, 0.01]);
    const mid = (PINCH_ON_DISTANCE + PINCH_OFF_DISTANCE) / 2;
    const noisy = Array.from({ length: 40 }, (_, i) =>
      mid + (i % 2 === 0 ? 0.006 : -0.006),
    );
    expect(feed(detector, noisy).every(Boolean)).toBe(true);
  });

  it('never starts from the gap between the thresholds', () => {
    const detector = new PinchDetector();
    const mid = (PINCH_ON_DISTANCE + PINCH_OFF_DISTANCE) / 2;
    expect(feed(detector, new Array(30).fill(mid)).some(Boolean)).toBe(false);
  });

  it('survives a brief tracking loss but lets go after a longer one', () => {
    const detector = new PinchDetector();
    feed(detector, [0.01, 0.01, 0.01, 0.01]);
    expect(feed(detector, [null, null, null]).every(Boolean)).toBe(true);
    expect(feed(detector, [0.01]).every(Boolean)).toBe(true);
    const lost = feed(detector, new Array(30).fill(null));
    expect(lost[lost.length - 1]).toBe(false);
  });

  it('maps a digital button straight to the edges', () => {
    const detector = new PinchDetector();
    expect(detector.updateButton(true, DT).started).toBe(true);
    expect(detector.updateButton(true, DT).started).toBe(false);
    expect(detector.updateButton(false, DT).ended).toBe(true);
  });
});

describe('palmNormal', () => {
  it('points out of the palm for each hand', () => {
    const n: Vec3Like = { x: 0, y: 0, z: 0 };
    for (const handedness of ['left', 'right'] as const) {
      palmNormal(simulateHand(handedness, up, forward), handedness, n);
      expect(n.y).toBeGreaterThan(0.9);
      palmNormal(simulateHand(handedness, down, forward), handedness, n);
      expect(n.y).toBeLessThan(-0.9);
    }
  });
});

describe('PalmUpDetector', () => {
  const run = (
    detector: PalmUpDetector,
    hand: HandJoints | null,
    seconds: number,
    pinching = false,
  ) => {
    let result = false;
    for (let t = 0; t < seconds; t += DT) {
      result = detector.update(hand, 'left', head, pinching, DT);
    }
    return result;
  };

  it('opens after a short dwell with the palm up', () => {
    const detector = new PalmUpDetector();
    const hand = simulateHand('left', up, forward);
    expect(run(detector, hand, 0.05)).toBe(false);
    expect(run(detector, hand, 0.3)).toBe(true);
  });

  it('stays closed for a palm facing down', () => {
    const detector = new PalmUpDetector();
    expect(run(detector, simulateHand('left', down, forward), 1)).toBe(false);
  });

  it('stays closed for a fist, even if it faces up', () => {
    const detector = new PalmUpDetector();
    expect(run(detector, simulateHand('left', up, forward, 1), 1)).toBe(false);
  });

  it('stays closed while pinching', () => {
    const detector = new PalmUpDetector();
    expect(run(detector, simulateHand('left', up, forward), 1, true)).toBe(false);
  });

  it('stays closed for a hand far from the user', () => {
    const detector = new PalmUpDetector();
    const far = simulateHand('left', up, forward, 0, { x: 0, y: 1, z: -1.4 });
    expect(run(detector, far, 1)).toBe(false);
  });

  it('holds through a small wobble and closes when the hand turns over', () => {
    const detector = new PalmUpDetector();
    run(detector, simulateHand('left', up, forward), 0.5);
    const wobble = { x: 0.6, y: 0.8, z: 0 };
    expect(run(detector, simulateHand('left', wobble, forward), 0.5)).toBe(true);
    expect(run(detector, simulateHand('left', down, forward), 0.5)).toBe(false);
  });

  it('closes at once when tracking is lost', () => {
    const detector = new PalmUpDetector();
    run(detector, simulateHand('left', up, forward), 0.5);
    expect(detector.update(null, 'left', head, false, DT)).toBe(false);
  });
});

describe('VelocityTracker', () => {
  it('measures a steady hand speed', () => {
    const tracker = new VelocityTracker();
    for (let i = 0; i < 12; i++) {
      tracker.push(i * DT, { x: i * DT * 2, y: 0, z: 0 });
    }
    expect(tracker.velocity({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(2);
  });

  it('reports zero with too little data', () => {
    const tracker = new VelocityTracker();
    tracker.push(0, { x: 5, y: 0, z: 0 });
    expect(tracker.velocity({ x: 1, y: 1, z: 1 })).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('forgets old movement once the hand stops', () => {
    const tracker = new VelocityTracker();
    for (let i = 0; i < 10; i++) tracker.push(i * DT, { x: i, y: 0, z: 0 });
    for (let i = 10; i < 30; i++) tracker.push(i * DT, { x: 9, y: 0, z: 0 });
    expect(tracker.velocity({ x: 0, y: 0, z: 0 }).x).toBeCloseTo(0);
  });
});

describe('GrabController', () => {
  class FakeHost implements OrbHost {
    log: string[] = [];
    orbs = new Map<number, Vec3Like>();
    private nextId = 1;
    pick(point: Vec3Like, radius: number): number {
      for (const [id, orb] of this.orbs) {
        if (Math.hypot(orb.x - point.x, orb.y - point.y, orb.z - point.z) <= radius) {
          return id;
        }
      }
      return -1;
    }
    create(point: Vec3Like): number {
      const id = this.nextId++;
      this.orbs.set(id, { ...point });
      this.log.push(`create ${id}`);
      return id;
    }
    beginDrag(id: number): void {
      this.log.push(`begin ${id}`);
    }
    drag(id: number, point: Vec3Like): void {
      this.orbs.set(id, { ...point });
    }
    drop(id: number): void {
      this.log.push(`drop ${id}`);
    }
    discard(id: number): void {
      this.orbs.delete(id);
      this.log.push(`discard ${id}`);
    }
    setHover(_hand: number, id: number): void {
      this.log.push(`hover ${id}`);
    }
  }

  const open = { active: false, started: false, ended: false };
  const start = { active: true, started: true, ended: false };
  const hold = { active: true, started: false, ended: false };
  const end = { active: false, started: false, ended: true };

  const setup = () => {
    const host = new FakeHost();
    return { host, grab: new GrabController(0, host) };
  };

  it('creates an orb when pinching empty air and drags it', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    expect(host.log).toEqual(['create 1', 'begin 1']);
    grab.update({ x: 0.1, y: 1, z: -0.3 }, hold, true, DT, DT);
    expect(host.orbs.get(1)?.x).toBeCloseTo(0.1);
    expect(grab.held).toBe(1);
  });

  it('grabs a nearby orb instead of creating a new one', () => {
    const { host, grab } = setup();
    host.orbs.set(9, { x: 0, y: 1, z: -0.3 });
    grab.update({ x: 0.03, y: 1, z: -0.3 }, start, true, 0, DT);
    expect(host.log).toContain('begin 9');
    expect(host.log.some((line) => line.startsWith('create'))).toBe(false);
  });

  it('shows hover before contact and clears it on grab', () => {
    const { host, grab } = setup();
    host.orbs.set(9, { x: 0, y: 1, z: -0.3 });
    grab.update({ x: 0.09, y: 1, z: -0.3 }, open, true, 0, DT);
    expect(host.log).toEqual(['hover 9']);
    grab.update({ x: 0.03, y: 1, z: -0.3 }, start, true, DT, DT);
    expect(host.log).toEqual(['hover 9', 'hover -1', 'begin 9']);
  });

  it('drops the orb on a calm release', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    for (let i = 1; i < 30; i++) {
      grab.update({ x: i * 0.001, y: 1, z: -0.3 }, hold, true, i * DT, DT);
    }
    grab.update({ x: 0.03, y: 1, z: -0.3 }, end, true, 30 * DT, DT);
    expect(host.log.at(-1)).toBe('drop 1');
    expect(grab.held).toBe(-1);
  });

  it('discards the orb on a fast release', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    const speed = THROW_SPEED * 1.5;
    for (let i = 1; i <= 24; i++) {
      const x = i * DT * speed;
      grab.update({ x, y: 1, z: -0.3 }, i === 24 ? end : hold, true, i * DT, DT);
    }
    expect(host.log.at(-1)).toBe('discard 1');
  });

  it('does not read a jerky tap as a throw', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    grab.update({ x: 0.03, y: 1, z: -0.3 }, hold, true, DT, DT);
    grab.update({ x: 0.06, y: 1, z: -0.3 }, end, true, 2 * DT, DT);
    expect(host.log.at(-1)).toBe('drop 1');
  });

  it('does nothing with a pinch while the hand is on the UI', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, false, 0, DT);
    expect(host.log).toEqual([]);
  });

  it('releases safely when the hand disappears', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    grab.update(null, open, true, DT, DT);
    expect(host.log.at(-1)).toBe('drop 1');
    expect(grab.held).toBe(-1);
  });
});
