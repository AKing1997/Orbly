/**
 * What daily challenges earn. The first one pays off at once, so even a single
 * visit feels the reward; the rest are something to come back for.
 */

import { SCENE_COUNT } from './composition';

/** Colour scenes open from the start. */
export const OPEN_SCENES = 4;

/** Scenes after the open ones, and the challenges it takes to reach each. */
const UNLOCK_AFTER: readonly number[] = [1, 3, 5];

export interface NextUnlock {
  sceneId: number;
  /** Challenges still to complete. */
  remaining: number;
}

/** How many scenes are open after this many finished challenges. */
export function openScenes(finished: number): number {
  const unlocked = UNLOCK_AFTER.filter((after) => finished >= after).length;
  return Math.min(SCENE_COUNT, OPEN_SCENES + unlocked);
}

/** The next open scene after `current`, wrapping past the last. */
export function nextScene(current: number, finished: number): number {
  return (current + 1) % openScenes(finished);
}

/** The scene this finished challenge just opened, or null. */
export function sceneUnlockedAt(finished: number): number | null {
  const index = UNLOCK_AFTER.indexOf(finished);
  return index < 0 ? null : OPEN_SCENES + index;
}

/** What there is to work towards, or null when everything is open. */
export function nextUnlock(finished: number): NextUnlock | null {
  const index = UNLOCK_AFTER.findIndex((after) => finished < after);
  if (index < 0) return null;
  return {
    sceneId: OPEN_SCENES + index,
    remaining: UNLOCK_AFTER[index] - finished,
  };
}

function dayNumber(key: string): number {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86400000);
}

/**
 * Consecutive days with a finished challenge, counting back from today. A
 * streak survives until the end of the day after the last one, so it does not
 * read zero in the morning before today's challenge is done.
 */
export function streakOf(days: readonly string[], today: string): number {
  const numbers = new Set(days.map(dayNumber));
  let cursor = dayNumber(today);
  if (!numbers.has(cursor)) cursor--;
  let streak = 0;
  while (numbers.has(cursor)) {
    streak++;
    cursor--;
  }
  return streak;
}
