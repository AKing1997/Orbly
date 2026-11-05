import { Vector3 } from '@iwsdk/core';
import { HeadView, keepInView } from './comfort';
import { Label } from './label';

const SHOW_SECONDS = 1.7;
const FADE_SECONDS = 0.25;
const DISTANCE = 0.62;
const BELOW_EYES = 0.1;
const ABOVE_PANEL = 0.17;
const HALF_WIDTH = 0.26;
const HALF_HEIGHT = 0.04;

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
  show(text: string, view: HeadView, near: Vector3 | null): void {
    this.label.setText(text);
    this.remaining = SHOW_SECONDS;
    const { object } = this.label;
    if (near !== null) {
      object.position.copy(near);
      object.position.y += ABOVE_PANEL;
    } else {
      object.position
        .copy(view.position as Vector3)
        .addScaledVector(view.forward as Vector3, DISTANCE);
      object.position.y -= BELOW_EYES;
    }
    keepInView(object.position, view, HALF_WIDTH, HALF_HEIGHT);
    object.lookAt(view.position as Vector3);
  }

  update(dt: number): void {
    if (this.remaining <= 0) return;
    this.remaining = Math.max(0, this.remaining - dt);
    const fadeOut = Math.min(1, this.remaining / FADE_SECONDS);
    const fadeIn = Math.min(1, (SHOW_SECONDS - this.remaining) / FADE_SECONDS);
    this.label.opacity = Math.min(fadeIn, fadeOut);
  }
}
