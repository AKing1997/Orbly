import { createSystem } from '@iwsdk/core';
import { OrblyApp } from './app';

/** The one ECS system: it hands the frame over to the app. */
export class OrblySystem extends createSystem({}) {
  private app!: OrblyApp;

  init(): void {
    this.app = new OrblyApp(this.world);
    if (import.meta.env.DEV) {
      (globalThis as unknown as { orbly: OrblyApp }).orbly = this.app;
    }
  }

  update(delta: number, time: number): void {
    this.app.update(delta, time);
  }
}
