import { describe, expect, it } from 'vitest';
import { DEGREE_COUNT } from '../sequencer/mapping';
import { SCENE_COUNT } from '../state/composition';
import {
  BAND_ROOT_MIDI,
  degreeToMidi,
  degreeToSemitones,
  isInScale,
  midiToFrequency,
  quantizeSemitones,
  SCENE_SCALES,
} from './scale';

describe('degreeToSemitones', () => {
  it('walks the major pentatonic and repeats by octave', () => {
    const notes = [0, 1, 2, 3, 4, 5, 6].map((degree) => degreeToSemitones(degree));
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

describe('moods', () => {
  it('keeps the first scenes on the same scale, so colour alone changes nothing', () => {
    for (const scale of SCENE_SCALES.slice(0, 4)) expect(scale).toBe(SCENE_SCALES[0]);
  });

  it('gives each unlockable mood a scale of its own', () => {
    expect(new Set(SCENE_SCALES.slice(3)).size).toBe(4);
  });

  it('has a scene colour for every scale', () => {
    expect(SCENE_SCALES).toHaveLength(SCENE_COUNT);
  });

  it('can never clash: no mood holds two notes a semitone apart', () => {
    for (const scale of SCENE_SCALES) {
      const notes = [...scale, 12];
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i] - notes[i - 1]).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps pitch rising with height in every mood', () => {
    for (const scale of SCENE_SCALES) {
      for (let degree = 1; degree < DEGREE_COUNT; degree++) {
        expect(degreeToMidi(degree, 0, scale)).toBeGreaterThan(
          degreeToMidi(degree - 1, 0, scale),
        );
      }
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
