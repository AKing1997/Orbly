/**
 * Sparks computed entirely in the vertex shader from their birth data, so the
 * CPU only touches the buffers on the frame a burst starts.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Points,
  ShaderMaterial,
} from '@iwsdk/core';
import { Vec3Like } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

const COMET_SPARKS = 6;
/** The vertex shader eases motion, covering this share of the path by the end. */
const ARRIVAL_EASING = 0.55;

export interface BurstOptions {
  count: number;
  speed: number;
  size: number;
  life: number;
  /** Lifts the burst upward: 0 is a sphere, 1 a fountain. */
  lift?: number;
}

export class Particles {
  readonly object: Points;
  private readonly material: ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly colors: Float32Array;
  private readonly births: Float32Array;
  private readonly attributes: BufferAttribute[];
  private cursor = 0;
  private time = 0;

  constructor(private readonly capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.births = new Float32Array(capacity * 3).fill(-100);
    const geometry = new BufferGeometry();
    const make = (data: Float32Array) => {
      const attribute = new BufferAttribute(data, 3);
      attribute.setUsage(DynamicDrawUsage);
      return attribute;
    };
    this.attributes = [
      make(this.positions),
      make(this.velocities),
      make(this.colors),
      make(this.births),
    ];
    geometry.setAttribute('position', this.attributes[0]);
    geometry.setAttribute('aVelocity', this.attributes[1]);
    geometry.setAttribute('aColor', this.attributes[2]);
    geometry.setAttribute('aBirth', this.attributes[3]);
    this.material = lightMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPixelsPerUnit: { value: 900 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aVelocity;
        attribute vec3 aColor;
        attribute vec3 aBirth; // start time, life, size
        uniform float uTime;
        uniform float uPixelsPerUnit;
        varying vec3 vColor;
        varying float vFade;
        void main() {
          float age = uTime - aBirth.x;
          float t = age / aBirth.y;
          if (t < 0.0 || t >= 1.0) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            gl_PointSize = 0.0;
            vFade = 0.0;
            return;
          }
          float eased = age * (1.0 - 0.45 * t);
          vec3 p = position + aVelocity * eased;
          p.y -= 0.12 * age * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min(64.0, aBirth.z * (1.0 - t * 0.6) * uPixelsPerUnit / max(0.05, -mv.z));
          vColor = aColor;
          vFade = (1.0 - t) * (1.0 - t);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vFade;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float d = dot(q, q) * 4.0;
          if (d > 1.0) discard;
          float a = (1.0 - d) * (1.0 - d) * vFade;
          gl_FragColor = vec4((vColor + 0.15) * a, a * 0.3);
        }
      `,
    });
    this.object = new Points(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 5;
  }

  /** Point size is in pixels: it needs the projected pixels per metre. */
  setPixelsPerUnit(value: number): void {
    this.material.uniforms.uPixelsPerUnit.value = value;
  }

  burst(x: number, y: number, z: number, color: Rgb, options: BurstOptions): void {
    const { count, speed, size, life } = options;
    const lift = options.lift ?? 0;
    for (let i = 0; i < count; i++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const azimuth = Math.random() * Math.PI * 2;
      const cosine = Math.random() * 2 - 1;
      const sine = Math.sqrt(1 - cosine * cosine);
      const pace = speed * (0.45 + Math.random() * 0.55);
      const p = index * 3;
      this.positions[p] = x;
      this.positions[p + 1] = y;
      this.positions[p + 2] = z;
      this.velocities[p] = Math.cos(azimuth) * sine * pace;
      this.velocities[p + 1] = (cosine + lift) * pace;
      this.velocities[p + 2] = Math.sin(azimuth) * sine * pace;
      this.colors[p] = color[0];
      this.colors[p + 1] = color[1];
      this.colors[p + 2] = color[2];
      this.births[p] = this.time;
      this.births[p + 1] = life * (0.6 + Math.random() * 0.4);
      this.births[p + 2] = size * (0.6 + Math.random() * 0.6);
    }
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }

  /** A small comet of sparks flying from one point to another. */
  comet(from: Vec3Like, to: Vec3Like, color: Rgb, life: number): void {
    for (let i = 0; i < COMET_SPARKS; i++) {
      const index = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const p = index * 3;
      // The trail: later sparks start a moment behind and travel the same way.
      const spread = life * (1 - i * 0.09);
      const speed = 1 / (spread * ARRIVAL_EASING);
      this.positions[p] = from.x;
      this.positions[p + 1] = from.y;
      this.positions[p + 2] = from.z;
      this.velocities[p] = (to.x - from.x) * speed;
      this.velocities[p + 1] = (to.y - from.y) * speed;
      this.velocities[p + 2] = (to.z - from.z) * speed;
      this.colors[p] = color[0];
      this.colors[p + 1] = color[1];
      this.colors[p + 2] = color[2];
      this.births[p] = this.time;
      this.births[p + 1] = spread;
      this.births[p + 2] = 0.011 * (1 - i * 0.12);
    }
    for (const attribute of this.attributes) attribute.needsUpdate = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime.value = this.time;
  }
}
