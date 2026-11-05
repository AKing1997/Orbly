import { describe, expect, it } from 'vitest';
import { makeStage, STEP_COUNT, Vec3Like } from '../sequencer/mapping';
import {
  kindForLabel,
  raycast,
  resolveSpot,
  roomSlot,
  snapToStep,
  stageEye,
  Surface,
  SURFACE_BAND,
  surfaceFromPlane,
  toSpot,
} from './surfaces';
import {
  assistAim,
  DOME_RADIUS,
  flightPosition,
  launchVelocity,
  planThrow,
} from './throw';

const stage = makeStage({ x: 0, y: 1.2, z: 0 }, 0, 0);
const eye = stageEye(stage);

/** A rectangle facing `normal`, centred on `center`. */
function rect(
  kind: Surface['kind'],
  center: Vec3Like,
  normal: Vec3Like,
  axisU: Vec3Like,
  axisV: Vec3Like,
  halfU: number,
  halfV: number,
): Surface {
  return {
    kind,
    origin: center,
    normal,
    axisU,
    axisV,
    outline: [-halfU, -halfV, halfU, -halfV, halfU, halfV, -halfU, halfV],
  };
}

const up = { x: 0, y: 1, z: 0 };
const sideways = { x: 1, y: 0, z: 0 };
const depth = { x: 0, y: 0, z: 1 };

/** A 5 m room around the user, 2.5 m tall, with a table straight ahead. */
const frontWall = rect('wall', { x: 0, y: 1.25, z: -2.5 }, depth, sideways, up, 2.5, 1.25);
const rightWall = rect('wall', { x: 2.5, y: 1.25, z: 0 }, { x: -1, y: 0, z: 0 }, depth, up, 2.5, 1.25);
const floor = rect('floor', { x: 0, y: 0, z: 0 }, up, sideways, depth, 2.5, 2.5);
const table = rect('table', { x: 0, y: 0.75, z: -1.2 }, up, sideways, depth, 0.6, 0.4);
const room = [frontWall, rightWall, floor, table];

describe('kindForLabel', () => {
  it('sorts real labels into instruments', () => {
    expect(kindForLabel('floor', 'horizontal')).toBe('floor');
    expect(kindForLabel('table', 'horizontal')).toBe('table');
    expect(kindForLabel('couch', 'horizontal')).toBe('soft');
    expect(kindForLabel('wall', 'vertical')).toBe('wall');
    expect(kindForLabel('wall art', 'vertical')).toBe('wall');
    expect(kindForLabel('ceiling', 'horizontal')).toBe('wall');
  });

  it('falls back on orientation for unknown labels', () => {
    expect(kindForLabel('other', 'horizontal')).toBe('table');
    expect(kindForLabel(undefined, 'vertical')).toBe('wall');
    expect(kindForLabel(undefined, undefined)).toBe('wall');
  });
});

describe('surfaceFromPlane', () => {
  it('reads the pose and outline of a detected plane', () => {
    const polygon = [
      { x: -1, y: 0, z: -1 },
      { x: 1, y: 0, z: -1 },
      { x: 1, y: 0, z: 1 },
      { x: -1, y: 0, z: 1 },
      { x: -1, y: 0, z: -1 },
    ];
    // Identity rotation at height 0.7: a table top with +Y up.
    const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.7, -2, 1];
    const surface = surfaceFromPlane(polygon, matrix, 'table', 'horizontal');
    const hit = raycast([surface], { x: 0, y: 2, z: -2 }, { x: 0, y: -1, z: 0 }, 5);
    expect(hit?.point.y).toBeCloseTo(0.7);
    expect(hit?.kind).toBe('table');
    expect(hit?.flat).toBe(true);
  });
});

describe('raycast', () => {
  it('finds the nearest surface and faces its normal to the ray', () => {
    const hit = raycast(room, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10);
    expect(hit?.kind).toBe('wall');
    expect(hit?.point.x).toBeCloseTo(2.5);
    expect(hit?.normal.x).toBeCloseTo(-1);
  });

  it('flips the normal when hitting a surface from behind', () => {
    const hit = raycast([frontWall], { x: 0, y: 1, z: -4 }, { x: 0, y: 0, z: 1 }, 10);
    expect(hit?.normal.z).toBeCloseTo(-1);
  });

  it('stops at a table in front of the wall', () => {
    const down = Math.hypot(1.2, 0.45);
    const hit = raycast(room, eye, { x: 0, y: -0.45 / down, z: -1.2 / down }, 10);
    expect(hit?.kind).toBe('table');
  });

  it('misses outside the outline and beyond the range', () => {
    expect(raycast([table], { x: 3, y: 2, z: -1.2 }, { x: 0, y: -1, z: 0 }, 5)).toBeNull();
    expect(raycast([frontWall], { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 1)).toBeNull();
  });

  it('ignores a ray running along a surface', () => {
    expect(raycast([floor], { x: 0, y: 0.5, z: 0 }, { x: 1, y: 0, z: 0 }, 9)).toBeNull();
  });

  it('accepts outlines that repeat their first point, like real planes', () => {
    const closed = { ...frontWall, outline: [...frontWall.outline, -2.5, -1.25] };
    expect(raycast([closed], { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, 5)).not.toBeNull();
  });
});

describe('roomSlot', () => {
  const wallPoint = (x: number, y: number) => ({
    point: { x, y, z: -2.5 },
    normal: depth,
    kind: 'wall' as const,
    flat: false,
  });

  it('gives each kind of surface its own instrument', () => {
    expect(new Set(Object.values(SURFACE_BAND)).size).toBe(5);
    expect(roomSlot(wallPoint(0, 1), stage).band).toBe(SURFACE_BAND.wall);
  });

  it('maps a wall point to the step of its angle', () => {
    expect(roomSlot(wallPoint(0, 1), stage).step).toBe(0);
    expect(
      roomSlot({ ...wallPoint(0, 1), point: { x: 2.5, y: 1, z: 0 } }, stage).step,
    ).toBe(4);
  });

  it('rises in pitch up a wall', () => {
    const low = roomSlot(wallPoint(0, 0.4), stage).degree;
    const high = roomSlot(wallPoint(0, 2.2), stage).degree;
    expect(high).toBeGreaterThan(low);
  });

  it('rises in pitch across a flat surface, where height cannot help', () => {
    const flat = (z: number) => ({
      point: { x: 0, y: 0.75, z },
      normal: up,
      kind: 'table' as const,
      flat: true,
    });
    expect(roomSlot(flat(-1.5), stage).degree).toBeGreaterThan(
      roomSlot(flat(-0.8), stage).degree,
    );
  });

  it('keeps the degree on the grid for any point', () => {
    for (const y of [-5, 0, 1, 40]) {
      const { degree } = roomSlot(wallPoint(0, y), stage);
      expect(degree).toBeGreaterThanOrEqual(0);
      expect(degree).toBeLessThanOrEqual(10);
    }
  });
});

describe('spots', () => {
  const landing = raycast(room, eye, { x: 0.6, y: 0.1, z: -0.79 }, 10);

  it('stays exactly in place in the same room', () => {
    const point = landing?.point as Vec3Like;
    const resolved = resolveSpot(toSpot(point, stage), stage, room);
    expect(resolved.point.x).toBeCloseTo(point.x);
    expect(resolved.point.y).toBeCloseTo(point.y);
    expect(resolved.point.z).toBeCloseTo(point.z);
    expect(resolved.kind).toBe('wall');
  });

  it('keeps a wall orb behind the table on its wall', () => {
    const point = { x: 0, y: 0.5, z: -2.5 };
    expect(resolveSpot(toSpot(point, stage), stage, room).kind).toBe('wall');
  });

  it('lands on whatever is in that direction in another room', () => {
    const point = { x: 0, y: 1.1, z: -2.5 };
    const nearbyWall = rect('wall', { x: 0, y: 1.25, z: -1 }, depth, sideways, up, 2, 1.25);
    const resolved = resolveSpot(toSpot(point, stage), stage, [nearbyWall]);
    expect(resolved.point.z).toBeCloseTo(-1);
  });

  it('turns into a floating orb in a room with no data', () => {
    const point = { x: 0, y: 1.1, z: -2.5 };
    const resolved = resolveSpot(toSpot(point, stage), stage, []);
    expect(resolved.kind).toBe('air');
    expect(resolved.point.z).toBeCloseTo(-2.5);
  });

  it('follows a turned stage', () => {
    const turned = makeStage({ x: 1, y: 1.2, z: -1 }, 0.8, 0);
    const point = { x: 2, y: 1.4, z: -3 };
    const resolved = resolveSpot(toSpot(point, turned), turned, []);
    expect(resolved.point.x).toBeCloseTo(2);
    expect(resolved.point.y).toBeCloseTo(1.4);
    expect(resolved.point.z).toBeCloseTo(-3);
  });
});

describe('snapToStep', () => {
  it('moves a landing onto the exact angle of its step', () => {
    const hit = raycast(room, eye, { x: 0.2, y: 0, z: -0.98 }, 10);
    const snapped = snapToStep(hit as NonNullable<typeof hit>, stage, room);
    const { azimuth } = toSpot(snapped.point, stage);
    const step = (azimuth / (Math.PI * 2)) * STEP_COUNT;
    expect(step).toBeCloseTo(Math.round(step), 5);
  });

  it('never moves an orb in mid-air', () => {
    const hit = { point: { x: 1, y: 1, z: 1 }, normal: up, kind: 'air' as const, flat: false };
    expect(snapToStep(hit, stage, room)).toBe(hit);
  });

  it('stays put rather than jump to another surface', () => {
    const edge = rect('table', { x: 0.1, y: 0.75, z: -1 }, up, sideways, depth, 0.06, 0.06);
    const hit = {
      point: { x: 0.14, y: 0.75, z: -1 },
      normal: up,
      kind: 'table' as const,
      flat: true,
    };
    expect(snapToStep(hit, stage, [edge, floor])).toBe(hit);
  });
});

describe('assistAim', () => {
  const gaze = { x: 0, y: 0, z: -1 };

  it('leans a throw towards where the user is looking', () => {
    const aimed = assistAim({ x: 1, y: 0, z: -1 }, gaze);
    expect(Math.abs(aimed.x)).toBeLessThan(Math.abs(aimed.z));
    expect(aimed.x).toBeGreaterThan(0);
  });

  it('keeps the speed of the throw', () => {
    const aimed = assistAim({ x: 1, y: 0.5, z: -2 }, gaze);
    expect(Math.hypot(aimed.x, aimed.y, aimed.z)).toBeCloseTo(Math.hypot(1, 0.5, 2));
  });

  it('leaves a throw alone when it goes somewhere else on purpose', () => {
    const sideways = { x: 2, y: 0, z: 0 };
    expect(assistAim(sideways, gaze)).toBe(sideways);
  });

  it('survives a release with no speed', () => {
    const still = { x: 0, y: 0, z: 0 };
    expect(assistAim(still, gaze)).toBe(still);
  });
});

describe('planThrow', () => {
  const hand = { x: 0.2, y: 1.0, z: -0.4 };

  it('boosts a slow flick and caps a wild one', () => {
    const speed = (v: Vec3Like) => Math.hypot(v.x, v.y, v.z);
    expect(speed(launchVelocity({ x: 0, y: 0, z: -1.6 }))).toBeGreaterThan(3);
    expect(speed(launchVelocity({ x: 0, y: 0, z: -40 }))).toBeLessThanOrEqual(7);
  });

  it('keeps the direction of the throw', () => {
    const launch = launchVelocity({ x: 2, y: 0, z: 0 });
    expect(launch.x).toBeGreaterThan(0);
    expect(launch.z).toBe(0);
  });

  it('lands on the wall it was thrown at', () => {
    const plan = planThrow(hand, { x: 0, y: 0.3, z: -2 }, room, eye, 0);
    expect(plan.hit.kind).toBe('wall');
    expect(plan.hit.point.z).toBeCloseTo(-2.5, 1);
    expect(plan.duration).toBeGreaterThan(0);
    expect(plan.duration).toBeLessThan(1.5);
  });

  it('lands on a table in the way', () => {
    const plan = planThrow({ x: 0, y: 0.95, z: -0.3 }, { x: 0, y: -0.5, z: -1.6 }, room, eye, 0);
    expect(plan.hit.kind).toBe('table');
  });

  it('ends its flight exactly at the landing point', () => {
    const plan = planThrow(hand, { x: 1.5, y: 0.5, z: -1 }, room, eye, 0);
    const end = flightPosition(plan, plan.duration, { x: 0, y: 0, z: 0 });
    expect(end.x).toBeCloseTo(plan.hit.point.x, 1);
    expect(end.y).toBeCloseTo(plan.hit.point.y, 1);
    expect(end.z).toBeCloseTo(plan.hit.point.z, 1);
  });

  it('falls back to a dome without room data', () => {
    const plan = planThrow(hand, { x: 0, y: 0.6, z: -2 }, [], eye, 0);
    expect(plan.hit.kind).toBe('air');
    const { x, y, z } = plan.hit.point;
    expect(Math.hypot(x - eye.x, y - eye.y, z - eye.z)).toBeCloseTo(DOME_RADIUS, 0);
  });

  it('still finds the floor without room data', () => {
    const plan = planThrow(hand, { x: 0, y: -3, z: -0.5 }, [], eye, 0);
    expect(plan.hit.kind).toBe('floor');
    expect(plan.hit.point.y).toBe(0);
  });

  it('stops at a sensible distance after missing everything', () => {
    const plan = planThrow(hand, { x: 0, y: 4, z: 0 }, [floor], eye, 0);
    expect(plan.hit.kind).toBe('air');
  });

  it('handles a release with no measurable speed', () => {
    const plan = planThrow(hand, { x: 0, y: 0, z: 0 }, room, eye, 0);
    expect(Number.isFinite(plan.duration)).toBe(true);
  });
});
