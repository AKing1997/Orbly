/**
 * Turns clock steps into notes. It knows the composition and the note rules,
 * but talks to sound and light through two small callbacks, so it is testable
 * without Web Audio.
 */

import { degreeToMidi } from '../audio/scale';
import { OrbData } from '../state/composition';

export interface NoteEvent {
  orbId: number;
  midi: number;
  band: number;
  time: number;
  velocity: number;
}

export interface OrbSource {
  orbsAtStep(step: number, out: OrbData[]): OrbData[];
}

/** Stacked notes are turned down so a big chord does not clip. */
export function chordVelocity(noteCount: number): number {
  return 1 / Math.sqrt(Math.max(1, noteCount));
}

export class Sequencer {
  private readonly scratch: OrbData[] = [];
  private readonly event: NoteEvent = {
    orbId: 0,
    midi: 0,
    band: 0,
    time: 0,
    velocity: 1,
  };

  constructor(
    private readonly source: OrbSource,
    private readonly isMuted: (orbId: number) => boolean,
    private readonly play: (note: Readonly<NoteEvent>) => void,
  ) {}

  /** Plays one step. Returns how many notes sounded. */
  step(step: number, time: number): number {
    const orbs = this.source.orbsAtStep(step, this.scratch);
    const velocity = chordVelocity(orbs.length);
    let played = 0;
    for (let i = 0; i < orbs.length; i++) {
      const orb = orbs[i];
      if (this.isMuted(orb.id)) continue;
      this.event.orbId = orb.id;
      this.event.midi = degreeToMidi(orb.degree, orb.band);
      this.event.band = orb.band;
      this.event.time = time;
      this.event.velocity = velocity;
      this.play(this.event);
      played++;
    }
    return played;
  }
}

/**
 * Notes are scheduled ahead of time; this holds them until they are actually
 * heard so the orb flashes on the note, not 150 ms early. It is a fixed ring
 * and allocates nothing while playing.
 */
export class FlashQueue {
  private readonly ids: Int32Array;
  private readonly times: Float64Array;
  private readHead = 0;
  private writeHead = 0;
  private count = 0;

  constructor(private readonly capacity = 128) {
    this.ids = new Int32Array(capacity);
    this.times = new Float64Array(capacity);
  }

  push(orbId: number, time: number): void {
    if (this.count === this.capacity) return;
    this.ids[this.writeHead] = orbId;
    this.times[this.writeHead] = time;
    this.writeHead = (this.writeHead + 1) % this.capacity;
    this.count++;
  }

  /** Calls `flash` for every note due by `now`. */
  drain(now: number, flash: (orbId: number) => void): void {
    while (this.count > 0 && this.times[this.readHead] <= now) {
      flash(this.ids[this.readHead]);
      this.readHead = (this.readHead + 1) % this.capacity;
      this.count--;
    }
  }

  clear(): void {
    this.readHead = 0;
    this.writeHead = 0;
    this.count = 0;
  }
}
