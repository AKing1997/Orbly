import { Group, Vector3, World } from '@iwsdk/core';

/** Head pose in world space, valid inside and outside XR. */
export class HeadPose {
  readonly position = new Vector3();
  readonly forward = new Vector3(0, 0, -1);
  readonly up = new Vector3(0, 1, 0);
  private readonly source: Group;

  constructor(private readonly world: World) {
    this.source = world.player.head;
  }

  update(): void {
    const object = this.world.session ? this.source : this.world.camera;
    object.updateWorldMatrix(true, false);
    const e = object.matrixWorld.elements;
    this.position.set(e[12], e[13], e[14]);
    this.forward.set(-e[8], -e[9], -e[10]).normalize();
    this.up.set(e[4], e[5], e[6]).normalize();
  }

  /** Heading around +Y using the three.js yaw convention. */
  get yaw(): number {
    return Math.atan2(-this.forward.x, -this.forward.z);
  }
}
