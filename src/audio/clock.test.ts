import { describe, expect, it } from 'vitest';
import { StepClock, stepDurationFor } from './clock';

function makeClock(bpm = 120) {
  const state = { time: 0 };
  const steps: { step: number; time: number }[] = [];
  const clock = new StepClock({
    now: () => state.time,
    onStep: (step, time) => steps.push({ step, time }),
    lookahead: 0.1,
    bpm,
  });
  const advance = (seconds: number, dt = 0.025) => {
    const end = state.time + seconds;
    while (state.time < end) {
      state.time += dt;
      clock.tick();
    }
  };
  return { clock, state, steps, advance };
}

describe('StepClock', () => {
  it('schedules evenly spaced steps that are never late', () => {
    const { clock, steps, advance } = makeClock();
    clock.start(0);
    advance(4);
    const spacing = stepDurationFor(120);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].time - steps[i - 1].time).toBeCloseTo(spacing, 6);
    }
    expect(steps.length).toBeGreaterThan(14);
  });

  it('wraps after sixteen steps and never repeats one', () => {
    const { clock, steps, advance } = makeClock();
    clock.start(0);
    advance(10);
    steps.forEach((entry, index) => expect(entry.step).toBe(index % 16));
  });

  it('is immune to timer jitter', () => {
    const { clock, state, steps } = makeClock();
    clock.start(0);
    for (const dt of [0.01, 0.07, 0.03, 0.09, 0.02, 0.08, 0.05, 0.06]) {
      state.time += dt;
      clock.tick();
    }
    const spacing = stepDurationFor(120);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].time - steps[i - 1].time).toBeCloseTo(spacing, 6);
    }
  });

  it('keeps a stable grid across a long stall and drops the late notes', () => {
    const { clock, state, steps } = makeClock();
    clock.start(0);
    state.time = 5;
    clock.tick();
    const spacing = stepDurationFor(120);
    expect(steps[steps.length - 1].time).toBeGreaterThanOrEqual(4.98);
    expect((steps[steps.length - 1].time / spacing) % 1).toBeCloseTo(0, 5);
    expect(steps.length).toBeLessThan(5);
  });

  it('reports a continuous position for the beam', () => {
    const { clock, state, advance } = makeClock();
    clock.start(0);
    advance(1);
    const spacing = stepDurationFor(120);
    expect(clock.position(state.time)).toBeCloseTo(state.time / spacing, 5);
  });

  it('changes tempo at a step boundary with no jump in position', () => {
    const { clock, state, steps, advance } = makeClock();
    clock.start(0);
    advance(1);
    const before = clock.position();
    clock.setBpm(60);
    expect(clock.position()).toBeCloseTo(before, 6);
    advance(3);
    const last = steps.length - 1;
    expect(steps[last].time - steps[last - 1].time).toBeCloseTo(
      stepDurationFor(60),
      6,
    );
    expect(state.time).toBeGreaterThan(3.9);
  });

  it('resumes from where it paused without replaying a step', () => {
    const { clock, state, steps, advance } = makeClock();
    clock.start(0);
    advance(1.1);
    clock.stop();
    const paused = clock.position();
    const lastStep = steps[steps.length - 1].step;
    state.time += 30;
    expect(clock.position()).toBeCloseTo(paused, 6);
    clock.start(0);
    expect(clock.position()).toBeCloseTo(paused, 1);
    advance(0.5);
    expect(steps[steps.length - 1].step).toBeGreaterThan(lastStep);
    const stepsAfterPause = steps.map((entry) => entry.step);
    expect(new Set(stepsAfterPause).size).toBe(stepsAfterPause.length);
  });
});
