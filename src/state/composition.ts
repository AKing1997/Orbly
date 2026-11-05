/** The composition document: what gets saved, loaded and undone. */

import { RoomSpot } from '../room/surfaces';
import {
  BAND_COUNT,
  DEGREE_COUNT,
  INSTRUMENT_COUNT,
  Slot,
  STEP_COUNT,
} from '../sequencer/mapping';

export interface OrbData extends Slot {
  id: number;
  /** Set when the orb lives on a room surface instead of the near ring. */
  spot?: RoomSpot;
}

export interface Composition {
  bpm: number;
  sceneId: number;
  orbs: OrbData[];
}

export const MAX_ORBS = 32;
export const MIN_BPM = 60;
export const MAX_BPM = 140;
export const DEFAULT_BPM = 84;
/** Four colour scenes open from the start, three more moods to unlock. */
export const SCENE_COUNT = 7;
const FORMAT_VERSION = 2;
/** Saves from before orbs could leave the ring still open. */
const OLDEST_READABLE_VERSION = 1;

export function emptyComposition(): Composition {
  return { bpm: DEFAULT_BPM, sceneId: 0, orbs: [] };
}

export function clampBpm(bpm: number): number {
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(bpm)));
}

/** step, degree, band; then, for room orbs, azimuth, elevation, distance. */
type SerializedOrb = number[];

interface SerializedComposition {
  v: number;
  b: number;
  s: number;
  o: SerializedOrb[];
}

/** Milliradians and centimetres: plenty of precision, far fewer digits. */
function spotToJSON(spot: RoomSpot): number[] {
  return [
    Math.round(spot.azimuth * 1000),
    Math.round(spot.elevation * 1000),
    Math.round(spot.distance * 100),
  ];
}

function spotFromJSON(entry: unknown[]): RoomSpot | null {
  const [azimuth, elevation, distance] = entry.slice(3);
  if (
    !Number.isFinite(azimuth) || !Number.isFinite(elevation) ||
    !Number.isFinite(distance) || (distance as number) <= 0
  ) {
    return null;
  }
  return {
    azimuth: (azimuth as number) / 1000,
    elevation: (elevation as number) / 1000,
    distance: (distance as number) / 100,
  };
}

export function toJSON(composition: Composition): SerializedComposition {
  return {
    v: FORMAT_VERSION,
    b: composition.bpm,
    s: composition.sceneId,
    o: composition.orbs.map((orb) => [
      orb.step,
      orb.degree,
      orb.band,
      ...(orb.spot === undefined ? [] : spotToJSON(orb.spot)),
    ]),
  };
}

export function serialize(composition: Composition): string {
  return JSON.stringify(toJSON(composition));
}

function isCellIndex(value: unknown, size: number): value is number {
  return Number.isInteger(value) && (value as number) >= 0 &&
    (value as number) < size;
}

/**
 * Reads a saved composition, tolerating damage: invalid or duplicated orbs
 * are skipped and bad numbers fall back to defaults. Returns null only when
 * the data is not a composition at all.
 */
export function parseComposition(data: unknown): Composition | null {
  if (typeof data !== 'object' || data === null) return null;
  const source = data as Partial<SerializedComposition>;
  const { v: version } = source;
  if (
    typeof version !== 'number' || version < OLDEST_READABLE_VERSION ||
    version > FORMAT_VERSION || !Array.isArray(source.o)
  ) {
    return null;
  }

  const seen = new Set<number>();
  const orbs: OrbData[] = [];
  for (const entry of source.o) {
    if (orbs.length >= MAX_ORBS) break;
    if (!Array.isArray(entry)) continue;
    const [step, degree, band] = entry;
    if (
      !isCellIndex(step, STEP_COUNT) ||
      !isCellIndex(degree, DEGREE_COUNT) ||
      !isCellIndex(band, INSTRUMENT_COUNT)
    ) {
      continue;
    }
    const spot = band < BAND_COUNT ? undefined : spotFromJSON(entry);
    if (spot === null) continue;
    const key = step + degree * STEP_COUNT + band * STEP_COUNT * DEGREE_COUNT;
    if (seen.has(key)) continue;
    seen.add(key);
    orbs.push({
      id: orbs.length + 1,
      step,
      degree,
      band,
      ...(spot === undefined ? {} : { spot }),
    });
  }

  const bpm = typeof source.b === 'number' && Number.isFinite(source.b)
    ? clampBpm(source.b)
    : DEFAULT_BPM;
  const sceneId = isCellIndex(source.s, SCENE_COUNT) ? source.s : 0;
  return { bpm, sceneId, orbs };
}

export function deserialize(text: string): Composition | null {
  try {
    return parseComposition(JSON.parse(text));
  } catch {
    return null;
  }
}
