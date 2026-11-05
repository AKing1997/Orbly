/**
 * A translucent hand drawn from 20 instanced ellipsoids, posed by simple
 * forward kinematics. It demonstrates gestures in the tutorial and plays the
 * performer in the demo, with no model file to download.
 */

import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

type Point = [number, number, number];

interface FingerSpec {
  base: Point;
  lengths: [number, number, number];
  splay: number;
  radius: number;
}

// Local space of a right hand: fingers along -Z, back of the hand on +Y,
// thumb on -X. The left hand mirrors X.
const FINGERS: readonly FingerSpec[] = [
  { base: [-0.024, 0, -0.085], lengths: [0.042, 0.025, 0.021], splay: -0.1, radius: 0.0088 },
  { base: [-0.002, 0, -0.09], lengths: [0.046, 0.028, 0.022], splay: 0.02, radius: 0.009 },
  { base: [0.019, 0, -0.085], lengths: [0.042, 0.026, 0.021], splay: 0.16, radius: 0.0085 },
  { base: [0.039, 0, -0.075], lengths: [0.033, 0.02, 0.018], splay: 0.32, radius: 0.0075 },
];
const THUMB_BASE: Point = [-0.03, -0.012, -0.028];
const THUMB_LENGTHS = [0.042, 0.033, 0.027];
const THUMB_DIRECTION: Point = [-0.72, -0.16, -0.68];
const THUMB_RADIUS = 0.0098;
const PALM_RADIUS = 0.011;

const JOINT_COUNT = 1 + 4 * 4 + 4;
const THUMB_START = 17;
const SEGMENT_COUNT = 4 + 12 + 4;

/** Curl per joint at rest (0) and fully closed around the thumb (1). */
const INDEX_PINCH = [0.62, 0.92, 0.62];

const AXIS_Y = new Vector3(0, 1, 0);

export interface GhostPose {
  /** Wrist position in world space. */
  position: Vector3;
  quaternion: Quaternion;
  /** 0 is a relaxed open hand, 1 is thumb and index touching. */
  pinch: number;
  /** Extra curl on all fingers, 0 to 1. */
  curl?: number;
}

export class GhostHand {
  readonly object = new Group();
  private readonly shell: InstancedMesh;
  private readonly material: ShaderMaterial;
  private readonly joints: Vector3[] = [];
  private readonly openThumb: Vector3[] = [];
  private readonly segments: [number, number, number][] = [];
  private readonly matrix = new Matrix4();
  private readonly mid = new Vector3();
  private readonly direction = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly scale = new Vector3();
  private readonly mirror: number;
  private readonly world = new Vector3();

  constructor(handedness: 'left' | 'right') {
    this.mirror = handedness === 'left' ? -1 : 1;
    this.material = lightMaterial({
      uniforms: {
        uColor: { value: new Vector3(0.8, 0.95, 1) },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          vNormal = normalMatrix * mat3(instanceMatrix) * normal;
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
          float facing = abs(dot(normalize(vNormal), normalize(vView)));
          float rim = pow(1.0 - facing, 1.6);
          float a = (0.3 + rim * 0.7) * uOpacity;
          gl_FragColor = vec4(uColor * a, a * 0.55);
        }
      `,
    });
    const geometry = new SphereGeometry(1, 10, 8);
    this.shell = new InstancedMesh(geometry, this.material, SEGMENT_COUNT);
    this.shell.frustumCulled = false;
    this.shell.renderOrder = 8;
    // Depth first, so overlapping joints read as one hand instead of a stack
    // of translucent beads. Costs one extra draw call, only in the tutorial.
    const depth = new InstancedMesh(
      geometry,
      new MeshBasicMaterial({ colorWrite: false }),
      SEGMENT_COUNT,
    );
    depth.instanceMatrix = this.shell.instanceMatrix;
    depth.frustumCulled = false;
    depth.renderOrder = 7;
    this.object.add(depth, this.shell);
    this.object.visible = false;
    for (let i = 0; i < JOINT_COUNT; i++) this.joints.push(new Vector3());
    for (let i = 0; i < 3; i++) this.openThumb.push(new Vector3());

    // Palm: wrist to each knuckle.
    FINGERS.forEach((finger, index) => {
      this.segments.push([0, 1 + index * 4, PALM_RADIUS]);
      for (let joint = 0; joint < 3; joint++) {
        const start = 1 + index * 4 + joint;
        this.segments.push([start, start + 1, finger.radius]);
      }
    });
    this.segments.push([0, THUMB_START, PALM_RADIUS]);
    for (let joint = 0; joint < 3; joint++) {
      this.segments.push([
        THUMB_START + joint,
        THUMB_START + joint + 1,
        THUMB_RADIUS,
      ]);
    }
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
    this.object.visible = value > 0.003;
  }

  setColor(color: Rgb): void {
    (this.material.uniforms.uColor.value as Vector3).set(
      color[0],
      color[1],
      color[2],
    );
  }

  /** Where the thumb and index tips meet, in world space. */
  pinchPoint(pose: GhostPose, out: Vector3): Vector3 {
    this.solve(pose.pinch, pose.curl ?? 0);
    return this.toWorld(this.joints[4], pose, out);
  }

  apply(pose: GhostPose): void {
    this.solve(pose.pinch, pose.curl ?? 0);
    const { mid, direction, rotation, scale, matrix } = this;
    const from = new Vector3();
    const to = new Vector3();
    this.segments.forEach(([start, end, radius], index) => {
      this.toWorld(this.joints[start], pose, from);
      this.toWorld(this.joints[end], pose, to);
      mid.addVectors(from, to).multiplyScalar(0.5);
      direction.subVectors(to, from);
      const length = direction.length();
      rotation.setFromUnitVectors(AXIS_Y, direction.divideScalar(length || 1));
      scale.set(radius, length * 0.56 + radius * 0.7, radius);
      matrix.compose(mid, rotation, scale);
      this.shell.setMatrixAt(index, matrix);
    });
    this.shell.instanceMatrix.needsUpdate = true;
  }

  private toWorld(local: Vector3, pose: GhostPose, out: Vector3): Vector3 {
    this.world.set(local.x * this.mirror, local.y, local.z);
    return out
      .copy(this.world)
      .applyQuaternion(pose.quaternion)
      .add(pose.position);
  }

  private solve(pinch: number, curl: number): void {
    const { joints } = this;
    joints[0].set(0, 0, 0);
    FINGERS.forEach((finger, index) => {
      const first = 1 + index * 4;
      joints[first].set(finger.base[0], finger.base[1], finger.base[2]);
      let bend = 0.14;
      const splayX = Math.sin(finger.splay);
      const splayZ = Math.cos(finger.splay);
      for (let joint = 0; joint < 3; joint++) {
        const pinchCurl = index === 0
          ? INDEX_PINCH[joint] * pinch
          : (0.02 + joint * 0.05) * pinch;
        bend += pinchCurl + curl * 0.95 + 0.06;
        const horizontal = Math.cos(bend) * finger.lengths[joint];
        joints[first + joint + 1].set(
          joints[first + joint].x + splayX * horizontal,
          joints[first + joint].y - Math.sin(bend) * finger.lengths[joint],
          joints[first + joint].z - splayZ * horizontal,
        );
      }
    });

    // Open thumb, then blend it onto a line reaching the index fingertip.
    const base = joints[THUMB_START];
    base.set(THUMB_BASE[0], THUMB_BASE[1], THUMB_BASE[2]);
    let reach = 0;
    for (let joint = 0; joint < 3; joint++) {
      reach += THUMB_LENGTHS[joint];
      this.openThumb[joint]
        .set(THUMB_DIRECTION[0], THUMB_DIRECTION[1], THUMB_DIRECTION[2])
        .multiplyScalar(reach)
        .add(base);
    }
    const indexTip = joints[4];
    const fractions = [0.36, 0.7, 1];
    for (let joint = 0; joint < 3; joint++) {
      const fraction = fractions[joint];
      const bulge = Math.sin(fraction * Math.PI) * 0.018;
      joints[THUMB_START + joint + 1]
        .copy(this.openThumb[joint])
        .lerp(
          this.direction
            .copy(base)
            .lerp(indexTip, fraction)
            .setX(base.x + (indexTip.x - base.x) * fraction - bulge),
          pinch,
        );
    }
  }
}
