/**
 * The start screen: a big sphere for a new loop and up to six saved loops as
 * little glass worlds, each holding its orbs in miniature.
 */

import {
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import {
  DEGREE_COUNT,
  polarToPosition,
  Stage,
  stepToAngle,
  Vec3Like,
} from '../sequencer/mapping';
import { MAX_ORBS } from '../state/composition';
import { SavedComposition, MAX_SAVES } from '../state/storage';
import { lightMaterial } from '../visuals/materials';
import { createCoreMaterial } from '../visuals/orbs';
import { PALETTES } from '../visuals/palettes';
import { Label } from './label';
import { t } from './strings';
import { TouchTarget, TouchTargets } from './touch';

const SHELL_COUNT = MAX_SAVES + 1;
const NEW_RADIUS = 0.075;
const SAVE_RADIUS = 0.062;
const ARC_RADIUS = 0.44;
const BELOW_EYES = 0.34;
/** Angle between neighbouring spheres. */
const ARC_STEP = 0.5;
const SPIN_RATE = 0.35;
const FADE_RATE = 9;

function arcAngle(index: number): number {
  // New sits in the middle; saves alternate outwards, nearest first.
  if (index === 0) return 0;
  const side = index % 2 === 1 ? 1 : -1;
  return side * Math.ceil(index / 2) * ARC_STEP;
}

export class HomeScreen {
  readonly object = new Group();

  private readonly shells: InstancedMesh;
  private readonly shellMaterial: ShaderMaterial;
  private readonly minis: InstancedMesh;
  private readonly miniColors: Float32Array;
  private readonly miniEnergy: Float32Array;
  private readonly colorAttribute: InstancedBufferAttribute;
  private readonly title = new Label({ lineHeight: 0.026, width: 1400, height: 90, plate: true });
  private readonly challenge = new Label({ lineHeight: 0.036, width: 1500, height: 100, plate: true });
  private readonly plus = new Label({ lineHeight: 0.07, width: 128, height: 128, weight: 300 });
  private readonly touch = new TouchTargets();
  private readonly targets: TouchTarget[] = [];
  private readonly matrix = new Matrix4();
  private readonly center = new Vector3();
  private saves: readonly SavedComposition[] = [];
  private hovered = -1;
  private spin = 0;
  private visibility = 0;
  private open = false;
  private stage: Stage | null = null;

  constructor() {
    this.shellMaterial = lightMaterial({
      uniforms: { uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aHover;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vHover;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalMatrix * mat3(instanceMatrix) * normal;
          vView = -mv.xyz;
          vHover = aHover;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vHover;
        void main() {
          float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
          float rim = pow(1.0 - facing, 2.6);
          vec3 tint = mix(vec3(0.62, 0.8, 1.0), vec3(0.75, 1.0, 0.95), vHover);
          float a = (0.06 + vHover * 0.1 + rim * (0.8 + vHover * 0.5)) * uOpacity;
          gl_FragColor = vec4(tint * a, a * 0.5);
        }
      `,
    });
    const shellGeometry = new SphereGeometry(1, 24, 18);
    shellGeometry.setAttribute(
      'aHover',
      new InstancedBufferAttribute(new Float32Array(SHELL_COUNT), 1).setUsage(
        DynamicDrawUsage,
      ),
    );
    this.shells = new InstancedMesh(shellGeometry, this.shellMaterial, SHELL_COUNT);
    this.shells.frustumCulled = false;
    this.shells.renderOrder = 6;

    const miniCapacity = MAX_SAVES * MAX_ORBS;
    const miniGeometry = new SphereGeometry(1, 8, 6);
    this.miniColors = new Float32Array(miniCapacity * 3);
    this.miniEnergy = new Float32Array(miniCapacity).fill(0.25);
    this.colorAttribute = new InstancedBufferAttribute(this.miniColors, 3);
    miniGeometry.setAttribute('aColor', this.colorAttribute);
    miniGeometry.setAttribute(
      'aEnergy',
      new InstancedBufferAttribute(this.miniEnergy, 1),
    );
    this.minis = new InstancedMesh(miniGeometry, createCoreMaterial(), miniCapacity);
    this.minis.frustumCulled = false;
    this.minis.instanceMatrix.setUsage(DynamicDrawUsage);

    this.plus.setText('+', '#d8f8ff');
    this.object.add(
      this.minis,
      this.shells,
      this.title.object,
      this.challenge.object,
      this.plus.object,
    );
    this.object.visible = false;
  }

  /** Fires with -1 for a new loop, or the index of a saved loop. */
  onPick: ((saveIndex: number) => void) | null = null;

  get isOpen(): boolean {
    return this.open;
  }

  show(
    stage: Stage,
    saves: readonly SavedComposition[],
    challengeText: string,
    done: boolean,
  ): void {
    this.open = true;
    this.stage = stage;
    this.saves = saves;
    this.touch.reset();
    this.title.setText(t('today'), '#b9c6ff');
    this.challenge.setText(
      done ? `✓ ${challengeText}` : challengeText,
      done ? '#8dffb0' : '#ffffff',
    );
    this.layout(stage);
  }

  hide(): void {
    this.open = false;
  }

  /** @returns true while a hand is busy with the screen. */
  update(
    tips: readonly (Vec3Like | null)[],
    pinchPoints: readonly Vec3Like[],
    pinchStarts: readonly boolean[],
    head: Vector3,
    dt: number,
  ): void {
    const fade = 1 - Math.exp(-dt * FADE_RATE);
    this.visibility += ((this.open ? 1 : 0) - this.visibility) * fade;
    if (!this.open && this.visibility < 0.01) this.visibility = 0;
    this.object.visible = this.visibility > 0;
    if (!this.object.visible) return;

    this.spin += dt * SPIN_RATE;
    this.hovered = -1;
    if (this.open) {
      for (let hand = 0; hand < 2; hand++) {
        const tip = tips[hand];
        const picked = this.touch.update(
          hand,
          tip,
          pinchPoints[hand],
          pinchStarts[hand],
          dt,
        );
        if (tip !== null && this.hovered < 0) {
          this.hovered = this.touch.nearest(tip, 0.03);
        }
        if (picked >= 0) {
          this.onPick?.(picked - 1);
          break;
        }
      }
    }

    this.shellMaterial.uniforms.uOpacity.value = this.visibility;
    this.title.opacity = this.visibility;
    this.challenge.opacity = this.visibility;
    this.plus.opacity = this.visibility;
    this.title.object.lookAt(head);
    this.challenge.object.lookAt(head);
    this.plus.object.lookAt(head);
    this.updateInstances();
  }

  private layout(stage: Stage): void {
    this.targets.length = 0;
    const y = stage.baseY + (DEGREE_COUNT * 0.07) / 2 + 0.06;
    const count = this.saves.length + 1;
    for (let index = 0; index < count; index++) {
      const target: TouchTarget = {
        x: 0,
        y: y - (index === 0 ? 0 : 0.02),
        z: 0,
        radius: index === 0 ? NEW_RADIUS : SAVE_RADIUS,
      };
      polarToPosition(arcAngle(index), ARC_RADIUS, stage, target);
      this.targets.push(target);
    }
    this.touch.setTargets(this.targets);
    this.shells.count = count;

    const newLoop = this.targets[0];
    this.plus.object.position.set(newLoop.x, newLoop.y, newLoop.z);
    const eyeY = stage.baseY + 0.6;
    polarToPosition(0, 0.8, stage, this.challenge.object.position);
    this.challenge.object.position.y = eyeY - BELOW_EYES + 0.3;
    polarToPosition(0, 0.8, stage, this.title.object.position);
    this.title.object.position.y = eyeY - BELOW_EYES + 0.365;

    let mini = 0;
    this.saves.forEach((save) => {
      const palette = PALETTES[save.composition.sceneId];
      for (const orb of save.composition.orbs) {
        const color = palette.instruments[orb.band];
        this.miniColors.set(color, mini * 3);
        mini++;
      }
    });
    this.minis.count = mini;
    this.colorAttribute.needsUpdate = true;
  }

  private updateInstances(): void {
    const { matrix, center } = this;
    const stage = this.stage;
    if (stage === null) return;
    const scale = this.visibility;
    const hoverAttribute = this.shells.geometry.getAttribute(
      'aHover',
    ) as InstancedBufferAttribute;
    this.targets.forEach((target, index) => {
      const hover = index === this.hovered ? 1 : 0;
      const size = target.radius * scale * (1 + hover * 0.08);
      matrix.makeScale(size, size, size);
      matrix.setPosition(target.x, target.y, target.z);
      this.shells.setMatrixAt(index, matrix);
      hoverAttribute.setX(index, hover);
    });
    hoverAttribute.needsUpdate = true;
    this.shells.instanceMatrix.needsUpdate = true;

    let mini = 0;
    this.saves.forEach((save, saveIndex) => {
      const target = this.targets[saveIndex + 1];
      for (const orb of save.composition.orbs) {
        const angle = stepToAngle(orb.step) + this.spin;
        const radius = (0.3 + Math.min(orb.band, 2) * 0.28) * target.radius;
        center.set(0, 0, 0);
        center.x = target.x + Math.sin(angle) * radius;
        center.z = target.z - Math.cos(angle) * radius;
        center.y = target.y +
          (orb.degree / (DEGREE_COUNT - 1) - 0.5) * target.radius * 1.2;
        const size = 0.0065 * scale;
        matrix.makeScale(size, size, size);
        matrix.setPosition(center.x, center.y, center.z);
        this.minis.setMatrixAt(mini, matrix);
        mini++;
      }
    });
    this.minis.instanceMatrix.needsUpdate = true;
  }
}
