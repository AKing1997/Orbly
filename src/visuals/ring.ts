/** The sequencer's clock face on the floor. A single shaded quad. */

import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from '@iwsdk/core';
import { BAND_RADII, Stage, STEP_COUNT } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Palette } from './palettes';

const EXTENT = 0.95;
const FLOOR_LIFT = 0.006;
const WAVE_SPEED = 1.5;

export class FloorRing {
  readonly object: Mesh;
  private readonly material: ShaderMaterial;
  private waveAge = 10;
  private waveStrength = 0;

  constructor() {
    const geometry = new PlaneGeometry(EXTENT * 2, EXTENT * 2);
    geometry.rotateX(-Math.PI / 2);
    this.material = lightMaterial({
      side: DoubleSide,
      depthTest: false,
      uniforms: {
        uBeam: { value: 0 },
        uLevel: { value: 1 },
        uWaveRadius: { value: 0 },
        uWaveStrength: { value: 0 },
        uColor: { value: new Vector3(1, 1, 1) },
        uBand0: { value: new Vector3(1, 1, 1) },
        uBand1: { value: new Vector3(1, 1, 1) },
        uBand2: { value: new Vector3(1, 1, 1) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() {
          vPos = vec2(position.x, -position.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #define TAU 6.28318530718
        uniform float uBeam;
        uniform float uLevel;
        uniform float uWaveRadius;
        uniform float uWaveStrength;
        uniform vec3 uColor;
        uniform vec3 uBand0;
        uniform vec3 uBand1;
        uniform vec3 uBand2;
        varying vec2 vPos;

        float line(float d, float width, float aa) {
          return 1.0 - smoothstep(width, width + aa, abs(d));
        }

        void main() {
          float r = length(vPos);
          float aa = fwidth(r) * 1.4;
          float angle = mod(atan(vPos.x, vPos.y), TAU);

          float segments = float(${STEP_COUNT});
          float cell = angle / TAU * segments;
          float nearest = abs(fract(cell + 0.5) - 0.5) / segments * TAU * r;
          float beat = 1.0 - step(0.5, mod(floor(cell + 0.5), 4.0));
          float tickLength = mix(0.62, 0.58, beat);
          float tick = line(nearest, mix(0.0022, 0.0042, beat), aa)
            * smoothstep(tickLength - 0.004, tickLength, r)
            * (1.0 - smoothstep(0.68, 0.684, r));

          float outer = line(r - 0.68, 0.0022, aa);
          float bands = line(r - ${BAND_RADII[0].toFixed(3)}, 0.0012, aa);
          float bandsMid = line(r - ${BAND_RADII[1].toFixed(3)}, 0.0012, aa);
          float bandsFar = line(r - ${BAND_RADII[2].toFixed(3)}, 0.0012, aa);
          vec3 color = uColor * (outer * 0.5 + tick * 0.55)
            + uBand0 * bands * 0.3 + uBand1 * bandsMid * 0.3 + uBand2 * bandsFar * 0.3;

          float behind = mod(uBeam - angle, TAU);
          float sweep = exp(-behind * 2.4) * smoothstep(0.1, 0.2, r)
            * (1.0 - smoothstep(0.66, 0.7, r));
          color += uColor * sweep * 0.24;

          float wave = exp(-pow((r - uWaveRadius) / 0.05, 2.0)) * uWaveStrength;
          color += uColor * wave * 0.5 * smoothstep(0.95, 0.6, r);

          color *= uLevel;
          float intensity = max(color.r, max(color.g, color.b));
          if (intensity < 0.002) discard;
          gl_FragColor = vec4(color, intensity * 0.4);
        }
      `,
    });
    this.object = new Mesh(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 1;
  }

  setPalette(palette: Palette): void {
    const { uniforms } = this.material;
    const set = (name: string, c: readonly number[]) =>
      (uniforms[name].value as Vector3).set(c[0], c[1], c[2]);
    set('uColor', palette.beam);
    set('uBand0', palette.instruments[0]);
    set('uBand1', palette.instruments[1]);
    set('uBand2', palette.instruments[2]);
  }

  setStage(stage: Stage): void {
    this.object.position.set(stage.x, stage.floorY + FLOOR_LIFT, stage.z);
    this.object.rotation.y = stage.yaw;
  }

  /** Sends a ripple out from the user. */
  pulse(strength: number): void {
    if (this.waveAge * WAVE_SPEED > 0.25 || strength > this.waveStrength) {
      this.waveAge = 0;
      this.waveStrength = strength;
    }
  }

  update(angle: number, dt: number, level: number): void {
    this.waveAge += dt;
    const { uniforms } = this.material;
    uniforms.uBeam.value = angle;
    uniforms.uLevel.value = level;
    uniforms.uWaveRadius.value = this.waveAge * WAVE_SPEED;
    uniforms.uWaveStrength.value =
      this.waveStrength * Math.exp(-this.waveAge * 2.2);
  }
}
