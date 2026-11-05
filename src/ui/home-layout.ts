/**
 * Where the home screen's spheres go. Two compact rows instead of a wide arc,
 * so the new-song sphere and all six saves fit the narrowest view at once.
 */

const degrees = (value: number): number => (value * Math.PI) / 180;

const REACH = 0.44;
const NEW_RADIUS = 0.075;
const SAVE_RADIUS = 0.055;
const LOWER_DROP = 0.25;
const UPPER_DROP = 0.1;

export interface HomeSpot {
  /** Clockwise from the user's forward direction, radians. */
  azimuth: number;
  /** Horizontal distance from the user. */
  reach: number;
  /** How far below the eyes. */
  drop: number;
  radius: number;
}

/** How many saved songs have a place. */
export const HOME_SPOTS = 6;

/** Nearest the centre first, so a few saves sit by the new-song sphere. */
const SAVE_ANGLES: readonly [number, number][] = [
  [-22, LOWER_DROP],
  [22, LOWER_DROP],
  [-9, UPPER_DROP],
  [9, UPPER_DROP],
  [-27, UPPER_DROP],
  [27, UPPER_DROP],
];

/** @param index 0 is the new-song sphere, then one per saved song. */
export function homeSpot(index: number): HomeSpot {
  if (index === 0) {
    return { azimuth: 0, reach: REACH, drop: LOWER_DROP, radius: NEW_RADIUS };
  }
  const [angle, drop] = SAVE_ANGLES[index - 1];
  return { azimuth: degrees(angle), reach: REACH, drop, radius: SAVE_RADIUS };
}
