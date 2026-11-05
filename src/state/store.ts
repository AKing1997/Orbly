/** Editable composition with undo. The single source of truth for orbs. */

import { nearestFreeSlot, Slot } from '../sequencer/mapping';
import {
  clampBpm,
  Composition,
  emptyComposition,
  MAX_ORBS,
  OrbData,
  SCENE_COUNT,
} from './composition';

const MAX_UNDO = 64;

export type StoreEvent =
  | { type: 'add'; orb: OrbData }
  | { type: 'move'; orb: OrbData }
  | { type: 'remove'; orb: OrbData }
  | { type: 'reset' }
  | { type: 'bpm'; bpm: number }
  | { type: 'scene'; sceneId: number };

export type StoreListener = (event: StoreEvent) => void;

export class CompositionStore {
  private composition: Composition = emptyComposition();
  private undoStack: OrbData[][] = [];
  private nextId = 1;
  private listeners: StoreListener[] = [];
  /** Revision bumped by every orb change; lets callers detect unsaved work. */
  revision = 0;

  subscribe(listener: StoreListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((other) => other !== listener);
    };
  }

  get orbs(): readonly OrbData[] {
    return this.composition.orbs;
  }

  get bpm(): number {
    return this.composition.bpm;
  }

  get sceneId(): number {
    return this.composition.sceneId;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get isFull(): boolean {
    return this.composition.orbs.length >= MAX_ORBS;
  }

  snapshot(): Composition {
    return {
      ...this.composition,
      orbs: this.composition.orbs.map((orb) => ({ ...orb })),
    };
  }

  find(id: number): OrbData | undefined {
    return this.composition.orbs.find((orb) => orb.id === id);
  }

  /** Orbs at a step, written to `out` so the audio path never allocates. */
  orbsAtStep(step: number, out: OrbData[]): OrbData[] {
    out.length = 0;
    const { orbs } = this.composition;
    for (let i = 0; i < orbs.length; i++) {
      if (orbs[i].step === step) out.push(orbs[i]);
    }
    return out;
  }

  add(slot: Slot): OrbData | null {
    if (this.isFull) return null;
    const free = this.freeSlotFor(slot, -1);
    if (free === null) return null;
    this.pushUndo();
    const orb: OrbData = { id: this.nextId++, ...free };
    this.composition.orbs.push(orb);
    this.changed({ type: 'add', orb });
    return orb;
  }

  /**
   * Moves an orb; a no-op (with no undo entry) if the cell does not change.
   * Pass `undoable = false` to fold the move into the previous undo entry,
   * as for the drag that finishes creating an orb.
   */
  move(id: number, slot: Slot, undoable = true): OrbData | null {
    const orb = this.find(id);
    if (orb === undefined) return null;
    const free = this.freeSlotFor(slot, id);
    if (free === null) return null;
    if (
      free.step === orb.step && free.degree === orb.degree &&
      free.band === orb.band
    ) {
      return orb;
    }
    if (undoable) this.pushUndo();
    orb.step = free.step;
    orb.degree = free.degree;
    orb.band = free.band;
    this.changed({ type: 'move', orb });
    return orb;
  }

  remove(id: number): boolean {
    const index = this.composition.orbs.findIndex((orb) => orb.id === id);
    if (index < 0) return false;
    this.pushUndo();
    const [orb] = this.composition.orbs.splice(index, 1);
    this.changed({ type: 'remove', orb });
    return true;
  }

  clear(): void {
    if (this.composition.orbs.length === 0) return;
    this.pushUndo();
    this.composition.orbs = [];
    this.changed({ type: 'reset' });
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (previous === undefined) return false;
    this.composition.orbs = previous;
    this.changed({ type: 'reset' });
    return true;
  }

  /** Replaces everything, as when opening a saved composition. */
  load(composition: Composition): void {
    this.composition = {
      ...composition,
      orbs: composition.orbs.map((orb) => ({ ...orb })),
    };
    this.nextId = this.composition.orbs.reduce(
      (max, orb) => Math.max(max, orb.id + 1),
      1,
    );
    this.undoStack = [];
    this.changed({ type: 'reset' });
    this.notify({ type: 'bpm', bpm: this.composition.bpm });
    this.notify({ type: 'scene', sceneId: this.composition.sceneId });
  }

  setBpm(bpm: number): void {
    const value = clampBpm(bpm);
    if (value === this.composition.bpm) return;
    this.composition.bpm = value;
    this.notify({ type: 'bpm', bpm: value });
  }

  setScene(sceneId: number): void {
    const value = ((sceneId % SCENE_COUNT) + SCENE_COUNT) % SCENE_COUNT;
    if (value === this.composition.sceneId) return;
    this.composition.sceneId = value;
    this.notify({ type: 'scene', sceneId: value });
  }

  private freeSlotFor(slot: Slot, ignoreId: number): Slot | null {
    const { orbs } = this.composition;
    return nearestFreeSlot(slot, (step, degree, band) =>
      orbs.some(
        (orb) =>
          orb.id !== ignoreId && orb.step === step && orb.degree === degree &&
          orb.band === band,
      ),
    );
  }

  private pushUndo(): void {
    this.undoStack.push(this.composition.orbs.map((orb) => ({ ...orb })));
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private changed(event: StoreEvent): void {
    this.revision++;
    this.notify(event);
  }

  private notify(event: StoreEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
