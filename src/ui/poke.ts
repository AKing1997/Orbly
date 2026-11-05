/**
 * Finger presses on a flat panel. Coordinates are panel-local metres, with +Z
 * pointing out of the panel towards the user. A press only counts when the
 * finger comes in from the front over a button, so brushing past the panel or
 * sliding across it cannot trigger anything.
 */

export interface PokeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PokeResult {
  hovered: number;
  pressed: number;
}

/** Above this the finger is clearly in front of the panel: a press can arm. */
const ARM_DISTANCE = 0.012;
const PRESS_DISTANCE = 0.002;
const RELEASE_DISTANCE = 0.014;
const HOVER_DISTANCE = 0.07;
const BEHIND_LIMIT = -0.05;
/** Buttons accept a slightly late finger: tracking lags a fast poke. */
const HIT_MARGIN = 0.004;
const COOLDOWN = 0.14;

export class PokePanel {
  private armed = -1;
  private down = false;
  private cooldown = 0;
  private readonly result: PokeResult = { hovered: -1, pressed: -1 };

  constructor(private readonly rects: readonly PokeRect[]) {}

  update(x: number, y: number, z: number, dt: number): PokeResult {
    const { result } = this;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const under = this.rectAt(x, y);
    result.hovered = z < HOVER_DISTANCE && z > BEHIND_LIMIT ? under : -1;
    result.pressed = -1;

    if (this.down) {
      if (z > RELEASE_DISTANCE) this.down = false;
      else return result;
    }

    if (z > ARM_DISTANCE) {
      this.armed = under;
    } else if (z <= PRESS_DISTANCE && z > BEHIND_LIMIT) {
      if (this.armed >= 0 && this.armed === under && this.cooldown === 0) {
        result.pressed = under;
        this.down = true;
        this.cooldown = COOLDOWN;
      }
      this.armed = -1;
    }
    return result;
  }

  /** Forgets the finger, as when the panel closes or the hand is lost. */
  reset(): void {
    this.armed = -1;
    this.down = false;
    this.result.hovered = -1;
    this.result.pressed = -1;
  }

  private rectAt(x: number, y: number): number {
    for (let i = 0; i < this.rects.length; i++) {
      const rect = this.rects[i];
      if (
        Math.abs(x - rect.x) <= rect.width / 2 + HIT_MARGIN &&
        Math.abs(y - rect.y) <= rect.height / 2 + HIT_MARGIN
      ) {
        return i;
      }
    }
    return -1;
  }
}
