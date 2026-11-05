import { describe, expect, it } from 'vitest';
import { makeStage, Vec3Like } from '../sequencer/mapping';
import { HeadView, isInComfortZone, keepInView } from './comfort';
import { homeSpot, HOME_SPOTS } from './home-layout';
import { PINCH_SPOT, PALM_SPOT, SKIP_SPOT, TutorialSpot } from './tutorial-layout';
import { polarToPosition } from '../sequencer/mapping';

const view: HeadView = {
  position: { x: 0, y: 1.2, z: 0 },
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
};

/** At `depth` metres ahead, `side` and `lift` metres off the view axis. */
const ahead = (side: number, lift: number, depth: number): Vec3Like => ({
  x: side,
  y: 1.2 + lift,
  z: -depth,
});

describe('isInComfortZone', () => {
  it('accepts what is straight ahead', () => {
    expect(isInComfortZone(ahead(0, 0, 0.6), view, 0.1, 0.1)).toBe(true);
  });

  it('rejects what is too far to a side', () => {
    expect(isInComfortZone(ahead(0.5, 0, 0.5), view, 0.01, 0.01)).toBe(false);
    expect(isInComfortZone(ahead(-0.5, 0, 0.5), view, 0.01, 0.01)).toBe(false);
  });

  it('allows more room below the eyes than above', () => {
    expect(isInComfortZone(ahead(0, -0.35, 0.5), view, 0.01, 0.01)).toBe(true);
    expect(isInComfortZone(ahead(0, 0.35, 0.5), view, 0.01, 0.01)).toBe(false);
  });

  it('judges corners, not centres', () => {
    expect(isInComfortZone(ahead(0.3, 0, 0.5), view, 0.01, 0.01)).toBe(true);
    expect(isInComfortZone(ahead(0.3, 0, 0.5), view, 0.1, 0.01)).toBe(false);
  });

  it('rejects anything behind the user', () => {
    expect(isInComfortZone(ahead(0, 0, -0.5), view, 0.01, 0.01)).toBe(false);
  });

  it('turns with the head', () => {
    const lookingRight: HeadView = { ...view, forward: { x: 1, y: 0, z: 0 } };
    expect(isInComfortZone({ x: 0.6, y: 1.2, z: 0 }, lookingRight, 0.05, 0.05)).toBe(true);
    expect(isInComfortZone(ahead(0, 0, 0.6), lookingRight, 0.05, 0.05)).toBe(false);
  });
});

describe('keepInView', () => {
  const panel = { halfWidth: 0.12, halfHeight: 0.09 };
  const distanceFromEyes = (p: Vec3Like) => Math.hypot(p.x, p.y - 1.2, p.z);

  it('leaves alone what is already in view', () => {
    const point = ahead(0.05, -0.1, 0.5);
    const before = { ...point };
    expect(keepInView(point, view, panel.halfWidth, panel.halfHeight)).toEqual(before);
  });

  it('brings a panel in from the side, at the same distance', () => {
    const point = ahead(-0.45, -0.05, 0.3);
    const distance = distanceFromEyes(point);
    keepInView(point, view, panel.halfWidth, panel.halfHeight);
    expect(isInComfortZone(point, view, panel.halfWidth, panel.halfHeight)).toBe(true);
    expect(point.x).toBeLessThan(0);
    expect(distanceFromEyes(point)).toBeCloseTo(distance);
  });

  it('brings down a panel that is too high', () => {
    const point = ahead(0, 0.4, 0.4);
    keepInView(point, view, panel.halfWidth, panel.halfHeight);
    expect(isInComfortZone(point, view, panel.halfWidth, panel.halfHeight)).toBe(true);
  });

  it('brings up a panel that is too low', () => {
    const point = ahead(0, -0.6, 0.3);
    keepInView(point, view, panel.halfWidth, panel.halfHeight);
    expect(isInComfortZone(point, view, panel.halfWidth, panel.halfHeight)).toBe(true);
  });

  it('brings something behind the user round to the front', () => {
    const point = ahead(0.3, 0, -0.4);
    keepInView(point, view, 0.05, 0.05);
    expect(point.z).toBeLessThan(0);
  });

  it('copes with something too big to fit', () => {
    const point = ahead(0.4, 0, 0.3);
    keepInView(point, view, 1, 1);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });

  it('follows a tilted head', () => {
    const tilt = Math.sin(0.5);
    const down: HeadView = {
      ...view,
      forward: { x: 0, y: -tilt, z: -Math.cos(0.5) },
      up: { x: 0, y: Math.cos(0.5), z: -tilt },
    };
    const point = ahead(0.5, 0.2, 0.3);
    keepInView(point, down, panel.halfWidth, panel.halfHeight);
    expect(isInComfortZone(point, down, panel.halfWidth, panel.halfHeight)).toBe(true);
  });
});

describe('what the layouts promise', () => {
  const stage = makeStage({ x: 0, y: 1.2, z: 0 }, 0, 0);
  const placed = (azimuth: number, radius: number, drop: number): Vec3Like => {
    const point = { x: 0, y: 1.2 - drop, z: 0 };
    return polarToPosition(azimuth, radius, stage, point);
  };

  it('fits the whole home screen in view, with all six saves', () => {
    for (let index = 0; index <= HOME_SPOTS; index++) {
      const spot = homeSpot(index);
      const center = placed(spot.azimuth, spot.reach, spot.drop);
      expect(isInComfortZone(center, view, spot.radius, spot.radius)).toBe(true);
    }
  });

  it('never overlaps two spheres of the home screen', () => {
    for (let a = 0; a <= HOME_SPOTS; a++) {
      for (let b = a + 1; b <= HOME_SPOTS; b++) {
        const first = homeSpot(a);
        const second = homeSpot(b);
        const p = placed(first.azimuth, first.reach, first.drop);
        const q = placed(second.azimuth, second.reach, second.drop);
        expect(Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)).toBeGreaterThan(
          first.radius + second.radius,
        );
      }
    }
  });

  it('keeps every sphere within seated reach', () => {
    for (let index = 0; index <= HOME_SPOTS; index++) {
      const spot = homeSpot(index);
      expect(Math.hypot(spot.reach, spot.drop)).toBeLessThanOrEqual(0.6);
    }
  });

  it('keeps the tutorial in view', () => {
    const inView = (spot: TutorialSpot) =>
      isInComfortZone(
        placed(spot.azimuth, spot.radius, spot.drop),
        view,
        spot.halfSize,
        spot.halfSize,
      );
    expect(inView(SKIP_SPOT)).toBe(true);
    expect(inView(PINCH_SPOT)).toBe(true);
    expect(inView(PALM_SPOT)).toBe(true);
  });
});
