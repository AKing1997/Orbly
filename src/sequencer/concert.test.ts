import { describe, expect, it } from 'vitest';
import { BAND_ROOT_MIDI, degreeToMidi, isInScale } from '../audio/scale';
import { OrbData } from '../state/composition';
import { CompositionStore } from '../state/store';
import { ConcertArranger, ConcertNote, roleOf, SECTIONS } from './concert';
import { STEP_COUNT } from './mapping';
import { NO_ORB, Sequencer } from './player';

const orbs: OrbData[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  step: i % 16,
  degree: i % 11,
  band: i % 8,
}));

const inKey = (note: ConcertNote) =>
  isInScale(degreeToMidi(note.degree, note.band) - BAND_ROOT_MIDI[note.band]);

/** Runs `loops` passes, collecting a section name per pass. */
function sections(arranger: ConcertArranger, loops: number, song = orbs): string[] {
  const names: string[] = [];
  for (let i = 0; i < loops; i++) {
    arranger.beginLoop(song);
    names.push(arranger.section.name);
  }
  return names;
}

describe('sections', () => {
  it('plays each section for its length, then starts over', () => {
    const length = SECTIONS.reduce((total, section) => total + section.loops, 0);
    const names = sections(new ConcertArranger(7), length + 1);
    const expected = SECTIONS.flatMap((s) => new Array<string>(s.loops).fill(s.name));
    expect(names).toEqual([...expected, expected[0]]);
  });

  it('starts quietly and peaks later', () => {
    expect(SECTIONS[0].energy).toBeLessThan(0.5);
    expect(Math.max(...SECTIONS.map((section) => section.energy))).toBe(1);
  });
});

describe('roles', () => {
  it('gives every instrument a role', () => {
    for (let band = 0; band < BAND_ROOT_MIDI.length; band++) {
      expect(roleOf(band)).toBeDefined();
    }
  });
});

describe('gainFor', () => {
  it('leaves rhythm out of the quiet opening', () => {
    const arranger = new ConcertArranger(7);
    arranger.beginLoop(orbs);
    expect(arranger.section.name).toBe('breath');
    expect(arranger.gainFor(3, 2)).toBe(0);
  });

  it('lets a different mix through on each pass', () => {
    const arranger = new ConcertArranger(7);
    const patterns = new Set<string>();
    for (let loop = 0; loop < 2; loop++) {
      arranger.beginLoop(orbs);
      patterns.add(orbs.map((orb) => (arranger.gainFor(orb.id, 0) > 0 ? 1 : 0)).join(''));
    }
    expect(patterns.size).toBe(2);
  });

  it('plays everything at the peak', () => {
    const arranger = new ConcertArranger(7);
    sections(arranger, 5);
    expect(arranger.section.name).toBe('bloom');
    for (const orb of orbs) expect(arranger.gainFor(orb.id, orb.band)).toBeGreaterThan(0);
  });

  it('never drops a note from a song of a few orbs', () => {
    const small = orbs.slice(0, 2);
    const arranger = new ConcertArranger(7);
    for (let loop = 0; loop < 40; loop++) {
      arranger.beginLoop(small);
      for (const orb of small) expect(arranger.gainFor(orb.id, orb.band)).toBeGreaterThan(0);
    }
  });

  it('keeps a song of one role from going silent', () => {
    const drums = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, step: i, degree: 0, band: 5 }));
    const arranger = new ConcertArranger(7);
    arranger.beginLoop(drums);
    expect(drums.some((orb) => arranger.gainFor(orb.id, orb.band) > 0)).toBe(true);
  });

  it('is repeatable for a seed and varies between seeds', () => {
    const run = (seed: number) => {
      const arranger = new ConcertArranger(seed);
      arranger.beginLoop(orbs);
      return orbs.map((orb) => arranger.gainFor(orb.id, 0));
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });
});

describe('ornaments', () => {
  const walk = (seed: number) => {
    const arranger = new ConcertArranger(seed);
    const found: { degree: number; band: number; velocity: number }[] = [];
    for (let loop = 0; loop < 40; loop++) {
      arranger.beginLoop(orbs);
      for (const orb of orbs) {
        const note = arranger.ornamentFor(orb.id, orb);
        if (note !== null) found.push({ ...note });
      }
    }
    return found;
  };

  it('grows some ornaments, softer than the note', () => {
    const notes = walk(3);
    expect(notes.length).toBeGreaterThan(10);
    for (const note of notes) expect(note.velocity).toBeLessThan(0.5);
  });

  it('stays in key', () => {
    for (const note of walk(3)) expect(inKey(note)).toBe(true);
  });

  it('only ornaments melody', () => {
    for (const note of walk(3)) expect(roleOf(note.band)).toBe('melody');
  });

  it('never appears in the quiet opening', () => {
    const arranger = new ConcertArranger(3);
    arranger.beginLoop(orbs);
    for (const orb of orbs) expect(arranger.ornamentFor(orb.id, orb)).toBeNull();
  });
});

describe('backing', () => {
  it('plays chords in every section, so one orb is never alone', () => {
    const arranger = new ConcertArranger(7);
    for (let loop = 0; loop < 12; loop++) {
      arranger.beginLoop(orbs.slice(0, 1));
      expect(arranger.backingFor(0).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('adds bass and pulse only at the peak', () => {
    const arranger = new ConcertArranger(7);
    arranger.beginLoop(orbs);
    expect(arranger.backingFor(4)).toHaveLength(0);
    sections(arranger, 4);
    expect(arranger.section.full).toBe(true);
    expect(arranger.backingFor(4).length).toBe(1);
    expect(arranger.backingFor(0).some((note) => note.band === 2)).toBe(true);
  });

  it('is silent between its beats', () => {
    const arranger = new ConcertArranger(7);
    sections(arranger, 5);
    expect(arranger.backingFor(3)).toHaveLength(0);
  });

  it('stays in key on every step of every section', () => {
    const arranger = new ConcertArranger(7);
    for (let loop = 0; loop < 24; loop++) {
      arranger.beginLoop(orbs);
      for (let step = 0; step < STEP_COUNT; step++) {
        for (const note of arranger.backingFor(step)) expect(inKey(note)).toBe(true);
      }
    }
  });
});

describe('Sequencer with an arranger', () => {
  const setup = () => {
    const store = new CompositionStore();
    store.load({ bpm: 84, sceneId: 0, orbs });
    const notes: { orbId: number; time: number; band: number }[] = [];
    const sequencer = new Sequencer(store, () => false, (note) => notes.push({ ...note }));
    return { store, notes, sequencer };
  };

  it('plays the plain loop without one', () => {
    const { notes, sequencer } = setup();
    for (let step = 0; step < STEP_COUNT; step++) sequencer.step(step, step, 0.3);
    expect(notes).toHaveLength(orbs.length);
  });

  it('adds backing that belongs to no orb', () => {
    const { notes, sequencer } = setup();
    sequencer.setArranger(new ConcertArranger(1));
    sequencer.step(0, 0, 0.3);
    expect(notes.some((note) => note.orbId < 0)).toBe(true);
  });

  it('places ornaments after their note, on the beat grid', () => {
    const { notes, sequencer } = setup();
    sequencer.setArranger(new ConcertArranger(1));
    const stepDuration = 0.5;
    for (let loop = 0; loop < 12; loop++) {
      for (let step = 0; step < STEP_COUNT; step++) {
        sequencer.step(step, (loop * STEP_COUNT + step) * stepDuration, stepDuration);
      }
    }
    const ornaments = notes.filter(
      (note) => note.orbId === NO_ORB && roleOf(note.band) === 'melody',
    );
    expect(ornaments.length).toBeGreaterThan(0);
    for (const note of ornaments) {
      const onGrid = (note.time / stepDuration) % 1;
      expect(onGrid).toBeCloseTo(0);
    }
  });

  it('counts backing as sound, for the light to follow', () => {
    const { sequencer } = setup();
    sequencer.setArranger(new ConcertArranger(1));
    expect(sequencer.step(8, 0, 0.3)).toBeGreaterThan(0);
  });

  it('never changes the composition', () => {
    const { store, sequencer } = setup();
    const before = JSON.stringify(store.snapshot());
    const { revision } = store;
    sequencer.setArranger(new ConcertArranger(1));
    for (let loop = 0; loop < 30; loop++) {
      for (let step = 0; step < STEP_COUNT; step++) sequencer.step(step, 0, 0.3);
    }
    expect(JSON.stringify(store.snapshot())).toBe(before);
    expect(store.revision).toBe(revision);
  });

  it('returns to the plain loop when it is taken away', () => {
    const { notes, sequencer } = setup();
    sequencer.setArranger(new ConcertArranger(1));
    sequencer.step(0, 0, 0.3);
    sequencer.setArranger(null);
    notes.length = 0;
    sequencer.step(4, 0, 0.3);
    expect(notes.map((note) => note.orbId)).toEqual([5]);
  });
});
