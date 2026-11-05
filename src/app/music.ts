/** The sound side of the app: engine, clock and sequencer working together. */

import { AudioEngine, OPEN_BRIGHTNESS } from '../audio/engine';
import { StepClock } from '../audio/clock';
import { degreeToMidi } from '../audio/scale';
import { ConcertArranger } from '../sequencer/concert';
import { FlashQueue, NO_ORB, NoteEvent, Sequencer } from '../sequencer/player';
import { stepToAngle, Vec3Like } from '../sequencer/mapping';
import { Slot } from '../sequencer/mapping';
import { OrbData } from '../state/composition';
import { CompositionStore } from '../state/store';

const TICK_MS = 25;
/** Marks a moment with notes, for the room-wide light pulse. */
export const BEAT_FLASH = -1;
const PREVIEW_BAND = 0;

export class Music {
  readonly audio = new AudioEngine();
  readonly clock: StepClock;
  readonly flashes = new FlashQueue();
  private readonly sequencer: Sequencer;
  private timer: ReturnType<typeof setInterval> | null = null;
  private userPaused = false;
  private arranger: ConcertArranger | null = null;

  constructor(
    store: CompositionStore,
    isHeld: (orbId: number) => boolean,
  ) {
    this.clock = new StepClock({
      now: () => this.audio.currentTime,
      onStep: (step, time) => this.onStep(step, time),
      bpm: store.bpm,
    });
    this.sequencer = new Sequencer(store, isHeld, (note) => this.play(note));
  }

  get paused(): boolean {
    return this.userPaused;
  }

  get inConcert(): boolean {
    return this.arranger !== null;
  }

  /** How full the concert is right now, 0 to 1. Drives the light. */
  get concertEnergy(): number {
    return this.arranger?.section.energy ?? 0;
  }

  /** Sits back and lets the arranger play, or hands the loop straight back. */
  setConcert(on: boolean, seed: number): void {
    if (on === this.inConcert) return;
    this.arranger = on ? new ConcertArranger(seed) : null;
    this.sequencer.setArranger(this.arranger);
    this.audio.setAmbience(on ? 1 : 0);
    this.audio.setBrightness(OPEN_BRIGHTNESS);
  }

  /** Unlocks audio from a user gesture. */
  unlock(): void {
    this.audio.unlock();
    this.syncDelay();
  }

  /** Starts the loop unless the user had paused it. */
  run(): void {
    if (this.timer === null) {
      // The interval only plans ahead; timing comes from the audio clock.
      this.timer = setInterval(() => this.clock.tick(), TICK_MS);
    }
    if (!this.userPaused) this.clock.start();
  }

  halt(): void {
    this.clock.stop();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flashes.clear();
  }

  setPaused(paused: boolean): void {
    this.userPaused = paused;
    if (paused) {
      this.clock.stop();
      this.flashes.clear();
    } else {
      this.clock.start();
    }
  }

  setBpm(bpm: number): void {
    this.clock.setBpm(bpm);
    this.syncDelay();
  }

  /** Plays an orb right now, as feedback for dropping it. */
  sound(orb: OrbData): void {
    const { audio, clock } = this;
    audio.playOrb(
      orb.id,
      degreeToMidi(orb.degree, orb.band),
      orb.band,
      audio.currentTime + 0.012,
      clock.stepDuration,
      0.9,
    );
  }

  /** A short, quiet blip of the pitch at `slot` while dragging. */
  preview(slot: Slot): void {
    this.audio.pitchBlip(degreeToMidi(slot.degree, PREVIEW_BAND));
  }

  beamAngle(): number {
    const heard = this.audio.currentTime - this.audio.latency;
    return stepToAngle(this.clock.position(heard));
  }

  /** Fires visuals for the notes that are reaching the ears now. */
  drainFlashes(flash: (orbId: number) => void): void {
    this.flashes.drain(this.audio.currentTime - this.audio.latency, flash);
  }

  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    this.audio.setListener(position, forward, up);
  }

  private syncDelay(): void {
    this.audio.setDelayTime(this.clock.stepDuration * 3);
  }

  private onStep(step: number, time: number): void {
    const played = this.sequencer.step(step, time, this.clock.stepDuration);
    if (played > 0) this.flashes.push(BEAT_FLASH, time);
    // The sound closes in the quiet sections and opens up at the peak.
    if (step === 0 && this.arranger !== null) {
      const energy = this.arranger.section.energy;
      this.audio.setBrightness(1500 + energy * energy * 13000);
    }
  }

  private play(note: Readonly<NoteEvent>): void {
    if (note.orbId === NO_ORB) {
      this.audio.playBacking(
        note.midi,
        note.band,
        note.time,
        this.clock.stepDuration,
        note.velocity,
      );
      return;
    }
    this.audio.playOrb(
      note.orbId,
      note.midi,
      note.band,
      note.time,
      this.clock.stepDuration,
      note.velocity,
    );
    this.flashes.push(note.orbId, note.time);
  }
}
