/**
 * Lookahead step clock (the "tale of two clocks" pattern).
 *
 * A coarse timer calls `tick()`, and each step is scheduled ahead of time on
 * the sample-accurate audio clock. Timer jitter or a slow frame only changes
 * *when we plan* a note, never *when it sounds*. `now` is injected, so the
 * clock runs in tests without an AudioContext.
 */

import { STEP_COUNT } from '../sequencer/mapping';

export type StepCallback = (step: number, time: number) => void;

export interface ClockOptions {
  /** Current time in seconds on the audio clock. */
  now: () => number;
  onStep: StepCallback;
  /** How far ahead steps are scheduled, in seconds. */
  lookahead?: number;
  bpm?: number;
}

interface Anchor {
  time: number;
  step: number;
  stepDuration: number;
}

/** Each step is an eighth note, so 16 steps span two bars. */
export function stepDurationFor(bpm: number): number {
  return 60 / bpm / 2;
}

export class StepClock {
  private readonly now: () => number;
  private readonly onStep: StepCallback;
  private readonly lookahead: number;
  private bpmValue: number;
  private isRunning = false;
  private nextStep = 0;
  private nextTime = 0;
  private current: Anchor = { time: 0, step: 0, stepDuration: 0 };
  private previous: Anchor | null = null;
  private pendingStepDuration: number | null = null;
  private pausedPosition = 0;

  constructor(options: ClockOptions) {
    this.now = options.now;
    this.onStep = options.onStep;
    this.lookahead = options.lookahead ?? 0.16;
    this.bpmValue = options.bpm ?? 84;
    this.current.stepDuration = stepDurationFor(this.bpmValue);
  }

  get running(): boolean {
    return this.isRunning;
  }

  get bpm(): number {
    return this.bpmValue;
  }

  get stepDuration(): number {
    return stepDurationFor(this.bpmValue);
  }

  /** Starts from where the clock was paused, with a small safety delay. */
  start(delay = 0.08): void {
    if (this.isRunning) return;
    const stepDuration = stepDurationFor(this.bpmValue);
    const position = this.pausedPosition;
    const whole = Math.max(0, Math.ceil(position - 1e-6));
    // The next whole step lands after the delay plus the rest of the step
    // that was interrupted, so resuming never replays or skips a note.
    const time = this.now() + delay + (whole - position) * stepDuration;
    this.current = { time, step: whole, stepDuration };
    this.nextStep = whole % STEP_COUNT;
    this.nextTime = time;
    this.previous = null;
    this.pendingStepDuration = null;
    this.isRunning = true;
    this.tick();
  }

  stop(): void {
    if (!this.isRunning) return;
    this.pausedPosition = this.position() % STEP_COUNT;
    this.isRunning = false;
  }

  /** Jumps to a step; takes effect on the next `start()`. */
  seek(step: number): void {
    this.pausedPosition = ((step % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
  }

  /** Changes tempo from the next unscheduled step, without any jump. */
  setBpm(bpm: number): void {
    this.bpmValue = bpm;
    const stepDuration = stepDurationFor(bpm);
    if (this.isRunning) this.pendingStepDuration = stepDuration;
    else this.current.stepDuration = stepDuration;
  }

  /** Schedules every step that falls inside the lookahead window. */
  tick(): void {
    if (!this.isRunning) return;
    const now = this.now();
    const horizon = now + this.lookahead;
    while (this.nextTime < horizon) {
      this.applyPendingTempo();
      // After a stall, drop the notes that are already late instead of
      // firing them all at once; the grid stays intact.
      if (this.nextTime >= now - 0.01) {
        this.onStep(this.nextStep, this.nextTime);
      }
      this.nextStep = (this.nextStep + 1) % STEP_COUNT;
      this.nextTime += this.current.stepDuration;
    }
  }

  /** Fractional step at a time on the audio clock. Drives the beam. */
  position(time: number = this.now()): number {
    if (!this.isRunning) return this.pausedPosition;
    const anchor =
      this.previous !== null && time < this.current.time
        ? this.previous
        : this.current;
    const position =
      anchor.step + (time - anchor.time) / anchor.stepDuration;
    return ((position % STEP_COUNT) + STEP_COUNT) % STEP_COUNT;
  }

  private applyPendingTempo(): void {
    if (this.pendingStepDuration === null) return;
    this.previous = this.current;
    this.current = {
      time: this.nextTime,
      step: this.nextStep,
      stepDuration: this.pendingStepDuration,
    };
    this.pendingStepDuration = null;
  }
}
