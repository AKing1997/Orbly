import { describe, expect, it } from 'vitest';
import { makeStage, Stage } from '../sequencer/mapping';
import { AnchorBackend, RoomAnchor, RoomMemory, sameFrame, stageFromPose } from './memory';
import { resolveSpot, stageEye, toSpot } from './surfaces';

/** Column-major pose of an anchor at the eyes of a stage, turned by its yaw. */
function poseOf(stage: Stage): number[] {
  const eye = stageEye(stage);
  const c = Math.cos(stage.yaw);
  const s = Math.sin(stage.yaw);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, eye.x, eye.y, eye.z, 1];
}

class FakeBackend implements AnchorBackend {
  stored = new Map<string, number[] | null>();
  removed: string[] = [];
  canCreate = true;
  private next = 1;

  private wrap(uuid: string): RoomAnchor {
    return { uuid, pose: () => this.stored.get(uuid) ?? null };
  }

  async create(stage: Stage): Promise<RoomAnchor | null> {
    if (!this.canCreate) return null;
    const uuid = `anchor-${this.next++}`;
    this.stored.set(uuid, poseOf(stage));
    return this.wrap(uuid);
  }

  async restore(uuid: string): Promise<RoomAnchor | null> {
    if (!this.stored.has(uuid)) throw new Error('not found');
    return this.wrap(uuid);
  }

  remove(uuid: string): void {
    this.removed.push(uuid);
    this.stored.delete(uuid);
  }

  list(): readonly string[] {
    return [...this.stored.keys()];
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const stage = makeStage({ x: 0.5, y: 1.2, z: -0.3 }, 0.7, 0);

describe('stageFromPose', () => {
  it('rebuilds the frame a song was made in', () => {
    const rebuilt = stageFromPose(poseOf(stage), 0);
    expect(rebuilt.x).toBeCloseTo(stage.x);
    expect(rebuilt.z).toBeCloseTo(stage.z);
    expect(rebuilt.yaw).toBeCloseTo(stage.yaw);
    expect(rebuilt.baseY).toBeCloseTo(stage.baseY);
  });

  it('keeps an orb on its wall across sessions with different origins', () => {
    const point = { x: 2.1, y: 1.4, z: -2.5 };
    const spot = toSpot(point, stage);
    // Next session: the same anchor is found, whatever the user's new pose is.
    const restored = stageFromPose(poseOf(stage), 0);
    const resolved = resolveSpot(spot, restored, []);
    expect(resolved.point.x).toBeCloseTo(point.x);
    expect(resolved.point.y).toBeCloseTo(point.y);
    expect(resolved.point.z).toBeCloseTo(point.z);
  });
});

describe('sameFrame', () => {
  it('ignores tracking jitter', () => {
    expect(sameFrame(stage, { ...stage, x: stage.x + 0.005 })).toBe(true);
  });

  it('notices a real shift or turn', () => {
    expect(sameFrame(stage, { ...stage, z: stage.z + 0.1 })).toBe(false);
    expect(sameFrame(stage, { ...stage, yaw: stage.yaw + 0.2 })).toBe(false);
  });

  it('treats a full turn as no turn', () => {
    expect(sameFrame(stage, { ...stage, yaw: stage.yaw + Math.PI * 2 })).toBe(true);
  });
});

describe('RoomMemory', () => {
  const setup = () => {
    const backend = new FakeBackend();
    return { backend, memory: new RoomMemory(backend) };
  };

  it('pins a song and can locate it straight away', async () => {
    const { memory } = setup();
    const uuid = await memory.pin(stage);
    expect(memory.isHere(uuid as string)).toBe(true);
    expect(memory.locate(uuid as string, 0)?.x).toBeCloseTo(stage.x);
  });

  it('finds a song again in the next session', async () => {
    const { memory } = setup();
    const uuid = (await memory.pin(stage)) as string;
    memory.reset();
    expect(memory.isHere(uuid)).toBe(false);
    memory.recall([uuid]);
    await settle();
    expect(memory.isHere(uuid)).toBe(true);
  });

  it('does not see an anchor that exists but is not in this room', async () => {
    const { backend, memory } = setup();
    backend.stored.set('elsewhere', null);
    memory.recall(['elsewhere']);
    await settle();
    expect(memory.isHere('elsewhere')).toBe(false);
    expect(memory.locate('elsewhere', 0)).toBeNull();
  });

  it('shrugs off an anchor the device no longer has', async () => {
    const { memory } = setup();
    memory.recall(['gone']);
    await settle();
    expect(memory.isHere('gone')).toBe(false);
  });

  it('does not restore the same anchor twice at once', async () => {
    const { backend, memory } = setup();
    backend.stored.set('a', [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]);
    let calls = 0;
    const restore = backend.restore.bind(backend);
    backend.restore = (uuid) => {
      calls++;
      return restore(uuid);
    };
    memory.recall(['a']);
    memory.recall(['a']);
    await settle();
    memory.recall(['a']);
    expect(calls).toBe(1);
  });

  it('reports no pin on a device without anchors', async () => {
    const { backend, memory } = setup();
    backend.canCreate = false;
    expect(await memory.pin(stage)).toBeNull();
  });

  it('survives a device that rejects outright', async () => {
    const { backend, memory } = setup();
    backend.create = () => Promise.reject(new Error('no permission'));
    expect(await memory.pin(stage)).toBeNull();
  });

  it('ignores a restore that answers after the session ended', async () => {
    const { backend, memory } = setup();
    backend.stored.set('a', poseOf(stage));
    memory.recall(['a']);
    memory.reset();
    await settle();
    expect(memory.isHere('a')).toBe(false);
  });

  it('frees a pin that finishes after the session ended', async () => {
    const { backend, memory } = setup();
    const pending = memory.pin(stage);
    memory.reset();
    expect(await pending).toBeNull();
    expect(backend.removed).toHaveLength(1);
  });

  it('prunes anchors no saved song uses', async () => {
    const { backend, memory } = setup();
    const keep = (await memory.pin(stage)) as string;
    const orphan = (await memory.pin(stage)) as string;
    memory.prune(new Set([keep]));
    expect(backend.removed).toEqual([orphan]);
  });
});
