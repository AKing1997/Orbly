import { describe, expect, it } from 'vitest';
import { DEGREE_COUNT } from '../sequencer/mapping';
import {
  BAND_ROOT_MIDI,
  degreeToMidi,
  degreeToSemitones,
  isInScale,
  midiToFrequency,
  quantizeSemitones,
} from './scale';

describe('degreeToSemitones', () => {
  it('walks the major pentatonic and repeats by octave', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6].map(degreeToSemitones);
    expect(notes).toEqual([0, 2, 4, 7, 9, 12, 14]);
  });

  it('supports negative degrees', () => {
    expect(degreeToSemitones(-1)).toBe(-3);
  });
});

describe('every reachable note', () => {
  it('stays in the scale for every degree and band', () => {
    for (let band = 0; band < BAND_ROOT_MIDI.length; band++) {
      for (let degree = 0; degree < DEGREE_COUNT; degree++) {
        const semitones = degreeToMidi(degree, band) - BAND_ROOT_MIDI[band];
        expect(isInScale(semitones)).toBe(true);
      }
    }
  });

  it('puts every instrument in the same key', () => {
    for (const root of BAND_ROOT_MIDI) expect(root % 12).toBe(0);
  });

  it('rises strictly with height', () => {
    for (let degree = 1; degree < DEGREE_COUNT; degree++) {
      expect(degreeToMidi(degree, 0)).toBeGreaterThan(
        degreeToMidi(degree - 1, 0),
      );
    }
  });
});

describe('quantizeSemitones', () => {
  it('keeps scale tones untouched', () => {
    for (const tone of [0, 2, 4, 7, 9, 12, 14, -3]) {
      expect(quantizeSemitones(tone)).toBe(tone);
    }
  });

  it('moves every chromatic pitch onto the scale', () => {
    for (let pitch = -24; pitch <= 36; pitch++) {
      expect(isInScale(quantizeSemitones(pitch))).toBe(true);
    }
  });

  it('never moves a pitch more than two semitones', () => {
    for (let pitch = -24; pitch <= 36; pitch++) {
      expect(Math.abs(quantizeSemitones(pitch) - pitch)).toBeLessThanOrEqual(2);
    }
  });
});

describe('midiToFrequency', () => {
  it('anchors A4 at 440 Hz and doubles each octave', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440);
    expect(midiToFrequency(81)).toBeCloseTo(880);
  });
});
