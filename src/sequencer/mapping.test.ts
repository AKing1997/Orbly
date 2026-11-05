import { describe, expect, it } from 'vitest';
import {
  BAND_RADII,
  bandForRadius,
  canCreateAt,
  clampToStage,
  DEGREE_COUNT,
  DEGREE_HEIGHT,
  makeStage,
  MAX_RADIUS,
  nearestFreeSlot,
  positionToSlot,
  slotToPosition,
  STEP_COUNT,
  Vec3Like,
  wrapStep,
} from './mapping';

const stage = makeStage({ x: 0, y: 1.2, z: 0 }, 0);
const point = (): Vec3Like => ({ x: 0, y: 0, z: 0 });

describe('position to step', () => {
  it('puts step 0 straight ahead (-Z) and advances clockwise', () => {
    const y = stage.baseY;
    expect(positionToSlot({ x: 0, y, z: -0.4 }, stage).step).toBe(0);
    expect(positionToSlot({ x: 0.4, y, z: 0 }, stage).step).toBe(4);
    expect(positionToSlot({ x: 0, y, z: 0.4 }, stage).step).toBe(8);
    expect(positionToSlot({ x: -0.4, y, z: 0 }, stage).step).toBe(12);
  });

  it('quantizes to the nearest step and wraps past the last one', () => {
    const justBeforeTop = -((Math.PI * 2) / STEP_COUNT) * 0.4;
    const p = {
      x: Math.sin(justBeforeTop) * 0.4,
      y: stage.baseY,
      z: -Math.cos(justBeforeTop) * 0.4,
    };
    expect(positionToSlot(p, stage).step).toBe(0);
  });

  it('follows the yaw of the stage', () => {
    // The user faces +X: yaw of -90 degrees in three.js terms.
    const turned = makeStage({ x: 1, y: 1.2, z: 2 }, -Math.PI / 2);
    const y = turned.baseY;
    expect(positionToSlot({ x: 1.4, y, z: 2 }, turned).step).toBe(0);
    expect(positionToSlot({ x: 1, y, z: 2.4 }, turned).step).toBe(4);
  });
});

describe('position to note and instrument', () => {
  it('maps height to a degree and clamps it to the grid', () => {
    const at = (y: number) =>
      positionToSlot({ x: 0, y, z: -0.4 }, stage).degree;
    expect(at(stage.baseY)).toBe(0);
    expect(at(stage.baseY + DEGREE_HEIGHT * 3)).toBe(3);
    expect(at(stage.baseY + DEGREE_HEIGHT * 3.4)).toBe(3);
    expect(at(stage.baseY - 1)).toBe(0);
    expect(at(stage.baseY + 5)).toBe(DEGREE_COUNT - 1);
  });

  it('maps distance to one of the three instruments', () => {
    expect(bandForRadius(0.2)).toBe(0);
    expect(bandForRadius(0.4)).toBe(1);
    expect(bandForRadius(0.6)).toBe(2);
  });
});

describe('slot to position', () => {
  it('round-trips every cell of the grid', () => {
    const yawed = makeStage({ x: -0.3, y: 1.1, z: 0.7 }, 0.9);
    const p = point();
    for (let step = 0; step < STEP_COUNT; step++) {
      for (let degree = 0; degree < DEGREE_COUNT; degree++) {
        for (let band = 0; band < BAND_RADII.length; band++) {
          slotToPosition({ step, degree, band }, yawed, p);
          expect(positionToSlot(p, yawed)).toEqual({ step, degree, band });
        }
      }
    }
  });

  it('keeps every cell inside the seated reach', () => {
    const p = point();
    slotToPosition({ step: 3, degree: 0, band: 2 }, stage, p);
    expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(0.6);
  });
});

describe('playable volume', () => {
  it('clamps a dragged point to the maximum radius', () => {
    const p = clampToStage({ x: 3, y: stage.baseY, z: 0 }, stage);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(MAX_RADIUS);
  });

  it('ignores pinches from hands resting on the lap', () => {
    expect(canCreateAt({ x: 0, y: stage.baseY, z: -0.3 }, stage)).toBe(true);
    expect(canCreateAt({ x: 0, y: stage.baseY - 0.3, z: -0.3 }, stage)).toBe(
      false,
    );
  });
});

describe('collisions', () => {
  it('returns the wanted slot when it is free', () => {
    const slot = { step: 2, degree: 5, band: 1 };
    expect(nearestFreeSlot(slot, () => false)).toEqual(slot);
  });

  it('moves to the closest free degree when taken', () => {
    const taken = new Set(['5', '6']);
    const slot = nearestFreeSlot({ step: 2, degree: 5, band: 1 }, (_s, d) =>
      taken.has(String(d)),
    );
    expect(slot).toEqual({ step: 2, degree: 4, band: 1 });
  });

  it('gives up when the whole column is taken', () => {
    expect(
      nearestFreeSlot({ step: 0, degree: 0, band: 0 }, () => true),
    ).toBeNull();
  });
});

describe('wrapStep', () => {
  it('handles negative and overflowing steps', () => {
    expect(wrapStep(-1)).toBe(15);
    expect(wrapStep(16)).toBe(0);
  });
});
