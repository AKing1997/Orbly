/** A thin line of light from the hand to the far orb it is about to call. */

import {
  CylinderGeometry,
  Mesh,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { Vec3Like } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

const RADIUS = 0.0016;
const UP = new Vector3(0, 1, 0);

export class Tether {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;
  private readonly from = new Vector3();
  private readonly to = new Vector3();
  private readonly direction = new Vector3();
  private readonly rotation = new Quaternion();

  constructor() {
    const geometry = new CylinderGeometry(1, 1, 1, 6, 1, true);
    geometry.translate(0, 0.5, 0);
    this.material = lightMaterial({
      uniforms: { uColor: { value: new Vector3(1, 1, 1) } },
      vertexShader: /* glsl */ `
        varying float vAlong;
        void main() {
          vAlong = uv.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vAlong;
        void main() {
          float a = 0.5 * smoothstep(0.0, 0.2, vAlong);
          gl_FragColor = vec4(uColor * a, a * 0.3);
        }
      `,
    });
    this.object = new Mesh(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 6;
    this.object.visible = false;
  }

  hide(): void {
    this.object.visible = false;
  }

  show(from: Vec3Like, to: Vec3Like, color: Rgb): void {
    this.from.set(from.x, from.y, from.z);
    this.to.set(to.x, to.y, to.z);
    this.direction.subVectors(this.to, this.from);
    const length = this.direction.length();
    if (length < 1e-3) {
      this.hide();
      return;
    }
    this.rotation.setFromUnitVectors(UP, this.direction.divideScalar(length));
    this.object.position.copy(this.from);
    this.object.quaternion.copy(this.rotation);
    this.object.scale.set(RADIUS, length, RADIUS);
    (this.material.uniforms.uColor.value as Vector3).set(
      color[0],
      color[1],
      color[2],
    );
    this.object.visible = true;
  }
}
