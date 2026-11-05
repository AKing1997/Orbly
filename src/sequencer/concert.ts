/**
 * Concert mode's arranger. While the user sits back it turns their loop into a
 * piece: layers enter and leave in sections, a few notes grow ornaments, and a
 * backing of chords, bass and pulse fills the space around them, so even one
 * orb becomes music. It only decides what sounds. The composition itself is
 * never touched, and raising a hand brings the plain loop straight back.
 *
 * Everything here works in scale degrees, so every note stays in key.
 */

import { Slot } from './mapping';

export type Role = 'melody' | 'harmony' | 'rhythm';

const ROLES: readonly Role[] = [
  'melody', // pluck
  'harmony', // pad
  'rhythm', // bass
  'melody', // bell, on walls
  'melody', // marimba, on tables
  'rhythm', // drum, on the floor
  'melody', // hum, on soft furniture
  'harmony', // air
];

export function roleOf(band: number): Role {
  return ROLES[band];
}

interface Section {
  name: string;
  loops: number;
  /** 0 is hushed, 1 is everything at once. Drives the light as well. */
  energy: number;
  /** Chance that an orb of each role plays on a given pass. */
  density: Record<Role, number>;
  /** Chance that a melody note grows an ornament. */
  ornament: number;
  /** Adds bass and pulse under the chords. */
  full: boolean;
}

export const SECTIONS: readonly Section[] = [
  {
    name: 'breath',
    loops: 2,
    energy: 0.35,
    density: { melody: 0.55, harmony: 1, rhythm: 0 },
    ornament: 0,
    full: false,
  },
  {
    name: 'rise',
    loops: 2,
    energy: 0.6,
    density: { melody: 0.8, harmony: 1, rhythm: 0.6 },
    ornament: 0.12,
    full: false,
  },
  {
    name: 'bloom',
    loops: 4,
    energy: 1,
    density: { melody: 1, harmony: 1, rhythm: 1 },
    ornament: 0.3,
    full: true,
  },
  {
    name: 'fall',
    loops: 2,
    energy: 0.5,
    density: { melody: 0.7, harmony: 1, rhythm: 0.35 },
    ornament: 0.2,
    full: false,
  },
];

/** Below this many orbs, none is left out: each one matters. */
const KEEP_ALL_BELOW = 4;
/** Keeps a song made of a single role from falling silent in a section. */
const LONE_ROLE_DENSITY = 0.7;

/** Pad voicings as scale degrees: C, Am, Dsus and G6, all from the pentatonic. */
const CHORDS: readonly (readonly number[])[] = [
  [2, 3, 5],
  [4, 5, 7],
  [1, 3, 4],
  [3, 4, 6],
];
/** The bass note under each chord, as a degree. */
const CHORD_ROOTS: readonly number[] = [0, 4, 1, 3];
const CHORD_STEPS: readonly number[] = [0, 8];
const PULSE_STEPS: readonly number[] = [0, 4, 8, 12];
const BAND_PAD = 1;
const BAND_BASS = 2;
const BAND_DRUM = 5;

export interface ConcertNote {
  degree: number;
  band: number;
  velocity: number;
}

export interface Ornament extends ConcertNote {
  /** Steps after the note that grew it. */
  stepsLater: number;
}

/** Stable pseudo-random value in [0, 1) for any mix of whole numbers. */
function chance(a: number, b: number, c: number): number {
  let value = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ (b + 0x165667b1), 0xc2b2ae35);
  value = Math.imul(value ^ (c + 0x27d4eb2f), 0x85ebca6b);
  value ^= value >>> 15;
  return ((value >>> 0) % 100000) / 100000;
}

export class ConcertArranger {
  private loop = 0;
  private sectionIndex = 0;
  private sectionLoop = 0;
  private orbCount = 0;
  private soleRole: Role | null = null;
  private readonly backing: ConcertNote[] = [];
  private readonly ornamentNote: Ornament = {
    degree: 0,
    band: 0,
    velocity: 0,
    stepsLater: 1,
  };

  constructor(private readonly seed: number) {}

  get section(): Section {
    return SECTIONS[this.sectionIndex];
  }

  /** Call as each pass of the loop begins. */
  beginLoop(orbs: readonly Slot[]): void {
    if (this.loop > 0) {
      this.sectionLoop++;
      if (this.sectionLoop >= this.section.loops) {
        this.sectionLoop = 0;
        this.sectionIndex = (this.sectionIndex + 1) % SECTIONS.length;
      }
    }
    this.loop++;
    this.orbCount = orbs.length;
    const roles = new Set(orbs.map((orb) => roleOf(orb.band)));
    this.soleRole = roles.size === 1 ? roleOf(orbs[0].band) : null;
  }

  /** How loud an orb plays on this pass: 0 leaves it out, 1 is as written. */
  gainFor(orbId: number, band: number): number {
    const role = roleOf(band);
    const density = this.orbCount < KEEP_ALL_BELOW
      ? 1
      : Math.max(
        this.section.density[role],
        role === this.soleRole ? LONE_ROLE_DENSITY : 0,
      );
    if (chance(this.seed, orbId, this.loop) >= density) return 0;
    return 0.75 + this.section.energy * 0.25;
  }

  /** A quiet extra note after this orb, or null. Reused between calls. */
  ornamentFor(orbId: number, orb: Slot): Ornament | null {
    if (roleOf(orb.band) !== 'melody') return null;
    if (chance(this.seed + 1, orbId, this.loop) >= this.section.ornament) {
      return null;
    }
    const octaveUp = this.section.full &&
      chance(this.seed + 2, orbId, this.loop) < 0.4;
    const note = this.ornamentNote;
    note.band = orb.band;
    note.degree = octaveUp
      ? orb.degree + 5
      : Math.max(0, orb.degree + (chance(this.seed + 3, orbId, this.loop) < 0.5 ? 1 : -1));
    note.velocity = octaveUp ? 0.3 : 0.42;
    note.stepsLater = octaveUp ? 2 : 1;
    return note;
  }

  /** What the accompaniment plays on this step. Reused between calls. */
  backingFor(step: number): readonly ConcertNote[] {
    const notes = this.backing;
    notes.length = 0;
    const chord = (this.loop + this.sectionIndex) % CHORDS.length;
    const { energy, full } = this.section;
    if (CHORD_STEPS.includes(step)) {
      for (const degree of CHORDS[chord]) {
        notes.push({ degree, band: BAND_PAD, velocity: 0.4 + energy * 0.3 });
      }
      if (full) {
        notes.push({
          degree: CHORD_ROOTS[chord],
          band: BAND_BASS,
          velocity: 0.55,
        });
      }
    }
    if (full && PULSE_STEPS.includes(step)) {
      notes.push({ degree: 0, band: BAND_DRUM, velocity: 0.3 });
    }
    return notes;
  }
}
