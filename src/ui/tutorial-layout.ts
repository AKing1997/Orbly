/** Where the tutorial shows things, all inside the narrowest view. */

const degrees = (value: number): number => (value * Math.PI) / 180;

export interface TutorialSpot {
  /** Clockwise from the user's forward direction, radians. */
  azimuth: number;
  /** Horizontal distance from the user. */
  radius: number;
  /** How far below the eyes. */
  drop: number;
  /** Half the size of what is shown there. */
  halfSize: number;
}

export const SKIP_SPOT: TutorialSpot = {
  azimuth: degrees(-24),
  radius: 0.44,
  drop: 0.26,
  halfSize: 0.05,
};

/** Where the ghost hand pinches. The hand itself extends to the right. */
export const PINCH_SPOT: TutorialSpot = {
  azimuth: degrees(8),
  radius: 0.38,
  drop: 0.18,
  halfSize: 0.06,
};

/** The wrist of the left ghost hand, as it turns its palm up. */
export const PALM_SPOT: TutorialSpot = {
  azimuth: degrees(-20),
  radius: 0.3,
  drop: 0.17,
  halfSize: 0.06,
};
