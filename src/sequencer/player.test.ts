import { describe, expect, it } from 'vitest';
import { degreeToMidi } from '../audio/scale';
import { OrbData } from '../state/composition';
import { chordVelocity, FlashQueue, NoteEvent, Sequencer } from './player';

const orbs: OrbData[] = [
  { id: 1, step: 0, degree: 2, band: 0 },
  { id: 2, step: 0, degree: 5, band: 2 },
  { id: 3, step: 4, degree: 0, band: 1 },
];

const source = {
  orbs,
  orbsAtStep(step: number, out: OrbData[]) {
    out.length = 0;
    out.push(...orbs.filter((orb) => orb.step === step));
    return out;
  },
};

function setup(muted: number[] = []) {
  const notes: NoteEvent[] = [];
  const sequencer = new Sequencer(
    source,
    (id) => muted.includes(id),
    (note) => notes.push({ ...note }),
  );
  return { notes, sequencer };
}

describe('Sequencer', () => {
  it('plays each orb on its step, in tune, at the scheduled time', () => {
    const { notes, sequencer } = setup();
    expect(sequencer.step(0, 3.5, 0.3)).toBe(2);
    expect(notes[0]).toMatchObject({
      orbId: 1,
      midi: degreeToMidi(2, 0),
      time: 3.5,
    });
    expect(notes[1]).toMatchObject({ orbId: 2, band: 2 });
  });

  it('stays quiet on an empty step', () => {
    const { notes, sequencer } = setup();
    expect(sequencer.step(9, 0, 0.3)).toBe(0);
    expect(notes).toHaveLength(0);
  });

  it('skips an orb that is being held', () => {
    const { notes, sequencer } = setup([1]);
    sequencer.step(0, 0, 0.3);
    expect(notes.map((note) => note.orbId)).toEqual([2]);
  });

  it('turns chords down', () => {
    expect(chordVelocity(1)).toBe(1);
    expect(chordVelocity(4)).toBe(0.5);
    expect(chordVelocity(0)).toBe(1);
  });
});

describe('FlashQueue', () => {
  it('holds a note until it is due', () => {
    const queue = new FlashQueue();
    const flashed: number[] = [];
    queue.push(7, 1);
    queue.drain(0.9, (id) => flashed.push(id));
    expect(flashed).toEqual([]);
    queue.drain(1, (id) => flashed.push(id));
    expect(flashed).toEqual([7]);
  });

  it('keeps order and wraps around its ring', () => {
    const queue = new FlashQueue(4);
    const flashed: number[] = [];
    for (let round = 0; round < 10; round++) {
      queue.push(round, round);
      queue.drain(round, (id) => flashed.push(id));
    }
    expect(flashed).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('drops notes when full rather than overwriting', () => {
    const queue = new FlashQueue(2);
    const flashed: number[] = [];
    queue.push(1, 0);
    queue.push(2, 0);
    queue.push(3, 0);
    queue.drain(1, (id) => flashed.push(id));
    expect(flashed).toEqual([1, 2]);
  });
});
