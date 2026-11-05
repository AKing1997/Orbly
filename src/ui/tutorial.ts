/**
 * The first-run tutorial: a ghost hand shows each gesture on a loop until the
 * user does it. Almost no text, and always skippable.
 */

import {
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { polarToPosition, Stage, Vec3Like } from '../sequencer/mapping';
import { GhostHand, GhostPose } from '../visuals/ghost-hand';
import { lightMaterial } from '../visuals/materials';
import { Palette } from '../visuals/palettes';
import { Label } from './label';
import { OnboardingFlow, TutorialStep } from './onboarding';
import { StringKey, t } from './strings';
import { TouchTargets } from './touch';

const PINCH_LOOP = 2.8;
const RAISE_LOOP = 3.2;
const PALM_LOOP = 2.8;
const RAISE_HEIGHT = 0.17;
const SKIP_RADIUS = 0.05;

const TEXT: Record<Exclude<TutorialStep, 'done'>, StringKey> = {
  pinch: 'tutorialPinch',
  raise: 'tutorialRaise',
  palm: 'tutorialPalm',
};

/** Smooth 0..1 ramp between two times of a looping phase. */
function ramp(phase: number, from: number, to: number): number {
  const x = Math.max(0, Math.min(1, (phase - from) / (to - from)));
  return x * x * (3 - 2 * x);
}

/** Hand rotation from where the fingers point and where the palm faces. */
export function handQuaternion(
  fingers: Vector3,
  palm: Vector3,
  out: Quaternion,
): Quaternion {
  const z = fingers.clone().normalize().negate();
  const x = palm.clone().negate().cross(z).normalize();
  const y = z.clone().cross(x).normalize();
  return out.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

export class TutorialView {
  readonly object = new Group();
  readonly flow = new OnboardingFlow();
  onSkip: (() => void) | null = null;

  private readonly right = new GhostHand('right');
  private readonly left = new GhostHand('left');
  private readonly text = new Label({ lineHeight: 0.042, width: 1300, height: 124, plate: true });
  private readonly skip = new Label({ lineHeight: 0.02, width: 360, height: 72, plate: true });
  private readonly orbHint: Mesh;
  private readonly orbMaterial: ShaderMaterial;
  private readonly touch = new TouchTargets();
  private readonly skipTarget = { x: 0, y: 0, z: 0, radius: SKIP_RADIUS };
  private readonly goal = new Vector3();
  private readonly point = new Vector3();
  private readonly fingers = new Vector3();
  private readonly palm = new Vector3();
  private readonly pose: GhostPose = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    pinch: 0,
  };
  private stage: Stage | null = null;
  private time = 0;
  private active = false;
  /** Where the raise demonstration starts: on the user's first orb. */
  private readonly orbSpot = new Vector3();

  constructor() {
    this.orbMaterial = lightMaterial({
      uniforms: { uColor: { value: new Vector3(1, 1, 1) }, uOpacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormal = normalMatrix * normal;
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
          float a = (0.14 + pow(1.0 - facing, 2.0)) * uOpacity;
          gl_FragColor = vec4(uColor * a, a * 0.5);
        }
      `,
    });
    this.orbHint = new Mesh(new SphereGeometry(0.03, 16, 12), this.orbMaterial);
    this.orbHint.frustumCulled = false;
    this.orbHint.renderOrder = 7;
    this.orbHint.visible = false;
    this.skip.setText(t('skip'), '#cfd6ff');
    this.object.add(
      this.right.object,
      this.left.object,
      this.orbHint,
      this.text.object,
      this.skip.object,
    );
    this.object.visible = false;
  }

  get isActive(): boolean {
    return this.active;
  }

  setPalette(palette: Palette): void {
    this.right.setColor(palette.beam);
    this.left.setColor(palette.beam);
    const color = palette.instruments[0];
    (this.orbMaterial.uniforms.uColor.value as Vector3).set(
      color[0],
      color[1],
      color[2],
    );
  }

  start(stage: Stage): void {
    this.stage = stage;
    this.active = true;
    this.time = 0;
    this.object.visible = true;
    this.touch.reset();
    polarToPosition(-0.75, 0.44, stage, this.skipTarget);
    this.skipTarget.y = stage.baseY + 0.16;
    this.touch.setTargets([this.skipTarget]);
    this.skip.object.position.set(
      this.skipTarget.x,
      this.skipTarget.y,
      this.skipTarget.z,
    );
    polarToPosition(0, 0.8, stage, this.text.object.position);
    this.text.object.position.y = stage.baseY + 0.62;
  }

  stop(): void {
    this.active = false;
    this.object.visible = false;
    this.right.opacity = 0;
    this.left.opacity = 0;
  }

  /** Lets the raise step demonstrate on an orb the user really placed. */
  setOrbSpot(position: Vec3Like): void {
    this.orbSpot.set(position.x, position.y, position.z);
  }

  /** True when `point` is close to the skip button, and pinches belong to it. */
  isNearSkip(point: Vec3Like): boolean {
    return (
      this.active &&
      Math.hypot(
        point.x - this.skipTarget.x,
        point.y - this.skipTarget.y,
        point.z - this.skipTarget.z,
      ) < SKIP_RADIUS + 0.06
    );
  }

  update(
    tips: readonly (Vec3Like | null)[],
    pinchPoints: readonly Vec3Like[],
    pinchStarts: readonly boolean[],
    head: Vector3,
    dt: number,
  ): void {
    if (!this.active || this.stage === null) return;
    this.time += dt;
    this.text.object.lookAt(head);
    this.skip.object.lookAt(head);

    for (let hand = 0; hand < 2; hand++) {
      const pressed = this.touch.update(
        hand,
        tips[hand],
        pinchPoints[hand],
        pinchStarts[hand],
        dt,
      );
      if (pressed >= 0) {
        this.onSkip?.();
        return;
      }
    }

    const { step } = this.flow;
    if (step === 'done') return;
    this.text.setText(t(TEXT[step]));
    switch (step) {
      case 'pinch':
        this.animatePinch(this.stage);
        break;
      case 'raise':
        this.animateRaise();
        break;
      case 'palm':
        this.animatePalm(this.stage);
        break;
    }
  }

  /** Places the right ghost so its pinch lands exactly on `goal`. */
  private placeRight(pinch: number, opacity: number): void {
    const { pose, point } = this;
    pose.pinch = pinch;
    pose.position.set(0, 0, 0);
    this.right.pinchPoint(pose, point);
    pose.position.subVectors(this.goal, point);
    this.right.apply(pose);
    this.right.opacity = opacity;
  }

  /** A natural air pinch seen side-on: fingers ahead, palm turned inward. */
  private pointFromRight(stage: Stage): void {
    polarToPosition(-0.75, 1, { ...stage, x: 0, z: 0 }, this.fingers);
    this.fingers.y = 0.16;
    polarToPosition(-0.9, 0.42, { ...stage, x: 0, z: 0 }, this.palm);
    this.palm.y = -0.92;
    handQuaternion(this.fingers, this.palm, this.pose.quaternion);
  }

  private animatePinch(stage: Stage): void {
    const phase = (this.time % PINCH_LOOP) / PINCH_LOOP;
    polarToPosition(0.25, 0.38, stage, this.goal);
    this.goal.y = stage.baseY + 0.42;
    const approach = 1 - ramp(phase, 0.02, 0.3);
    this.goal.x += approach * 0.05;
    this.goal.y -= approach * 0.05;
    this.pointFromRight(stage);
    const pinch = ramp(phase, 0.32, 0.46) * (1 - ramp(phase, 0.76, 0.86));
    const opacity = ramp(phase, 0, 0.1) * (1 - ramp(phase, 0.9, 1));
    this.placeRight(pinch, opacity);
    this.left.opacity = 0;

    const orb = ramp(phase, 0.42, 0.5) * (1 - ramp(phase, 0.9, 1));
    this.orbHint.visible = orb > 0.01;
    this.orbMaterial.uniforms.uOpacity.value = orb;
    this.orbHint.position.copy(this.goal);
  }

  private animateRaise(): void {
    const phase = (this.time % RAISE_LOOP) / RAISE_LOOP;
    const stage = this.stage as Stage;
    const lift = ramp(phase, 0.34, 0.74) * RAISE_HEIGHT;
    this.goal.copy(this.orbSpot);
    this.goal.y += lift;
    this.pointFromRight(stage);
    const pinch = ramp(phase, 0.14, 0.28) * (1 - ramp(phase, 0.8, 0.88));
    const opacity = ramp(phase, 0, 0.1) * (1 - ramp(phase, 0.9, 1));
    this.placeRight(pinch, opacity);
    this.left.opacity = 0;
    this.orbHint.visible = pinch > 0.05;
    this.orbMaterial.uniforms.uOpacity.value = pinch;
    this.orbHint.position.copy(this.goal);
  }

  private animatePalm(stage: Stage): void {
    const phase = (this.time % PALM_LOOP) / PALM_LOOP;
    const { pose } = this;
    polarToPosition(-0.5, 0.3, stage, pose.position);
    pose.position.y = stage.baseY + 0.3;
    polarToPosition(0.35, 1, { ...stage, x: 0, z: 0 }, this.fingers);
    this.fingers.y = 0.12;
    // Rolls about the forearm from palm-down to palm-up.
    const roll = ramp(phase, 0.16, 0.56) * Math.PI;
    const side = new Vector3().crossVectors(this.fingers, new Vector3(0, 1, 0)).normalize();
    this.palm.set(0, -1, 0).multiplyScalar(Math.cos(roll));
    this.palm.addScaledVector(side, -Math.sin(roll)).normalize();
    handQuaternion(this.fingers, this.palm, pose.quaternion);
    pose.pinch = 0;
    this.left.apply(pose);
    this.left.opacity = ramp(phase, 0, 0.1) * (1 - ramp(phase, 0.9, 1));
    this.right.opacity = 0;
    this.orbHint.visible = false;
  }
}
