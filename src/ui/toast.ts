import { Vector3 } from '@iwsdk/core';
import { Label } from './label';

const SHOW_SECONDS = 1.7;
const FADE_SECONDS = 0.25;
const DISTANCE = 0.62;
const BELOW_EYES = 0.1;
const ABOVE_PANEL = 0.17;

/** A short message that appears in front of the user and fades away. */
export class Toast {
  private readonly label = new Label({
    lineHeight: 0.036,
    width: 1024,
    height: 110,
    plate: true,
  });
  private remaining = 0;

  constructor() {
    this.label.opacity = 0;
  }

  get object() {
    return this.label.object;
  }

  /**
   * @param near an open panel to appear above, so the message never covers
   * what the user is looking at; null places it straight ahead.
   */
  show(
    text: string,
    head: Vector3,
    forward: Vector3,
    near: Vector3 | null,
  ): void {
    this.label.setText(text);
    this.remaining = SHOW_SECONDS;
    const { object } = this.label;
    if (near !== null) {
      object.position.copy(near);
      object.position.y += ABOVE_PANEL;
    } else {
      object.position.copy(head).addScaledVector(forward, DISTANCE);
      object.position.y -= BELOW_EYES;
    }
    object.lookAt(head);
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    const fadeOut = Math.min(1, this.remaining / FADE_SECONDS);
    const fadeIn = Math.min(1, (SHOW_SECONDS - this.remaining) / FADE_SECONDS);
    this.label.opacity = Math.min(fadeIn, fadeOut);
  }
}
