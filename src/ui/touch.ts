/**
 * Direct touch on floating spheres: press one with a fingertip, or pinch next
 * to it. A hand must first be away from all targets, so a screen that appears
 * under a resting hand does not fire by itself.
 */

import { Vec3Like } from '../sequencer/mapping';

export interface TouchTarget extends Vec3Like {
  radius: number;
}

const PINCH_MARGIN = 0.045;
const REST_SECONDS = 0.15;

export class TouchTargets {
  private readonly restTime = [0, 0];

  constructor(private targets: readonly TouchTarget[] = []) {}

  setTargets(targets: readonly TouchTarget[]): void {
    this.targets = targets;
  }

  reset(): void {
    this.restTime[0] = 0;
    this.restTime[1] = 0;
  }

  /** Closest target whose surface is within `margin` of the point, or -1. */
  nearest(point: Vec3Like, margin: number): number {
    let best = -1;
    let bestGap = Infinity;
    this.targets.forEach((target, index) => {
      const distance = Math.hypot(
        target.x - point.x,
        target.y - point.y,
        target.z - point.z,
      );
      const gap = distance - target.radius;
      if (gap <= margin && gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    });
    return best;
  }

  /**
   * @param tip fingertip of this hand, or null when it is not tracked.
   * @param pinchPoint where its pinch acts.
   * @param pinchStarted the pinch began this frame.
   * @returns the target pressed this frame, or -1.
   */
  update(
    hand: number,
    tip: Vec3Like | null,
    pinchPoint: Vec3Like,
    pinchStarted: boolean,
    dt: number,
  ): number {
    if (tip === null) {
      this.restTime[hand] = 0;
      return -1;
    }
    if (pinchStarted) {
      const pinched = this.nearest(pinchPoint, PINCH_MARGIN);
      if (pinched >= 0) {
        this.restTime[hand] = 0;
        return pinched;
      }
    }
    const touched = this.nearest(tip, 0);
    if (touched < 0) {
      this.restTime[hand] += dt;
      return -1;
    }
    const armed = this.restTime[hand] >= REST_SECONDS;
    this.restTime[hand] = 0;
    return armed ? touched : -1;
  }
}
