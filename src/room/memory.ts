/**
 * What makes a song stay on your walls. Tracking restarts from a new origin
 * every session, so a song is pinned to one persistent anchor, fixed where the
 * user sat when it was made, and its orbs are stored relative to that frame.
 * WebXR stays behind `AnchorBackend`, so all of this runs in tests.
 */

import { BASE_BELOW_HEAD, Stage } from '../sequencer/mapping';

/** A point in the real room that outlives the session. */
export interface RoomAnchor {
  readonly uuid: string;
  /** Pose as a column-major matrix, or null while it is not found here. */
  pose(): ArrayLike<number> | null;
}

export interface AnchorBackend {
  create(stage: Stage): Promise<RoomAnchor | null>;
  restore(uuid: string): Promise<RoomAnchor | null>;
  remove(uuid: string): void;
  /** Every anchor this site holds on the device. */
  list(): readonly string[];
}

const SAME_POSITION = 0.02;
const SAME_YAW = 0.025;

/** Rebuilds a song's frame from where its anchor is now. */
export function stageFromPose(
  matrix: ArrayLike<number>,
  floorY: number,
): Stage {
  return {
    x: matrix[12],
    z: matrix[14],
    yaw: Math.atan2(matrix[8], matrix[10]),
    baseY: matrix[13] - BASE_BELOW_HEAD,
    floorY,
  };
}

/** True when two frames match closely enough that nothing needs to move. */
export function sameFrame(a: Stage, b: Stage): boolean {
  const turn = Math.atan2(Math.sin(a.yaw - b.yaw), Math.cos(a.yaw - b.yaw));
  return (
    Math.abs(a.x - b.x) < SAME_POSITION &&
    Math.abs(a.z - b.z) < SAME_POSITION &&
    Math.abs(a.baseY - b.baseY) < SAME_POSITION &&
    Math.abs(turn) < SAME_YAW
  );
}

export class RoomMemory {
  private readonly anchors = new Map<string, RoomAnchor>();
  private readonly restoring = new Set<string>();
  /** Bumped when a session ends, so a late answer cannot land in the next. */
  private generation = 0;

  constructor(private readonly backend: AnchorBackend) {}

  /** Starts looking for these anchors. Those not found simply stay unknown. */
  recall(uuids: Iterable<string>): void {
    const { generation } = this;
    for (const uuid of uuids) {
      if (this.anchors.has(uuid) || this.restoring.has(uuid)) continue;
      this.restoring.add(uuid);
      this.backend
        .restore(uuid)
        .catch(() => null)
        .then((anchor) => {
          if (generation !== this.generation) return;
          this.restoring.delete(uuid);
          if (anchor !== null) this.anchors.set(uuid, anchor);
        });
    }
  }

  /** The frame a song was made in, if its anchor can be found right now. */
  locate(uuid: string, floorY: number): Stage | null {
    const pose = this.anchors.get(uuid)?.pose() ?? null;
    return pose === null ? null : stageFromPose(pose, floorY);
  }

  isHere(uuid: string): boolean {
    return (this.anchors.get(uuid)?.pose() ?? null) !== null;
  }

  /** Fixes a new anchor at this frame. Null when the device cannot. */
  async pin(stage: Stage): Promise<string | null> {
    const { generation } = this;
    const anchor = await this.backend.create(stage).catch(() => null);
    if (anchor === null) return null;
    if (generation !== this.generation) {
      this.backend.remove(anchor.uuid);
      return null;
    }
    this.anchors.set(anchor.uuid, anchor);
    return anchor.uuid;
  }

  /** Frees anchors no saved song uses: a site may only hold a few of them. */
  prune(keep: ReadonlySet<string>): void {
    for (const uuid of this.backend.list()) {
      if (!keep.has(uuid)) this.backend.remove(uuid);
    }
  }

  /** Anchors belong to a session: the next one has to find them again. */
  reset(): void {
    this.generation++;
    this.anchors.clear();
    this.restoring.clear();
  }
}
