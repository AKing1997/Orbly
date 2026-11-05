/**
 * Dims the real room for concert mode, like house lights going down. One sphere
 * around the user, so the light on the walls and the orbs shows up against it.
 */

import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

const RADIUS = 20;

export class RoomVeil {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;
  private readonly color = new Vector3();

  constructor() {
    this.material = lightMaterial({
      side: BackSide,
      depthTest: false,
      uniforms: {
        uColor: { value: this.color },
        uDarkness: { value: 0 },
      },
      vertexShader: /* glsl */ `
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uDarkness;
        void main() {
          gl_FragColor = vec4(uColor * uDarkness, uDarkness);
        }
      `,
    });
    this.object = new Mesh(new SphereGeometry(RADIUS, 16, 12), this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -5;
    this.object.visible = false;
  }

  setColor(color: Rgb): void {
    this.color.set(color[0], color[1], color[2]);
  }

  /** @param darkness 0 leaves the room alone, 1 blacks it out. */
  update(center: Vector3, darkness: number): void {
    this.object.visible = darkness > 0.004;
    this.object.position.copy(center);
    this.material.uniforms.uDarkness.value = darkness;
  }
}
