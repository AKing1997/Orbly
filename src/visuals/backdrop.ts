/** The optional dark space: a gradient sky and twinkling stars. */

import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { lightMaterial } from './materials';
import { Palette } from './palettes';

const SKY_RADIUS = 60;
const STAR_COUNT = 420;
const STAR_RADIUS = 30;

export class Backdrop {
  readonly object = new Group();
  private readonly skyMaterial: ShaderMaterial;
  private readonly starMaterial: ShaderMaterial;
  private readonly stars: Points;
  private readonly top = new Vector3();
  private readonly bottom = new Vector3();
  private time = 0;

  constructor() {
    this.skyMaterial = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      uniforms: {
        uTop: { value: this.top },
        uBottom: { value: this.bottom },
        uBeat: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDirection;
        void main() {
          vDirection = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uBottom;
        uniform float uBeat;
        varying vec3 vDirection;
        void main() {
          float h = normalize(vDirection).y * 0.5 + 0.5;
          vec3 color = mix(uBottom, uTop, smoothstep(0.25, 0.85, h));
          color += uTop * uBeat * 0.3;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const sky = new Mesh(
      new SphereGeometry(SKY_RADIUS, 24, 16),
      this.skyMaterial,
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;

    const positions = new Float32Array(STAR_COUNT * 3);
    const seeds = new Float32Array(STAR_COUNT);
    for (let i = 0; i < STAR_COUNT; i++) {
      const azimuth = Math.random() * Math.PI * 2;
      const cosine = Math.random() * 1.7 - 0.7;
      const sine = Math.sqrt(1 - cosine * cosine);
      positions[i * 3] = Math.cos(azimuth) * sine * STAR_RADIUS;
      positions[i * 3 + 1] = cosine * STAR_RADIUS;
      positions[i * 3 + 2] = Math.sin(azimuth) * sine * STAR_RADIUS;
      seeds[i] = Math.random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));
    this.starMaterial = lightMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPointScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uBeat;
        uniform float uPointScale;
        varying float vLight;
        void main() {
          vLight = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.6) + aSeed * 40.0));
          vLight *= 0.6 + aSeed * 0.4;
          vLight += uBeat * 0.35;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (1.6 + aSeed * aSeed * 3.4) * uPointScale;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLight;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float a = max(0.0, 1.0 - dot(q, q) * 4.0);
          a = a * a * vLight;
          gl_FragColor = vec4(vec3(0.82, 0.88, 1.0) * a, a);
        }
      `,
    });
    this.stars = new Points(geometry, this.starMaterial);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;

    this.object.add(sky, this.stars);
    this.object.visible = false;
  }

  get enabled(): boolean {
    return this.object.visible;
  }

  set enabled(value: boolean) {
    this.object.visible = value;
  }

  setPalette(palette: Palette): void {
    this.top.set(...palette.skyTop);
    this.bottom.set(...palette.skyBottom);
  }

  /** Stars are pixel-sized, so high-density XR views need them bigger. */
  setPointScale(scale: number): void {
    this.starMaterial.uniforms.uPointScale.value = scale;
  }

  update(center: Vector3, beat: number, dt: number): void {
    if (!this.object.visible) return;
    this.time += dt;
    this.object.position.copy(center);
    this.starMaterial.uniforms.uTime.value = this.time;
    this.starMaterial.uniforms.uBeat.value = beat;
    this.skyMaterial.uniforms.uBeat.value = beat;
  }
}
