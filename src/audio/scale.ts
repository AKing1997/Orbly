/**
 * Pentatonic quantization. Every pitch orbly plays passes through here, so
 * nothing can be out of key no matter where an orb is placed.
 */

/** Major pentatonic, in semitones above the root. */
export const PENTATONIC: readonly number[] = [0, 2, 4, 7, 9];
/** Minor pentatonic: darker, for the Night scene. */
const MINOR_PENTATONIC: readonly number[] = [0, 3, 5, 7, 10];
/** Suspended pentatonic: open and unresolved, for the Mist scene. */
const SUSPENDED_PENTATONIC: readonly number[] = [0, 2, 5, 7, 10];
/** The fifth mode of the same family: heavy, for the Storm scene. */
const MAN_GONG_PENTATONIC: readonly number[] = [0, 3, 5, 8, 10];

/**
 * The scale of each colour scene. The first four share one, so changing colour
 * leaves the music alone; the unlockable moods change both. None has a semitone
 * in it, which is why no placement can ever clash, in any mood.
 */
export const SCENE_SCALES: readonly (readonly number[])[] = [
  PENTATONIC,
  PENTATONIC,
  PENTATONIC,
  PENTATONIC,
  MINOR_PENTATONIC,
  SUSPENDED_PENTATONIC,
  MAN_GONG_PENTATONIC,
];

/**
 * Root note of each instrument: pluck, pad, bass, then the room's bell (walls),
 * marimba (tables), drum (floor), hum (soft furniture) and air (no surface).
 * All are a C, so every instrument shares one key.
 */
export const BAND_ROOT_MIDI: readonly number[] = [60, 48, 36, 72, 60, 36, 48, 60];

/** Semitones above the root for a scale degree of any size. */
export function degreeToSemitones(
  degree: number,
  scale: readonly number[] = PENTATONIC,
): number {
  const size = scale.length;
  const octave = Math.floor(degree / size);
  const index = ((degree % size) + size) % size;
  return octave * 12 + scale[index];
}

export function degreeToMidi(
  degree: number,
  band: number,
  scale: readonly number[] = PENTATONIC,
): number {
  return BAND_ROOT_MIDI[band] + degreeToSemitones(degree, scale);
}

/** Snaps any semitone offset to the closest scale tone (lower one on a tie). */
export function quantizeSemitones(semitones: number): number {
  const rounded = Math.round(semitones);
  const octave = Math.floor(rounded / 12);
  const pitchClass = rounded - octave * 12;
  let best = 0;
  let bestDistance = Infinity;
  for (const tone of [...PENTATONIC, 12]) {
    const distance = Math.abs(tone - pitchClass);
    if (distance < bestDistance) {
      best = tone;
      bestDistance = distance;
    }
  }
  return octave * 12 + best;
}

export function isInScale(semitones: number): boolean {
  const pitchClass = ((semitones % 12) + 12) % 12;
  return PENTATONIC.includes(pitchClass);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
