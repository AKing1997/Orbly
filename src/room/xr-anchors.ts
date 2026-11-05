/** WebXR persistent anchors, behind the interface `RoomMemory` needs. */

import { stageEye } from './surfaces';
import { AnchorBackend, RoomAnchor } from './memory';
import { Stage } from '../sequencer/mapping';

export class XRAnchorBackend implements AnchorBackend {
  private frame: XRFrame | null = null;
  private space: XRReferenceSpace | null = null;
  private session: XRSession | null = null;

  /** Anchors can only be made and read during a frame. */
  beginFrame(frame: XRFrame, space: XRReferenceSpace, session: XRSession): void {
    this.frame = frame;
    this.space = space;
    this.session = session;
  }

  /** An XRFrame must not outlive its callback: reading it later throws. */
  endFrame(): void {
    this.frame = null;
  }

  endSession(): void {
    this.frame = null;
    this.space = null;
    this.session = null;
  }

  async create(stage: Stage): Promise<RoomAnchor | null> {
    const { frame, space } = this;
    if (frame === null || space === null || frame.createAnchor === undefined) {
      return null;
    }
    const { x, y, z } = stageEye(stage);
    const half = stage.yaw / 2;
    const pose = new XRRigidTransform(
      { x, y, z },
      { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
    );
    const anchor = await frame.createAnchor(pose, space);
    // Without a handle it would vanish with the session: not worth keeping.
    const uuid = await anchor.requestPersistentHandle?.();
    if (uuid === undefined) {
      anchor.delete();
      return null;
    }
    return this.wrap(uuid, anchor);
  }

  async restore(uuid: string): Promise<RoomAnchor | null> {
    const anchor = await this.session?.restorePersistentAnchor?.(uuid);
    return anchor === undefined ? null : this.wrap(uuid, anchor);
  }

  remove(uuid: string): void {
    this.session?.deletePersistentAnchor?.(uuid)?.catch(() => undefined);
  }

  list(): readonly string[] {
    return this.session?.persistentAnchors ?? [];
  }

  private wrap(uuid: string, anchor: XRAnchor): RoomAnchor {
    return {
      uuid,
      pose: () => {
        const { frame, space } = this;
        if (frame === null || space === null) return null;
        return frame.getPose(anchor.anchorSpace, space)?.transform.matrix ?? null;
      },
    };
  }
}
