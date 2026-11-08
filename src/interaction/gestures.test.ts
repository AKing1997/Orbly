import { describe, expect, it } from 'vitest';
import { Vec3Like } from '../sequencer/mapping';
import {
  AIM_DWELL,
  AimDwell,
  createHandJoints,
  LISTEN_AFTER,
  ListeningDetector,
  ListeningHand,
  HandJoints,
  Handedness,
  palmNormal,
  pinchCloseness,
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

  it('flags the release while it is being debounced', () => {
    const detector = new PinchDetector();
    feed(detector, [0.01, 0.01, 0.01, 0.01]);
    expect(detector.update(0.06, DT).opening).toBe(true);
    let edges = detector.update(0.06, DT);
    while (!edges.ended) edges = detector.update(0.06, DT);
    expect(edges.opening).toBe(false);
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

describe('pinchCloseness', () => {
  it('stays dark with the fingers apart', () => {
    expect(pinchCloseness(0.12)).toBe(0);
    expect(pinchCloseness(null)).toBe(0);
  });

  it('grows as the fingers close', () => {
    expect(pinchCloseness(0.04)).toBeGreaterThan(pinchCloseness(0.06));
  });

  it('is full just as the pinch fires, and stays there', () => {
    expect(pinchCloseness(PINCH_ON_DISTANCE)).toBe(1);
    expect(pinchCloseness(0.002)).toBe(1);
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

  it('stays open through a brief loss of tracking, then closes', () => {
    const detector = new PalmUpDetector();
    run(detector, simulateHand('left', up, forward), 0.5);
    expect(run(detector, null, 0.2)).toBe(true);
    expect(run(detector, null, 0.4)).toBe(false);
  });
});

describe('AimDwell', () => {
  const hold = (aim: AimDwell, id: number, seconds: number) => {
    let result = -1;
    for (let t = 0; t < seconds; t += DT) result = aim.update(id, DT);
    return result;
  };

  it('ignores a hand just passing over an orb', () => {
    expect(hold(new AimDwell(), 3, AIM_DWELL * 0.5)).toBe(-1);
  });

  it('accepts a hand that keeps pointing', () => {
    expect(hold(new AimDwell(), 3, AIM_DWELL * 1.5)).toBe(3);
  });

  it('starts over when the hand moves to another orb', () => {
    const aim = new AimDwell();
    hold(aim, 3, AIM_DWELL * 1.5);
    expect(hold(aim, 4, AIM_DWELL * 0.5)).toBe(-1);
  });

  it('lets go soon after the hand stops pointing', () => {
    const aim = new AimDwell();
    hold(aim, 3, AIM_DWELL * 1.5);
    expect(hold(aim, -1, 0.12)).toBe(-1);
  });

  it('starts over after a real pause, not a lost frame', () => {
    const aim = new AimDwell();
    hold(aim, 3, AIM_DWELL * 0.8);
    hold(aim, -1, 0.2);
    expect(hold(aim, 3, AIM_DWELL * 0.5)).toBe(-1);
  });

  it('never reports pointing at nothing', () => {
    expect(hold(new AimDwell(), -1, 5)).toBe(-1);
  });
});

describe('ListeningDetector', () => {
  const REST_Y = 0.7;
  const none: ListeningHand = { position: null, pinching: false };
  const held = (y: number, pinching = false): ListeningHand => ({
    position: { x: 0.2, y, z: -0.3 },
    pinching,
  });

  /** Feeds the same hands, optionally drifting, for a while. */
  const run = (
    detector: ListeningDetector,
    seconds: number,
    hand: (t: number) => ListeningHand,
    allowed = true,
  ) => {
    let result = false;
    for (let t = 0; t < seconds; t += DT) {
      result = detector.update([hand(t), none], REST_Y, allowed, DT);
    }
    return result;
  };
  const waving = (t: number) => held(1.0 + Math.sin(t * 8) * 0.1);

  it('starts when the hands drop out of tracking', () => {
    const detector = new ListeningDetector();
    expect(run(detector, LISTEN_AFTER * 0.9, () => none)).toBe(false);
    expect(run(detector, LISTEN_AFTER * 0.2, () => none)).toBe(true);
  });

  it('starts when the hands rest on the lap, even if they fidget', () => {
    const detector = new ListeningDetector();
    const fidgeting = (t: number) => held(0.55 + Math.sin(t * 8) * 0.05);
    expect(run(detector, LISTEN_AFTER * 1.1, fidgeting)).toBe(true);
  });

  it('starts for hands held perfectly still in the air', () => {
    const detector = new ListeningDetector();
    expect(run(detector, LISTEN_AFTER * 1.1, () => held(1.0))).toBe(true);
  });

  it('ignores the tiny jitter of hand tracking', () => {
    const detector = new ListeningDetector();
    const jitter = (t: number) => held(1.0 + Math.sin(t * 70) * 0.0003);
    expect(run(detector, LISTEN_AFTER * 1.1, jitter)).toBe(true);
  });

  it('never starts while a hand is playing', () => {
    const detector = new ListeningDetector();
    expect(run(detector, LISTEN_AFTER * 2, waving)).toBe(false);
  });

  it('restarts the wait after any movement', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 0.8, () => none);
    run(detector, 0.4, waving);
    expect(run(detector, LISTEN_AFTER * 0.8, () => none)).toBe(false);
  });

  it('ends when a hand comes up and moves', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 1.1, () => none);
    expect(run(detector, 0.4, waving)).toBe(false);
  });

  it('ends at once on a pinch, even low down', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 1.1, () => none);
    expect(detector.update([held(0.5, true), none], REST_Y, true, DT)).toBe(false);
  });

  it('survives a brief twitch', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 1.1, () => held(1.0));
    expect(run(detector, 0.04, (t) => held(1.0 + t))).toBe(true);
  });

  it('does not wake for a hand reappearing on the lap', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 1.1, () => none);
    expect(run(detector, 1, (t) => held(0.5 + t * 0.05))).toBe(true);
  });

  it('stops and resets when not allowed', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 1.1, () => none);
    expect(run(detector, 0.1, () => none, false)).toBe(false);
    expect(run(detector, LISTEN_AFTER * 0.5, () => none)).toBe(false);
  });

  it('watches both hands', () => {
    const detector = new ListeningDetector();
    run(detector, LISTEN_AFTER * 1.1, () => none);
    for (let t = 0; t < 0.4; t += DT) {
      detector.update([none, waving(t)], REST_Y, true, DT);
    }
    expect(detector.isListening).toBe(false);
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
    far = -1;
    private nextId = 1;
    pickFar(): number {
      return this.far;
    }
    recall(id: number): void {
      this.log.push(`recall ${id}`);
    }
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
    dropped: Vec3Like | null = null;
    drop(id: number, point: Vec3Like): void {
      this.dropped = { ...point };
      this.log.push(`drop ${id}`);
    }
    fling(id: number): void {
      this.log.push(`fling ${id}`);
    }
    setHover(_hand: number, id: number): void {
      this.log.push(`hover ${id}`);
    }
  }

  const open = { active: false, started: false, ended: false, opening: false };
  const start = { active: true, started: true, ended: false, opening: false };
  const hold = { active: true, started: false, ended: false, opening: false };
  const parting = { active: true, started: false, ended: false, opening: true };
  const end = { active: false, started: false, ended: true, opening: false };

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

  it('calls back the orb the hand points at instead of creating one', () => {
    const { host, grab } = setup();
    host.far = 7;
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    expect(host.log).toContain('recall 7');
    expect(host.log).toContain('begin 7');
    expect(host.log.some((line) => line.startsWith('create'))).toBe(false);
    expect(grab.held).toBe(7);
  });

  it('prefers an orb within reach over one it points at', () => {
    const { host, grab } = setup();
    host.far = 7;
    host.orbs.set(9, { x: 0, y: 1, z: -0.3 });
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    expect(host.log).toContain('begin 9');
    expect(host.log).not.toContain('recall 7');
  });

  it('lights up the far orb before the pinch, as a promise of what it takes', () => {
    const { host, grab } = setup();
    host.far = 7;
    grab.update({ x: 0, y: 1, z: -0.3 }, open, true, 0, DT);
    expect(host.log).toEqual(['hover 7']);
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

  it('throws the orb on a fast release', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    const speed = THROW_SPEED * 1.5;
    for (let i = 1; i <= 24; i++) {
      const x = i * DT * speed;
      grab.update({ x, y: 1, z: -0.3 }, i === 24 ? end : hold, true, i * DT, DT);
    }
    expect(host.log.at(-1)).toBe('fling 1');
  });

  it('reads the speed from when the fingers parted, not from the edge', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    const speed = THROW_SPEED * 1.5;
    let x = 0;
    let t = 0;
    for (let i = 1; i <= 16; i++) {
      t = i * DT;
      x = t * speed;
      grab.update({ x, y: 1, z: -0.3 }, hold, true, t, DT);
    }
    // The fingers part, then the hand stops dead during the debounce.
    t += DT;
    x += DT * speed;
    grab.update({ x, y: 1, z: -0.3 }, parting, true, t, DT);
    for (let i = 0; i < 12; i++) {
      t += DT;
      grab.update({ x, y: 1, z: -0.3 }, parting, true, t, DT);
    }
    grab.update({ x, y: 1, z: -0.3 }, end, true, t + DT, DT);
    expect(host.log.at(-1)).toBe('fling 1');
  });

  it('drops the orb where it was before the fingers parted', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    for (let i = 1; i < 30; i++) {
      grab.update({ x: 0, y: 1, z: -0.3 }, hold, true, i * DT, DT);
    }
    grab.update({ x: 0, y: 1.05, z: -0.3 }, parting, true, 30 * DT, DT);
    grab.update({ x: 0, y: 1.06, z: -0.3 }, parting, true, 31 * DT, DT);
    grab.update({ x: 0, y: 1.07, z: -0.3 }, end, true, 32 * DT, DT);
    expect(host.dropped?.y).toBeCloseTo(1);
    expect(host.orbs.get(1)?.y).toBeCloseTo(1);
  });

  it('measures the throw on the steady point, not the jumping pinch', () => {
    const { host, grab } = setup();
    const still = { x: 0, y: 1, z: -0.3 };
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT, still);
    let t = 0;
    for (let i = 1; i <= 16; i++) {
      t = i * DT;
      grab.update({ x: 0, y: 1, z: -0.3 }, hold, true, t, DT, still);
    }
    // Fingers open: the midpoint between them leaps, but the hand has not moved.
    grab.update({ x: 0, y: 1.2, z: -0.3 }, parting, true, t + DT, DT, still);
    grab.update({ x: 0, y: 1.2, z: -0.3 }, end, true, t + 2 * DT, DT, still);
    expect(host.log.at(-1)).toBe('drop 1');
  });

  it('keeps an orb that was moved fast and let go after stopping', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    let t = 0;
    for (let i = 1; i <= 16; i++) {
      t = i * DT;
      grab.update({ x: t * 3, y: 1, z: -0.3 }, hold, true, t, DT);
    }
    const x = t * 3;
    for (let i = 0; i < 20; i++) {
      t += DT;
      grab.update({ x, y: 1, z: -0.3 }, hold, true, t, DT);
    }
    grab.update({ x, y: 1, z: -0.3 }, parting, true, t + DT, DT);
    grab.update({ x, y: 1, z: -0.3 }, end, true, t + 2 * DT, DT);
    expect(host.log.at(-1)).toBe('drop 1');
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

  it('throws an orb whose hand vanished mid-swing', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    const speed = THROW_SPEED * 1.5;
    let t = 0;
    for (let i = 1; i <= 20; i++) {
      t = i * DT;
      grab.update({ x: t * speed, y: 1, z: -0.3 }, hold, true, t, DT);
    }
    grab.update(null, hold, true, t + DT, DT);
    expect(host.log.at(-1)).not.toMatch(/fling|drop/);
    grab.update(null, end, true, t + 2 * DT, DT);
    expect(host.log.at(-1)).toBe('fling 1');
  });

  it('releases safely when the hand disappears', () => {
    const { host, grab } = setup();
    grab.update({ x: 0, y: 1, z: -0.3 }, start, true, 0, DT);
    grab.update(null, open, true, DT, DT);
    expect(host.log.at(-1)).toBe('drop 1');
    expect(grab.held).toBe(-1);
  });
});

/**
 * The tests above feed clean joints, like the emulator. Real hand tracking
 * trembles by a millimetre or two, sometimes puts a joint a couple of
 * centimetres off for a single frame, and loses a hand for a moment when it
 * moves fast or hides behind the other one. These replay the same gestures
 * through the same detectors with that noise on top, over many seeds.
 */
describe('with real-hand noise', () => {
  const SEEDS = 200;
  /** Millimetre-scale tremble on every joint, every frame. */
  const JITTER = 0.0015;
  const SPIKE_CHANCE = 1 / 90;
  const SPIKE = 0.02;

  /** Deterministic noise, so a failing seed can be replayed. */
  const random = (seed: number) => {
    let state = (seed * 2654435761) >>> 0;
    const next = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const gauss = () =>
      Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
    const shake = (p: Vec3Like, amount = JITTER): Vec3Like => {
      const spike = next() < SPIKE_CHANCE ? SPIKE : 0;
      return {
        x: p.x + gauss() * amount + spike,
        y: p.y + gauss() * amount,
        z: p.z + gauss() * amount,
      };
    };
    return { next, gauss, shake };
  };

  const CLOSED = 0.012;
  const OPEN = 0.065;
  /** Fingers that close at `from` and part at `to`, each over ~70 ms. */
  const pinchBetween = (from: number, to: number) => (t: number) => {
    const close = Math.min(1, Math.max(0, (t - from) / 0.07));
    const part = Math.min(1, Math.max(0, (t - to) / 0.07));
    return OPEN + (CLOSED - OPEN) * close + (OPEN - CLOSED) * part;
  };

  class Host implements OrbHost {
    flings = 0;
    drops = 0;
    creates = 0;
    pick(): number {
      return -1;
    }
    pickFar(): number {
      return -1;
    }
    create(): number {
      this.creates++;
      return this.creates;
    }
    beginDrag(): void {}
    recall(): void {}
    drag(): void {}
    drop(): void {
      this.drops++;
    }
    fling(): void {
      this.flings++;
    }
    setHover(): void {}
  }

  /**
   * One gesture through the pipeline the app runs every frame: thumb-index
   * gap into the pinch detector, its edges and the hand into the grab
   * controller. `lost` drops the hand out of tracking.
   */
  const perform = (
    seed: number,
    seconds: number,
    path: (t: number) => Vec3Like,
    gap: (t: number) => number,
    lost: (t: number) => boolean = () => false,
  ) => {
    const rng = random(seed);
    const host = new Host();
    const pinch = new PinchDetector();
    const grab = new GrabController(1, host);
    let starts = 0;
    for (let t = 0; t < seconds; t += DT) {
      if (lost(t)) {
        const edges = pinch.update(null, DT);
        grab.update(null, edges, true, t, DT, null);
        continue;
      }
      const hand = path(t);
      const steady = rng.shake(hand, JITTER * 0.6);
      const point = rng.shake({ x: hand.x, y: hand.y + 0.02, z: hand.z - 0.08 });
      const measured = Math.max(0.003, gap(t) + rng.gauss() * 0.002 +
        (rng.next() < SPIKE_CHANCE ? -0.03 : 0));
      const edges = pinch.update(measured, DT);
      if (edges.started) starts++;
      grab.update(point, edges, true, t, DT, steady);
    }
    return { host, starts, held: grab.held };
  };

  const rest = { x: 0.15, y: 1.0, z: -0.3 };
  const still = () => rest;
  const count = (run: (seed: number) => boolean) => {
    let passed = 0;
    for (let seed = 1; seed <= SEEDS; seed++) if (run(seed)) passed++;
    return passed;
  };

  it('never pinches an open hand by itself', () => {
    expect(count((seed) => perform(seed, 4, still, () => OPEN).starts === 0))
      .toBe(SEEDS);
  });

  it('holds one steady pinch as one pinch', () => {
    const passed = count((seed) => {
      const { starts, host } = perform(seed, 2, still, pinchBetween(0.2, 1.4));
      return starts === 1 && host.creates === 1 && host.drops === 1;
    });
    expect(passed).toBe(SEEDS);
  });

  it('places a slowly moved orb and never throws it', () => {
    const slow = (t: number) => ({ x: rest.x + Math.min(t, 1) * 0.12, y: rest.y, z: rest.z });
    const passed = count((seed) => {
      const { host } = perform(seed, 1.6, slow, pinchBetween(0.2, 1.1));
      return host.drops === 1 && host.flings === 0;
    });
    expect(passed).toBe(SEEDS);
  });

  /** Hold still, then swing forward at 2.6 m/s and let go mid-swing. */
  const SWING_AT = 0.5;
  const RELEASE_AT = 0.68;
  const swing = (t: number) => {
    const moving = Math.max(0, t - SWING_AT);
    const speed = 2.6;
    // Ramps up over 60 ms, then keeps going: a real throw.
    const travel = moving < 0.06
      ? (speed * moving * moving) / 0.12
      : speed * 0.03 + speed * (moving - 0.06);
    return { x: rest.x, y: rest.y + travel * 0.25, z: rest.z - travel };
  };

  it('throws on a fast release', () => {
    const passed = count((seed) => {
      const { host } = perform(seed, 1.4, swing, pinchBetween(0.1, RELEASE_AT));
      return host.flings === 1 && host.drops === 0;
    });
    expect(passed).toBe(SEEDS);
  });

  it('throws even when tracking drops out at the end of the swing', () => {
    // Fast hands blur: tracking goes 40 ms before the fingers open and only
    // comes back half a second later, with the hand already open.
    const passed = count((seed) => {
      const { host } = perform(
        seed,
        1.6,
        swing,
        pinchBetween(0.1, RELEASE_AT),
        (t) => t > RELEASE_AT - 0.04 && t < RELEASE_AT + 0.5,
      );
      return host.flings === 1 && host.drops === 0;
    });
    expect(passed).toBe(SEEDS);
  });

  it('throws when a short dropout swallows the moment of release', () => {
    // Back after 120 ms, fingers already apart: the release was never seen.
    const passed = count((seed) => {
      const { host } = perform(
        seed,
        1.6,
        swing,
        pinchBetween(0.1, RELEASE_AT),
        (t) => t > RELEASE_AT - 0.06 && t < RELEASE_AT + 0.06,
      );
      return host.flings === 1 && host.drops === 0;
    });
    expect(passed).toBe(SEEDS);
  });

  it('keeps an orb held through a brief dropout while dragging', () => {
    const slow = (t: number) => ({ x: rest.x + t * 0.05, y: rest.y, z: rest.z });
    const passed = count((seed) => {
      const { host, held } = perform(
        seed,
        1.2,
        slow,
        () => CLOSED,
        (t) => t > 0.5 && t < 0.62,
      );
      return held >= 0 && host.drops === 0 && host.flings === 0;
    });
    expect(passed).toBe(SEEDS);
  });

  const shakeHand = (hand: HandJoints, rng: ReturnType<typeof random>): HandJoints => {
    const out = createHandJoints();
    for (const key of Object.keys(hand) as (keyof HandJoints)[]) {
      out[key] = rng.shake(hand[key]);
    }
    return out;
  };

  it('keeps the palm menu open while the other hand reaches over it', () => {
    // Poking the menu hides the left hand from the cameras for a moment,
    // again and again. The menu must not blink shut under the finger.
    const palm = simulateHand('left', up, forward);
    const passed = count((seed) => {
      const rng = random(seed);
      const detector = new PalmUpDetector();
      let shut = false;
      for (let t = 0; t < 3; t += DT) {
        const covered = t > 0.6 && (t % 0.5) < 0.15 + (seed % 5) * 0.03;
        const open = detector.update(
          covered ? null : shakeHand(palm, rng),
          'left',
          head,
          false,
          DT,
        );
        if (t > 0.5 && !open) shut = true;
      }
      return !shut;
    });
    expect(passed).toBe(SEEDS);
  });

  it('still closes the palm menu when the hand is gone for good', () => {
    const detector = new PalmUpDetector();
    const palm = simulateHand('left', up, forward);
    for (let t = 0; t < 0.5; t += DT) detector.update(palm, 'left', head, false, DT);
    let open = true;
    for (let t = 0; t < 0.6; t += DT) open = detector.update(null, 'left', head, false, DT);
    expect(open).toBe(false);
  });

  it('starts the concert for hands held still in the air', () => {
    const passed = count((seed) => {
      const rng = random(seed);
      const detector = new ListeningDetector();
      const hand = { x: 0.2, y: 1.0, z: -0.3 };
      let listening = false;
      for (let t = 0; t < LISTEN_AFTER * 1.2; t += DT) {
        listening = detector.update(
          [
            { position: rng.shake(hand, JITTER * 0.6), pinching: false },
            { position: null, pinching: false },
          ],
          0.7,
          true,
          DT,
        );
      }
      return listening;
    });
    expect(passed).toBe(SEEDS);
  });

  it('keeps aiming at a far orb through single lost frames', () => {
    const passed = count((seed) => {
      const rng = random(seed);
      const aim = new AimDwell();
      for (let t = 0; t < AIM_DWELL + 0.25; t += DT) {
        const candidate = rng.next() < 0.06 ? -1 : 3;
        if (aim.update(candidate, DT) === 3) return true;
      }
      return false;
    });
    expect(passed).toBe(SEEDS);
  });
});
