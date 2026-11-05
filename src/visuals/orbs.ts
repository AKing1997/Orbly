/**
 * All orbs are drawn with two instanced meshes (solid cores and additive-like
 * halos), so 32 orbs cost the same two draw calls as one.
 */

import {
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
} from '@iwsdk/core';
import { Vec3Like } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Palette, PALETTES } from './palettes';

export const ORB_RADIUS = 0.032;
const HALO_SCALE = 7.5;
const MOVE_RATE = 14;
const COLOR_RATE = 8;
const FLING_SECONDS = 0.55;
const DISSOLVE_SECONDS = 0.4;
const SPAWN_RATE = 11;

export function createCoreMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEnergy;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vColor;
      varying float vEnergy;
      void main() {
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * mat3(instanceMatrix) * normal;
        vView = -mv.xyz;
        vColor = aColor;
        vEnergy = aEnergy;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vColor;
      varying float vEnergy;
      void main() {
        float facing = max(dot(normalize(vNormal), normalize(vView)), 0.0);
        float rim = pow(1.0 - facing, 2.2);
        vec3 body = mix(vColor * 0.62, vColor * 1.1 + 0.18, rim);
        vec3 lit = body + (vColor * 0.5 + 0.5) * vEnergy * (0.35 + facing * 0.65);
        gl_FragColor = vec4(lit, 1.0);
      }
    `,
    toneMapped: false,
  });
}

export function createHaloMaterial(): ShaderMaterial {
  return lightMaterial({
    side: DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEnergy;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vEnergy;
      void main() {
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float size = length(instanceMatrix[0].xyz);
        center.xy += position.xy * size;
        vUv = uv - 0.5;
        vColor = aColor;
        vEnergy = aEnergy;
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vEnergy;
      void main() {
        float d = length(vUv) * 2.0;
        float falloff = exp(-d * d * 5.0) - 0.0067;
        if (falloff <= 0.0) discard;
        float intensity = falloff * (0.34 + vEnergy * 0.95);
        gl_FragColor = vec4(vColor * intensity, intensity * 0.28);
      }
    `,
  });
}

interface OrbView {
  id: number;
  band: number;
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  color: [number, number, number];
  scale: number;
  targetScale: number;
  pulse: number;
  hover: number;
  hoverTarget: number;
  held: boolean;
  /** Seconds left in a fling or dissolve, or 0 while the orb is alive. */
  leaving: number;
  leavingTotal: number;
  flying: boolean;
}

export class OrbField {
  readonly object = new Group();
  /** Called when a thrown orb finishes flying, so it can burst into sparks. */
  onFlingEnd: ((x: number, y: number, z: number, band: number) => void) | null =
    null;

  private readonly views = new Map<number, OrbView>();
  private readonly cores: InstancedMesh;
  private readonly halos: InstancedMesh;
  private readonly colors: Float32Array;
  private readonly energies: Float32Array;
  private readonly colorAttribute: InstancedBufferAttribute;
  private readonly energyAttribute: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private palette: Palette = PALETTES[0];

  constructor(capacity: number) {
    const coreGeometry = new SphereGeometry(1, 18, 14);
    const haloGeometry = new PlaneGeometry(1, 1);
    this.colors = new Float32Array(capacity * 3);
    this.energies = new Float32Array(capacity);
    this.colorAttribute = new InstancedBufferAttribute(this.colors, 3);
    this.energyAttribute = new InstancedBufferAttribute(this.energies, 1);
    this.colorAttribute.setUsage(DynamicDrawUsage);
    this.energyAttribute.setUsage(DynamicDrawUsage);
    coreGeometry.setAttribute('aColor', this.colorAttribute);
    coreGeometry.setAttribute('aEnergy', this.energyAttribute);
    haloGeometry.setAttribute('aColor', this.colorAttribute);
    haloGeometry.setAttribute('aEnergy', this.energyAttribute);

    this.cores = new InstancedMesh(coreGeometry, createCoreMaterial(), capacity);
    this.halos = new InstancedMesh(haloGeometry, createHaloMaterial(), capacity);
    for (const mesh of [this.cores, this.halos]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.object.add(mesh);
    }
    this.halos.renderOrder = 4;
  }

  get size(): number {
    return this.views.size;
  }

  has(id: number): boolean {
    const view = this.views.get(id);
    return view !== undefined && view.leaving === 0;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
  }

  spawn(id: number, band: number, position: Vec3Like): void {
    const [r, g, b] = this.palette.instruments[band];
    this.views.set(id, {
      id,
      band,
      x: position.x,
      y: position.y,
      z: position.z,
      targetX: position.x,
      targetY: position.y,
      targetZ: position.z,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      color: [r, g, b],
      scale: 0,
      targetScale: 1,
      pulse: 0.9,
      hover: 0,
      hoverTarget: 0,
      held: false,
      leaving: 0,
      leavingTotal: 1,
      flying: false,
    });
  }

  /** Eases the orb towards a resting position. */
  moveTo(id: number, position: Vec3Like): void {
    const view = this.views.get(id);
    if (view === undefined) return;
    view.targetX = position.x;
    view.targetY = position.y;
    view.targetZ = position.z;
  }

  /** Pins the orb to a point, as while it is being dragged. */
  place(id: number, position: Vec3Like): void {
    const view = this.views.get(id);
    if (view === undefined) return;
    view.x = view.targetX = position.x;
    view.y = view.targetY = position.y;
    view.z = view.targetZ = position.z;
  }

  setBand(id: number, band: number): void {
    const view = this.views.get(id);
    if (view !== undefined) view.band = band;
  }

  setHeld(id: number, held: boolean): void {
    const view = this.views.get(id);
    if (view === undefined) return;
    view.held = held;
    view.targetScale = held ? 1.2 : 1;
  }

  setHover(id: number, hovered: boolean): void {
    const view = this.views.get(id);
    if (view !== undefined) view.hoverTarget = hovered ? 1 : 0;
  }

  pulse(id: number, amount = 1): void {
    const view = this.views.get(id);
    if (view !== undefined) view.pulse = Math.max(view.pulse, amount);
  }

  /** Sends the orb flying and fading, then removes it. */
  fling(id: number, velocity: Vec3Like): void {
    const view = this.views.get(id);
    if (view === undefined || view.leaving > 0) return;
    view.flying = true;
    view.velocityX = velocity.x * 0.9;
    view.velocityY = velocity.y * 0.9;
    view.velocityZ = velocity.z * 0.9;
    view.leaving = FLING_SECONDS;
    view.leavingTotal = FLING_SECONDS;
    view.pulse = 1;
  }

  /** Shrinks the orb away in place, then removes it. */
  dissolve(id: number): void {
    const view = this.views.get(id);
    if (view === undefined || view.leaving > 0) return;
    view.leaving = DISSOLVE_SECONDS;
    view.leavingTotal = DISSOLVE_SECONDS;
  }

  /** Closest living orb to `point` within `radius`, or -1. */
  nearest(point: Vec3Like, radius: number): number {
    let best = -1;
    let bestDistance = radius;
    for (const view of this.views.values()) {
      if (view.leaving > 0) continue;
      const distance = Math.hypot(
        view.x - point.x,
        view.y - point.y,
        view.z - point.z,
      );
      if (distance <= bestDistance) {
        best = view.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  getPosition<T extends Vec3Like>(id: number, out: T): T | null {
    const view = this.views.get(id);
    if (view === undefined) return null;
    out.x = view.x;
    out.y = view.y;
    out.z = view.z;
    return out;
  }

  /** Living orb ids, written to `out`. */
  liveIds(out: number[]): number[] {
    out.length = 0;
    for (const view of this.views.values()) {
      if (view.leaving === 0) out.push(view.id);
    }
    return out;
  }

  update(dt: number): void {
    const move = 1 - Math.exp(-dt * MOVE_RATE);
    const blend = 1 - Math.exp(-dt * COLOR_RATE);
    const grow = 1 - Math.exp(-dt * SPAWN_RATE);
    const pulseDecay = Math.exp(-dt * 5.5);
    const { matrix } = this;
    let index = 0;

    for (const view of this.views.values()) {
      if (view.leaving > 0) {
        view.leaving -= dt;
        if (view.leaving <= 0) {
          this.views.delete(view.id);
          if (view.flying) {
            this.onFlingEnd?.(view.x, view.y, view.z, view.band);
          }
          continue;
        }
      }

      if (view.flying) {
        const drag = Math.exp(-dt * 1.4);
        view.velocityX *= drag;
        view.velocityY *= drag;
        view.velocityZ *= drag;
        view.x += view.velocityX * dt;
        view.y += view.velocityY * dt;
        view.z += view.velocityZ * dt;
      } else {
        view.x += (view.targetX - view.x) * move;
        view.y += (view.targetY - view.y) * move;
        view.z += (view.targetZ - view.z) * move;
      }

      const target = this.palette.instruments[view.band];
      view.color[0] += (target[0] - view.color[0]) * blend;
      view.color[1] += (target[1] - view.color[1]) * blend;
      view.color[2] += (target[2] - view.color[2]) * blend;

      view.pulse *= pulseDecay;
      view.hover += (view.hoverTarget - view.hover) * blend;
      view.scale += (view.targetScale - view.scale) * grow;

      const fade = view.leaving > 0 ? view.leaving / view.leavingTotal : 1;
      const energy = view.pulse + view.hover * 0.5 + (view.held ? 0.25 : 0);
      const radius =
        ORB_RADIUS * view.scale * fade *
        (1 + view.pulse * 0.42 + view.hover * 0.14);

      matrix.makeScale(radius, radius, radius);
      matrix.setPosition(view.x, view.y, view.z);
      this.cores.setMatrixAt(index, matrix);
      const haloSize = radius * HALO_SCALE * (1 + energy * 0.5);
      matrix.makeScale(haloSize, haloSize, haloSize);
      matrix.setPosition(view.x, view.y, view.z);
      this.halos.setMatrixAt(index, matrix);

      this.colors[index * 3] = view.color[0];
      this.colors[index * 3 + 1] = view.color[1];
      this.colors[index * 3 + 2] = view.color[2];
      this.energies[index] = energy;
      index++;
    }

    this.cores.count = index;
    this.halos.count = index;
    this.cores.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.energyAttribute.needsUpdate = true;
  }
}
