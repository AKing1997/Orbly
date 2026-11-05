import { describe, expect, it } from 'vitest';
import { CHALLENGES, challengeFor, dateKey } from './challenge';
import {
  Composition,
  deserialize,
  emptyComposition,
  MAX_ORBS,
  OrbData,
  serialize,
} from './composition';
import { KeyValueBackend, Library, MAX_SAVES, Progress, SafeStorage } from './storage';
import { CompositionStore, StoreEvent } from './store';

const memoryBackend = (): KeyValueBackend => {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

const brokenBackend: KeyValueBackend = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('quota');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

const sample = (): Composition => ({
  bpm: 96,
  sceneId: 2,
  orbs: [
    { id: 1, step: 0, degree: 4, band: 0 },
    { id: 2, step: 8, degree: 2, band: 2 },
  ],
});

describe('serialization', () => {
  it('round-trips a composition', () => {
    const restored = deserialize(serialize(sample()));
    expect(restored?.bpm).toBe(96);
    expect(restored?.sceneId).toBe(2);
    expect(restored?.orbs.map(({ step, degree, band }) => [step, degree, band]))
      .toEqual([[0, 4, 0], [8, 2, 2]]);
  });

  it('round-trips an orb stuck to the room', () => {
    const spot = { azimuth: 1.234, elevation: -0.25, distance: 2.5 };
    const composition: Composition = {
      ...sample(),
      orbs: [{ id: 1, step: 3, degree: 4, band: 3, spot }],
    };
    expect(deserialize(serialize(composition))?.orbs[0].spot).toEqual(spot);
  });

  it('still opens saves from before orbs could leave the ring', () => {
    const old = JSON.stringify({ v: 1, b: 90, s: 0, o: [[0, 1, 0], [4, 2, 2]] });
    const restored = deserialize(old);
    expect(restored?.orbs).toHaveLength(2);
    expect(restored?.orbs[0].spot).toBeUndefined();
  });

  it('drops a room orb with no spot, or a broken one', () => {
    const text = JSON.stringify({
      v: 2,
      b: 90,
      s: 0,
      o: [[0, 1, 3], [1, 1, 3, 'x', 0, 100], [2, 1, 3, 0, 0, 0], [3, 1, 3, 0, 0, 100]],
    });
    expect(deserialize(text)?.orbs.map((orb) => orb.step)).toEqual([3]);
  });

  it('rejects data that is not a composition', () => {
    expect(deserialize('not json')).toBeNull();
    expect(deserialize('null')).toBeNull();
    expect(deserialize('{"v":99,"o":[]}')).toBeNull();
    expect(deserialize('{"v":1}')).toBeNull();
  });

  it('skips damaged orbs and keeps the valid ones', () => {
    const text = JSON.stringify({
      v: 1,
      b: 90,
      s: 0,
      o: [[0, 1, 0], [99, 1, 0], [1, -1, 0], [2, 3, 9], 'junk', [3, 3, 1.5]],
    });
    expect(deserialize(text)?.orbs).toHaveLength(1);
  });

  it('drops duplicates and caps the number of orbs', () => {
    const cells = Array.from({ length: 60 }, (_, i) => [i % 16, i % 11, i % 3]);
    const text = JSON.stringify({ v: 1, b: 90, s: 0, o: [...cells, cells[0]] });
    expect(deserialize(text)?.orbs).toHaveLength(MAX_ORBS);
    const twin = JSON.stringify({ v: 1, b: 90, s: 0, o: [[1, 1, 1], [1, 1, 1]] });
    expect(deserialize(twin)?.orbs).toHaveLength(1);
  });

  it('clamps an out-of-range tempo and defaults a bad scene', () => {
    const text = JSON.stringify({ v: 1, b: 9000, s: 77, o: [] });
    expect(deserialize(text)?.bpm).toBe(140);
    expect(deserialize(text)?.sceneId).toBe(0);
  });
});

describe('CompositionStore', () => {
  it('adds, moves and removes orbs', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 1, degree: 2, band: 0 }) as OrbData;
    store.move(orb.id, { step: 5, degree: 2, band: 1 });
    expect(store.find(orb.id)).toMatchObject({ step: 5, band: 1 });
    store.remove(orb.id);
    expect(store.orbs).toHaveLength(0);
  });

  it('never lets two orbs share a cell', () => {
    const store = new CompositionStore();
    store.add({ step: 1, degree: 2, band: 0 });
    const second = store.add({ step: 1, degree: 2, band: 0 });
    expect(second?.degree).not.toBe(2);
  });

  it('refuses orbs beyond the maximum', () => {
    const store = new CompositionStore();
    for (let i = 0; i < MAX_ORBS; i++) {
      store.add({ step: i % 16, degree: i % 11, band: i % 3 });
    }
    expect(store.add({ step: 0, degree: 0, band: 0 })).toBeNull();
  });

  it('undoes add, move, remove and clear in order', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 1, degree: 2, band: 0 }) as OrbData;
    store.move(orb.id, { step: 3, degree: 3, band: 1 });
    store.clear();
    expect(store.orbs).toHaveLength(0);
    store.undo();
    expect(store.orbs[0]).toMatchObject({ step: 3 });
    store.undo();
    expect(store.orbs[0]).toMatchObject({ step: 1 });
    store.undo();
    expect(store.orbs).toHaveLength(0);
    expect(store.undo()).toBe(false);
  });

  it('adds no undo entry for a move that changes nothing', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 1, degree: 2, band: 0 }) as OrbData;
    store.move(orb.id, { step: 1, degree: 2, band: 0 });
    store.undo();
    expect(store.orbs).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('sticks an orb to the room and brings it back to the ring', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 1, degree: 2, band: 0 }) as OrbData;
    const spot = { azimuth: 0.4, elevation: 0, distance: 2 };
    store.move(orb.id, { step: 1, degree: 2, band: 3 }, true, spot);
    expect(store.find(orb.id)?.spot).toEqual(spot);
    store.move(orb.id, { step: 5, degree: 2, band: 1 });
    expect(store.find(orb.id)?.spot).toBeUndefined();
    store.undo();
    expect(store.find(orb.id)?.spot).toEqual(spot);
  });

  it('treats a new spot on the same cell as a real move', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 1, degree: 2, band: 3 }) as OrbData;
    const spot = { azimuth: 0.4, elevation: 0, distance: 2 };
    store.move(orb.id, { step: 1, degree: 2, band: 3 }, true, spot);
    expect(store.find(orb.id)?.spot).toEqual(spot);
  });

  it('rotates the ring and leaves room orbs where they are', () => {
    const store = new CompositionStore();
    const ring = store.add({ step: 14, degree: 2, band: 0 }) as OrbData;
    const wall = store.add({ step: 3, degree: 2, band: 3 }) as OrbData;
    store.rotateRing(4);
    expect(store.find(ring.id)?.step).toBe(2);
    expect(store.find(wall.id)?.step).toBe(3);
    store.undo();
    expect(store.find(ring.id)?.step).toBe(14);
  });

  it('has nothing to rotate with an empty ring', () => {
    const store = new CompositionStore();
    store.add({ step: 3, degree: 2, band: 3 });
    expect(store.rotateRing(4)).toBe(false);
  });

  it('retunes a room orb without touching undo or saved state', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 3, degree: 2, band: 3 }) as OrbData;
    const { revision } = store;
    store.setRoomBand(orb.id, 5);
    expect(store.find(orb.id)?.band).toBe(5);
    expect(store.revision).toBe(revision);
    store.undo();
    expect(store.canUndo).toBe(false);
  });

  it('folds the drag that places a new orb into a single undo', () => {
    const store = new CompositionStore();
    const orb = store.add({ step: 1, degree: 2, band: 0 }) as OrbData;
    store.move(orb.id, { step: 9, degree: 5, band: 1 }, false);
    expect(store.undo()).toBe(true);
    expect(store.orbs).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('reports changes to listeners', () => {
    const store = new CompositionStore();
    const events: StoreEvent['type'][] = [];
    store.subscribe((event) => events.push(event.type));
    store.add({ step: 0, degree: 0, band: 0 });
    store.setBpm(100);
    store.setScene(1);
    expect(events).toEqual(['add', 'bpm', 'scene']);
  });

  it('keeps ids unique after loading a composition', () => {
    const store = new CompositionStore();
    store.load(sample());
    const orb = store.add({ step: 3, degree: 3, band: 1 }) as OrbData;
    expect(orb.id).toBe(3);
  });

  it('does not share memory with snapshots or loaded data', () => {
    const store = new CompositionStore();
    const source = sample();
    store.load(source);
    source.orbs[0].step = 15;
    expect(store.orbs[0].step).toBe(0);
    store.snapshot().orbs[0].step = 15;
    expect(store.orbs[0].step).toBe(0);
  });
});

describe('storage', () => {
  it('survives a backend that throws', () => {
    const storage = new SafeStorage(() => brokenBackend);
    expect(storage.set('a', '1')).toBe(false);
    expect(storage.get('a')).toBe('1');
  });

  it('survives a backend that cannot even be reached', () => {
    const storage = new SafeStorage(() => {
      throw new Error('SecurityError');
    });
    expect(storage.get('missing')).toBeNull();
    storage.set('a', '1');
    expect(storage.get('a')).toBe('1');
  });

  it('keeps data across visits', () => {
    const backend = memoryBackend();
    const library = new Library(new SafeStorage(() => backend));
    library.save(sample(), null, 10);
    const reopened = new Library(new SafeStorage(() => backend));
    expect(reopened.list()).toHaveLength(1);
    expect(reopened.list()[0].composition.bpm).toBe(96);
  });

  it('keeps six saves, most recent first, replacing the oldest', () => {
    const library = new Library(new SafeStorage(memoryBackend));
    for (let i = 0; i < MAX_SAVES + 2; i++) {
      library.save({ ...emptyComposition(), bpm: 60 + i }, null, i);
    }
    expect(library.list()).toHaveLength(MAX_SAVES);
    expect(library.list()[0].composition.bpm).toBe(60 + MAX_SAVES + 1);
  });

  it('overwrites an entry when saving under its id', () => {
    const library = new Library(new SafeStorage(memoryBackend));
    const id = library.save(sample(), null, 1);
    library.save(emptyComposition(), null, 2);
    library.save({ ...sample(), bpm: 70 }, id, 3);
    expect(library.list()).toHaveLength(2);
    expect(library.list()[0]).toMatchObject({ id, savedAt: 3 });
  });

  it('ignores a corrupted library', () => {
    const backend = memoryBackend();
    backend.setItem('orbly.saves', '{oops');
    expect(new Library(new SafeStorage(() => backend)).list()).toHaveLength(0);
  });

  it('remembers onboarding and finished challenges', () => {
    const backend = memoryBackend();
    const progress = new Progress(new SafeStorage(() => backend));
    expect(progress.onboarded).toBe(false);
    progress.markOnboarded();
    progress.markChallengeDone('2026-11-05');
    const later = new Progress(new SafeStorage(() => backend));
    expect(later.onboarded).toBe(true);
    expect(later.challengeDone('2026-11-05')).toBe(true);
    expect(later.challengeDone('2026-11-06')).toBe(false);
  });
});

describe('daily challenge', () => {
  it('is the same all day and deterministic', () => {
    const morning = new Date(2026, 10, 5, 8);
    const night = new Date(2026, 10, 5, 23);
    expect(challengeFor(morning).id).toBe(challengeFor(night).id);
  });

  it('varies over time and uses every challenge', () => {
    const used = new Set<string>();
    for (let day = 0; day < 200; day++) {
      used.add(challengeFor(new Date(2026, 0, 1 + day)).id);
    }
    expect(used.size).toBe(CHALLENGES.length);
  });

  it('formats the date key with padding', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('checks each goal', () => {
    const by = (id: string) => CHALLENGES.find((c) => c.id === id)!;
    const orbs = (cells: number[][]): Composition => ({
      ...emptyComposition(),
      orbs: cells.map(([step, degree, band], i) => ({ id: i, step, degree, band })),
    });
    expect(by('five-orbs').isMet(orbs([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0]]))).toBe(true);
    expect(by('all-instruments').isMet(orbs([[0, 0, 0], [1, 0, 1], [2, 0, 2]]))).toBe(true);
    expect(by('all-instruments').isMet(orbs([[0, 0, 0], [1, 0, 1]]))).toBe(false);
    expect(by('four-corners').isMet(orbs([[0, 0, 0], [4, 0, 0], [8, 0, 0], [12, 0, 0]]))).toBe(true);
    expect(by('chord').isMet(orbs([[3, 0, 0], [3, 1, 0], [3, 2, 0]]))).toBe(true);
    expect(by('high-notes').isMet(orbs([[0, 8, 0], [1, 9, 0], [2, 10, 0]]))).toBe(true);
    expect(by('eight-steps').isMet(orbs([[0, 0, 0], [0, 1, 0]]))).toBe(false);
    const spot = { azimuth: 0, elevation: 0, distance: 2 };
    const inRoom = (bands: number[]): Composition => ({
      ...emptyComposition(),
      orbs: bands.map((band, i) => ({ id: i, step: i, degree: 0, band, spot })),
    });
    expect(by('room-band').isMet(inRoom([3, 4, 5]))).toBe(true);
    expect(by('room-band').isMet(inRoom([3, 3, 4]))).toBe(false);
    expect(by('bass-line').isMet(orbs([[0, 0, 2], [1, 0, 2], [2, 0, 2], [3, 0, 2]]))).toBe(true);
  });
});
