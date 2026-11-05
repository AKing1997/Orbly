import { describe, expect, it } from 'vitest';
import { OnboardingFlow } from './onboarding';
import { TouchTargets } from './touch';

const DT = 1 / 72;

describe('OnboardingFlow', () => {
  it('walks through the four steps in order', () => {
    const flow = new OnboardingFlow();
    expect(flow.step).toBe('pinch');
    expect(flow.orbSounded()).toBe(true);
    expect(flow.step).toBe('raise');
    expect(flow.orbRaised()).toBe(true);
    expect(flow.step).toBe('throw');
    expect(flow.orbThrown()).toBe(true);
    expect(flow.step).toBe('palm');
    expect(flow.menuOpened()).toBe(true);
    expect(flow.step).toBe('done');
  });

  it('ignores actions that belong to another step', () => {
    const flow = new OnboardingFlow();
    expect(flow.orbRaised()).toBe(false);
    expect(flow.orbThrown()).toBe(false);
    expect(flow.menuOpened()).toBe(false);
    expect(flow.step).toBe('pinch');
  });

  it('counts a repeated event only once', () => {
    const flow = new OnboardingFlow();
    flow.orbSounded();
    expect(flow.orbSounded()).toBe(false);
  });

  it('returns to step one when every orb is gone', () => {
    const flow = new OnboardingFlow();
    flow.orbSounded();
    expect(flow.orbsGone()).toBe(true);
    expect(flow.step).toBe('pinch');
  });

  it('also goes back from the throw step when no orb is left', () => {
    const flow = new OnboardingFlow();
    flow.orbSounded();
    flow.orbRaised();
    expect(flow.orbsGone()).toBe(true);
    expect(flow.step).toBe('pinch');
  });

  it('can be skipped from anywhere', () => {
    const flow = new OnboardingFlow();
    flow.skip();
    expect(flow.step).toBe('done');
  });
});

describe('TouchTargets', () => {
  const sphere = { x: 0, y: 1, z: -0.4, radius: 0.06 };
  const away = { x: 0.5, y: 1, z: 0 };
  const inside = { x: 0, y: 1, z: -0.38 };

  const rest = (targets: TouchTargets, seconds = 0.3) => {
    for (let t = 0; t < seconds; t += DT) {
      targets.update(0, away, away, false, DT);
    }
  };

  it('fires when a fingertip enters a sphere', () => {
    const targets = new TouchTargets([sphere]);
    rest(targets);
    expect(targets.update(0, inside, inside, false, DT)).toBe(0);
  });

  it('fires only once per touch', () => {
    const targets = new TouchTargets([sphere]);
    rest(targets);
    targets.update(0, inside, inside, false, DT);
    expect(targets.update(0, inside, inside, false, DT)).toBe(-1);
  });

  it('does not fire for a hand already inside when the screen appears', () => {
    const targets = new TouchTargets([sphere]);
    expect(targets.update(0, inside, inside, false, DT)).toBe(-1);
  });

  it('fires for a pinch beside the sphere', () => {
    const targets = new TouchTargets([sphere]);
    const beside = { x: 0.09, y: 1, z: -0.4 };
    expect(targets.update(0, beside, beside, true, DT)).toBe(0);
  });

  it('ignores a pinch far from every sphere', () => {
    const targets = new TouchTargets([sphere]);
    expect(targets.update(0, away, away, true, DT)).toBe(-1);
  });

  it('picks the closest of two spheres', () => {
    const targets = new TouchTargets([
      sphere,
      { x: 0.1, y: 1, z: -0.4, radius: 0.06 },
    ]);
    expect(targets.nearest({ x: 0.08, y: 1, z: -0.4 }, 0)).toBe(1);
  });

  it('forgets a hand that lost tracking', () => {
    const targets = new TouchTargets([sphere]);
    rest(targets);
    targets.update(0, null, away, false, DT);
    expect(targets.update(0, inside, inside, false, DT)).toBe(-1);
  });
});
