/**
 * The playhead: a thin sheet of light and a curtain sweeping around the user,
 * both fading near the head so nothing ever passes in front of the eyes.
 */

import {
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { MAX_RADIUS, Stage } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

const CURTAIN_ARC = 1.05;
const INNER_RADIUS = 0.12;
const TOP_ABOVE_BASE = 1.0;

export class Beam {
  readonly object = new Group();
  private readonly sheet: Mesh;
  private readonly curtain: Mesh;
  private readonly sheetMaterial: ShaderMaterial;
  private readonly curtainMaterial: ShaderMaterial;
  private readonly color = new Vector3(1, 1, 1);
  private readonly headUniform = new Vector3();

  constructor() {
    const sheetGeometry = new PlaneGeometry(1, 1);
    sheetGeometry.translate(0.5, 0.5, 0);
    this.sheetMaterial = lightMaterial({
      side: DoubleSide,
      uniforms: {
        uColor: { value: this.color },
        uHead: { value: this.headUniform },
        uLevel: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uHead;
        uniform float uLevel;
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          float radial = smoothstep(0.0, 0.25, vUv.x) * (1.0 - smoothstep(0.86, 1.0, vUv.x));
          float height = smoothstep(0.0, 0.1, vUv.y) * pow(1.0 - vUv.y, 1.4);
          float nearHead = smoothstep(0.2, 0.48, distance(vWorld, uHead));
          float a = radial * height * nearHead * 0.15 * uLevel;
          gl_FragColor = vec4(uColor * a, a * 0.25);
        }
      `,
    });
    this.sheet = new Mesh(sheetGeometry, this.sheetMaterial);
    this.sheet.frustumCulled = false;
    this.sheet.renderOrder = 2;

    const curtainGeometry = new CylinderGeometry(
      1,
      1,
      1,
      28,
      1,
      true,
      -CURTAIN_ARC,
      CURTAIN_ARC,
    );
    curtainGeometry.translate(0, 0.5, 0);
    this.curtainMaterial = lightMaterial({
      side: DoubleSide,
      uniforms: {
        uColor: { value: this.color },
        uLevel: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uLevel;
        varying vec2 vUv;
        void main() {
          float trail = pow(vUv.x, 3.0);
          float edge = smoothstep(0.97, 0.997, vUv.x);
          float height = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.6);
          float a = (trail * 0.16 + edge * 0.5) * height * uLevel;
          gl_FragColor = vec4(uColor * a, a * 0.2);
        }
      `,
    });
    this.curtain = new Mesh(curtainGeometry, this.curtainMaterial);
    this.curtain.frustumCulled = false;
    this.curtain.renderOrder = 2;

    this.object.add(this.sheet, this.curtain);
  }

  setColor(color: Rgb): void {
    this.color.set(color[0], color[1], color[2]);
  }

  setStage(stage: Stage): void {
    this.object.position.set(stage.x, stage.floorY, stage.z);
    const height = stage.baseY + TOP_ABOVE_BASE - stage.floorY;
    this.sheet.scale.set(MAX_RADIUS + 0.02 - INNER_RADIUS, height, 1);
    this.curtain.scale.set(MAX_RADIUS + 0.04, height, MAX_RADIUS + 0.04);
  }

  /** @param angle clockwise from the stage's forward direction. */
  update(angle: number, yaw: number, head: Vector3, level: number): void {
    const rotation = yaw + Math.PI / 2 - angle;
    this.sheet.rotation.y = rotation;
    this.sheet.position.set(
      Math.cos(rotation) * INNER_RADIUS,
      0,
      -Math.sin(rotation) * INNER_RADIUS,
    );
    // A cylinder's seam starts on +Z; line the leading edge up with the sheet.
    this.curtain.rotation.y = rotation + Math.PI / 2;
    this.headUniform.copy(head);
    this.sheetMaterial.uniforms.uLevel.value = level;
    this.curtainMaterial.uniforms.uLevel.value = level;
  }
}
