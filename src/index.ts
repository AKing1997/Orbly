import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { OrblySystem } from './app/system';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(OrblySystem);
  if (import.meta.env.DEV) {
    (globalThis as unknown as { world: World }).world = world;
  }
});
