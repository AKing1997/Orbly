import { describe, expect, it } from 'vitest';
import { SCENE_COUNT } from './composition';
import { KeyValueBackend, Progress, SafeStorage } from './storage';
import {
  nextScene,
  nextUnlock,
  OPEN_SCENES,
  openScenes,
  sceneUnlockedAt,
  streakOf,
} from './unlocks';

describe('scenes', () => {
  it('opens four from the start', () => {
    expect(openScenes(0)).toBe(OPEN_SCENES);
  });

  it('pays off the very first challenge', () => {
    expect(openScenes(1)).toBe(OPEN_SCENES + 1);
    expect(sceneUnlockedAt(1)).toBe(OPEN_SCENES);
  });

  it('never goes past the last scene', () => {
    expect(openScenes(500)).toBe(SCENE_COUNT);
  });

  it('cycles only through open scenes', () => {
    expect(nextScene(0, 0)).toBe(1);
    expect(nextScene(3, 0)).toBe(0);
    expect(nextScene(3, 1)).toBe(4);
    expect(nextScene(4, 1)).toBe(0);
  });

  it('falls back to the start from a scene that is not open', () => {
    expect(nextScene(6, 0)).toBe(3);
  });

  it('reports an unlock only on the day it happens', () => {
    expect(sceneUnlockedAt(2)).toBeNull();
    expect(sceneUnlockedAt(3)).toBe(OPEN_SCENES + 1);
    expect(sceneUnlockedAt(4)).toBeNull();
    expect(sceneUnlockedAt(5)).toBe(OPEN_SCENES + 2);
    expect(sceneUnlockedAt(6)).toBeNull();
  });
});

describe('nextUnlock', () => {
  it('counts down to the next reward', () => {
    expect(nextUnlock(0)).toEqual({ sceneId: 4, remaining: 1 });
    expect(nextUnlock(1)).toEqual({ sceneId: 5, remaining: 2 });
    expect(nextUnlock(4)).toEqual({ sceneId: 6, remaining: 1 });
  });

  it('ends once everything is open', () => {
    expect(nextUnlock(5)).toBeNull();
  });
});

describe('streakOf', () => {
  it('is zero with nothing done', () => {
    expect(streakOf([], '2026-11-05')).toBe(0);
  });

  it('counts consecutive days up to today', () => {
    expect(streakOf(['2026-11-03', '2026-11-04', '2026-11-05'], '2026-11-05')).toBe(3);
  });

  it('survives until today is over', () => {
    expect(streakOf(['2026-11-03', '2026-11-04'], '2026-11-05')).toBe(2);
  });

  it('breaks after a missed day', () => {
    expect(streakOf(['2026-11-01', '2026-11-02'], '2026-11-05')).toBe(0);
    expect(streakOf(['2026-11-01', '2026-11-04', '2026-11-05'], '2026-11-05')).toBe(2);
  });

  it('crosses months and years', () => {
    expect(streakOf(['2026-12-31', '2027-01-01'], '2027-01-01')).toBe(2);
    expect(streakOf(['2027-02-28', '2027-03-01'], '2027-03-01')).toBe(2);
  });

  it('does not depend on the order of the days', () => {
    expect(streakOf(['2026-11-05', '2026-11-03', '2026-11-04'], '2026-11-05')).toBe(3);
  });
});

describe('Progress', () => {
  const memoryBackend = (): KeyValueBackend => {
    const data = new Map<string, string>();
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    };
  };

  it('counts finished days once each', () => {
    const progress = new Progress(new SafeStorage(memoryBackend));
    progress.markChallengeDone('2026-11-04');
    progress.markChallengeDone('2026-11-05');
    progress.markChallengeDone('2026-11-05');
    expect(progress.challengesFinished).toBe(2);
    expect(progress.streak('2026-11-05')).toBe(2);
  });

  it('keeps counting after the list of recent days is trimmed', () => {
    const progress = new Progress(new SafeStorage(memoryBackend));
    for (let day = 1; day <= 90; day++) {
      const date = new Date(Date.UTC(2026, 0, day));
      progress.markChallengeDone(date.toISOString().slice(0, 10));
    }
    expect(progress.challengesFinished).toBe(90);
  });
});
