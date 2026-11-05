/**
 * Persistence on localStorage. Every access is guarded: private windows,
 * blocked site data or a full quota must never break the experience, so a
 * failure simply leaves the data in memory for this visit.
 */

import { Composition, deserialize, serialize } from './composition';
import { streakOf } from './unlocks';

export const MAX_SAVES = 6;
const KEY_PREFIX = 'orbly.';
const SAVES_KEY = 'saves';
const ONBOARDED_KEY = 'onboarded';
const CHALLENGES_KEY = 'challenges';
const CHALLENGE_TOTAL_KEY = 'challengeTotal';
/** Days kept for working out the streak. */
const KEPT_DAYS = 60;

/** The slice of the Storage interface orbly needs. */
export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class SafeStorage {
  private readonly memory = new Map<string, string>();
  private readonly backend: KeyValueBackend | null;

  constructor(getBackend: () => KeyValueBackend | null | undefined) {
    let backend: KeyValueBackend | null = null;
    try {
      backend = getBackend() ?? null;
    } catch {
      backend = null;
    }
    this.backend = backend;
  }

  get(key: string): string | null {
    const name = KEY_PREFIX + key;
    if (this.memory.has(name)) return this.memory.get(name) ?? null;
    try {
      return this.backend?.getItem(name) ?? null;
    } catch {
      return null;
    }
  }

  /** Returns false when the value only reached memory. */
  set(key: string, value: string): boolean {
    const name = KEY_PREFIX + key;
    this.memory.set(name, value);
    if (this.backend === null) return false;
    try {
      this.backend.setItem(name, value);
      return true;
    } catch {
      return false;
    }
  }
}

export interface SavedComposition {
  id: number;
  savedAt: number;
  composition: Composition;
  /** The persistent anchor pinning this song to a real room, if any. */
  anchor?: string;
}

interface StoredSave {
  id: number;
  at: number;
  data: string;
  anchor?: string;
}

/** Up to six saved compositions, most recent first. */
export class Library {
  private saves: SavedComposition[] = [];

  constructor(private readonly storage: SafeStorage) {
    this.saves = this.read();
  }

  list(): readonly SavedComposition[] {
    return this.saves;
  }

  /**
   * Saves over `id` when given; otherwise adds a new entry, replacing the
   * oldest once the library is full. Returns the saved entry's id.
   */
  save(
    composition: Composition,
    id: number | null,
    now: number,
    anchor: string | null = null,
  ): number {
    const existing = this.saves.findIndex((save) => save.id === id);
    const entry: SavedComposition = {
      id: existing >= 0 && id !== null ? id : this.nextId(),
      savedAt: now,
      composition,
      ...(anchor === null ? {} : { anchor }),
    };
    if (existing >= 0) this.saves.splice(existing, 1);
    this.saves.unshift(entry);
    this.saves.length = Math.min(this.saves.length, MAX_SAVES);
    this.write();
    return entry.id;
  }

  /** Every anchor a saved song still needs. */
  anchors(): Set<string> {
    const anchors = new Set<string>();
    for (const save of this.saves) {
      if (save.anchor !== undefined) anchors.add(save.anchor);
    }
    return anchors;
  }

  private nextId(): number {
    return this.saves.reduce((max, save) => Math.max(max, save.id), 0) + 1;
  }

  private read(): SavedComposition[] {
    const raw = this.storage.get(SAVES_KEY);
    if (raw === null) return [];
    try {
      const entries: unknown = JSON.parse(raw);
      if (!Array.isArray(entries)) return [];
      const saves: SavedComposition[] = [];
      for (const entry of entries as Partial<StoredSave>[]) {
        if (typeof entry?.data !== 'string') continue;
        const composition = deserialize(entry.data);
        if (composition === null) continue;
        saves.push({
          id: typeof entry.id === 'number' ? entry.id : saves.length + 1,
          savedAt: typeof entry.at === 'number' ? entry.at : 0,
          composition,
          ...(typeof entry.anchor === 'string' ? { anchor: entry.anchor } : {}),
        });
      }
      return saves.slice(0, MAX_SAVES);
    } catch {
      return [];
    }
  }

  private write(): void {
    const stored: StoredSave[] = this.saves.map((save) => ({
      id: save.id,
      at: save.savedAt,
      data: serialize(save.composition),
      ...(save.anchor === undefined ? {} : { anchor: save.anchor }),
    }));
    this.storage.set(SAVES_KEY, JSON.stringify(stored));
  }
}

/** Small flags kept between visits. */
export class Progress {
  constructor(private readonly storage: SafeStorage) {}

  get onboarded(): boolean {
    return this.storage.get(ONBOARDED_KEY) === '1';
  }

  markOnboarded(): void {
    this.storage.set(ONBOARDED_KEY, '1');
  }

  challengeDone(dateKey: string): boolean {
    return this.completedChallenges().includes(dateKey);
  }

  markChallengeDone(dateKey: string): void {
    const days = this.completedChallenges();
    if (days.includes(dateKey)) return;
    const finished = this.challengesFinished;
    days.push(dateKey);
    this.storage.set(CHALLENGES_KEY, JSON.stringify(days.slice(-KEPT_DAYS)));
    this.storage.set(CHALLENGE_TOTAL_KEY, String(finished + 1));
  }

  /** Every challenge ever finished. Unlocks are earned for good. */
  get challengesFinished(): number {
    const total = Number(this.storage.get(CHALLENGE_TOTAL_KEY));
    return Math.max(
      Number.isFinite(total) ? total : 0,
      this.completedChallenges().length,
    );
  }

  streak(today: string): number {
    return streakOf(this.completedChallenges(), today);
  }

  private completedChallenges(): string[] {
    const raw = this.storage.get(CHALLENGES_KEY);
    if (raw === null) return [];
    try {
      const days: unknown = JSON.parse(raw);
      return Array.isArray(days)
        ? days.filter((day): day is string => typeof day === 'string')
        : [];
    } catch {
      return [];
    }
  }
}

export function browserStorage(): SafeStorage {
  return new SafeStorage(() => globalThis.localStorage);
}
