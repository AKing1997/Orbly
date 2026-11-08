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
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { flightPosition, ThrowPlan } from '../room/throw';
import { Vec3Like } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Palette, PALETTES } from './palettes';

export const ORB_RADIUS = 0.032;
const HALO_SCALE = 7.5;
/**
 * The glow is invisible past 80% of the halo's width, but every pixel of the
 * quad is still shaded and blended. Halos overlap right in front of the face,
 * so the quad is cut down to where the light is (36% fewer pixels) and the
 * falloff rescaled to reach zero exactly at its edge.
 */
const HALO_EXTENT = 0.8;
const HALO_EDGE = Math.exp(-5 * HALO_EXTENT * HALO_EXTENT);
const MOVE_RATE = 14;
const COLOR_RATE = 8;
const DISSOLVE_SECONDS = 0.4;
const SPAWN_RATE = 11;
/** The ring an orb leaves on a surface, as a multiple of its radius. */
const MARK_SCALE = 8;
const Z_AXIS = new Vector3(0, 0, 1);

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
        float size = length(instanceMatrix[0].xyz) * ${HALO_EXTENT.toFixed(3)};
        center.xy += position.xy * size;
        vUv = (uv - 0.5) * ${HALO_EXTENT.toFixed(3)};
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
        float falloff = (exp(-d * d * 5.0) - ${HALO_EDGE.toFixed(5)}) / ${(1 - HALO_EDGE).toFixed(5)};
        if (falloff <= 0.0) discard;
        float intensity = falloff * (0.34 + vEnergy * 0.95);
        gl_FragColor = vec4(vColor * intensity, intensity * 0.28);
      }
    `,
  });
}

/** The glowing ring left where an orb sticks to a surface. */
function createMarkMaterial(): ShaderMaterial {
  return lightMaterial({
    side: DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aEnergy;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vEnergy;
      void main() {
        vUv = uv - 0.5;
        vColor = aColor;
        vEnergy = aEnergy;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vEnergy;
      void main() {
        float d = length(vUv) * 2.0;
        if (d >= 1.0) discard;
        float ring = smoothstep(0.58, 0.68, d) * (1.0 - smoothstep(0.74, 0.92, d));
        float wash = (1.0 - d) * (1.0 - d) * 0.5;
        float intensity = ring * (0.4 + vEnergy) + wash * (0.15 + vEnergy * 0.7);
        gl_FragColor = vec4(vColor * intensity, intensity * 0.4);
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
  color: [number, number, number];
  scale: number;
  targetScale: number;
  pulse: number;
  hover: number;
  hoverTarget: number;
  held: boolean;
  /** Seconds left in a dissolve, or 0 while the orb is alive. */
  leaving: number;
  leavingTotal: number;
  flight: ThrowPlan | null;
  flightTime: number;
  /** Shrinks the orb as it is held over the lap, ready to be deleted. */
  fade: number;
  fadeTarget: number;
  /** Set while stuck to a surface: turns the mark to lie on it. */
  mark: Quaternion | null;
}

export class OrbField {
  readonly object = new Group();
  /** Called the moment a thrown orb reaches the end of its flight. */
  onLand: ((id: number) => void) | null = null;

  /** Live views in draw order; `byId` finds one without searching. */
  private readonly list: OrbView[] = [];
  private readonly byId = new Map<number, OrbView>();
  private readonly cores: InstancedMesh;
  private readonly halos: InstancedMesh;
  private readonly marks: InstancedMesh;
  private readonly colors: Float32Array;
  private readonly energies: Float32Array;
  private readonly colorAttribute: InstancedBufferAttribute;
  private readonly energyAttribute: InstancedBufferAttribute;
  private readonly matrix = new Matrix4();
  private readonly scratchPosition = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly noRotation = new Quaternion();
  private palette: Palette = PALETTES[0];

  constructor(capacity: number) {
    const coreGeometry = new SphereGeometry(1, 18, 14);
    const haloGeometry = new PlaneGeometry(1, 1);
    const markGeometry = new PlaneGeometry(1, 1);
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
    markGeometry.setAttribute('aColor', this.colorAttribute);
    markGeometry.setAttribute('aEnergy', this.energyAttribute);

    this.cores = new InstancedMesh(coreGeometry, createCoreMaterial(), capacity);
    this.halos = new InstancedMesh(haloGeometry, createHaloMaterial(), capacity);
    this.marks = new InstancedMesh(markGeometry, createMarkMaterial(), capacity);
    for (const mesh of [this.cores, this.halos, this.marks]) {
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.object.add(mesh);
    }
    this.halos.renderOrder = 4;
    this.marks.renderOrder = 3;
  }

  get size(): number {
    return this.list.length;
  }

  has(id: number): boolean {
    const view = this.byId.get(id);
    return view !== undefined && view.leaving === 0;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
  }

  spawn(id: number, band: number, position: Vec3Like): void {
    const [r, g, b] = this.palette.instruments[band];
    const view: OrbView = {
      id,
      band,
      x: position.x,
      y: position.y,
      z: position.z,
      targetX: position.x,
      targetY: position.y,
      targetZ: position.z,
      color: [r, g, b],
      scale: 0,
      targetScale: 1,
      pulse: 0.9,
      hover: 0,
      hoverTarget: 0,
      held: false,
      leaving: 0,
      leavingTotal: 1,
      flight: null,
      flightTime: 0,
      fade: 0,
      fadeTarget: 0,
      mark: null,
    };
    this.list.push(view);
    this.byId.set(id, view);
  }

  /** Eases the orb towards a resting position. */
  moveTo(id: number, position: Vec3Like): void {
    const view = this.byId.get(id);
    if (view === undefined) return;
    view.targetX = position.x;
    view.targetY = position.y;
    view.targetZ = position.z;
  }

  /** Pins the orb to a point, as while it is being dragged. */
  place(id: number, position: Vec3Like): void {
    const view = this.byId.get(id);
    if (view === undefined) return;
    view.x = view.targetX = position.x;
    view.y = view.targetY = position.y;
    view.z = view.targetZ = position.z;
  }

  setBand(id: number, band: number): void {
    const view = this.byId.get(id);
    if (view !== undefined) view.band = band;
  }

  setHeld(id: number, held: boolean): void {
    const view = this.byId.get(id);
    if (view === undefined) return;
    view.held = held;
    view.targetScale = held ? 1.2 : 1;
  }

  setHover(id: number, hovered: boolean): void {
    const view = this.byId.get(id);
    if (view !== undefined) view.hoverTarget = hovered ? 1 : 0;
  }

  pulse(id: number, amount = 1): void {
    const view = this.byId.get(id);
    if (view !== undefined) view.pulse = Math.max(view.pulse, amount);
  }

  /** Flies the orb along a planned throw; `onLand` fires when it arrives. */
  launch(id: number, plan: ThrowPlan): void {
    const view = this.byId.get(id);
    if (view === undefined) return;
    view.flight = plan;
    view.flightTime = 0;
    view.mark = null;
    view.held = false;
    view.targetScale = 1;
    view.fadeTarget = 0;
  }

  isStuck(id: number): boolean {
    return (this.byId.get(id)?.mark ?? null) !== null;
  }

  isFlying(id: number): boolean {
    return (this.byId.get(id)?.flight ?? null) !== null;
  }

  /**
   * Sticks a resting orb to a surface, or frees it with a null normal.
   * @param size grows far orbs, so one on a wall still reads from your seat.
   */
  stick(id: number, normal: Vec3Like | null, size = 1): void {
    const view = this.byId.get(id);
    if (view === undefined) return;
    view.mark = normal === null
      ? null
      : new Quaternion().setFromUnitVectors(
        Z_AXIS,
        this.scratchPosition.set(normal.x, normal.y, normal.z),
      );
    view.targetScale = size;
  }

  setFade(id: number, amount: number): void {
    const view = this.byId.get(id);
    if (view !== undefined) view.fadeTarget = amount;
  }

  /** The stuck orb closest to a ray, within a cone, or -1. */
  nearestInCone(
    origin: Vec3Like,
    direction: Vec3Like,
    minCosine: number,
    minDistance: number,
  ): number {
    let best = -1;
    let bestCosine = minCosine;
    for (let i = 0; i < this.list.length; i++) {
      const view = this.list[i];
      if (view.mark === null || view.leaving > 0) continue;
      const dx = view.x - origin.x;
      const dy = view.y - origin.y;
      const dz = view.z - origin.z;
      const distance = Math.hypot(dx, dy, dz);
      if (distance < minDistance) continue;
      const cosine =
        (dx * direction.x + dy * direction.y + dz * direction.z) / distance;
      if (cosine >= bestCosine) {
        best = view.id;
        bestCosine = cosine;
      }
    }
    return best;
  }

  /** Shrinks the orb away in place, then removes it. */
  dissolve(id: number): void {
    const view = this.byId.get(id);
    if (view === undefined || view.leaving > 0) return;
    view.leaving = DISSOLVE_SECONDS;
    view.leavingTotal = DISSOLVE_SECONDS;
  }

  /** Closest living orb to `point` within `radius`, or -1. */
  nearest(point: Vec3Like, radius: number): number {
    let best = -1;
    let bestDistance = radius;
    for (let i = 0; i < this.list.length; i++) {
      const view = this.list[i];
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
    const view = this.byId.get(id);
    if (view === undefined) return null;
    out.x = view.x;
    out.y = view.y;
    out.z = view.z;
    return out;
  }

  /** Living orb ids, written to `out`. */
  liveIds(out: number[]): number[] {
    out.length = 0;
    for (let i = 0; i < this.list.length; i++) {
      if (this.list[i].leaving === 0) out.push(this.list[i].id);
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

    for (let i = this.list.length - 1; i >= 0; i--) {
      const view = this.list[i];
      if (view.leaving > 0) {
        view.leaving -= dt;
        if (view.leaving <= 0) {
          this.list.splice(i, 1);
          // Undo may have respawned this id while the old view faded out.
          if (this.byId.get(view.id) === view) this.byId.delete(view.id);
          continue;
        }
      }

      if (view.flight !== null) {
        view.flightTime += dt;
        if (view.flightTime >= view.flight.duration) {
          const { point } = view.flight.hit;
          view.x = view.targetX = point.x;
          view.y = view.targetY = point.y;
          view.z = view.targetZ = point.z;
          view.flight = null;
          this.onLand?.(view.id);
        } else {
          flightPosition(view.flight, view.flightTime, view);
        }
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
      view.fade += (view.fadeTarget - view.fade) * blend;

      const fade = (view.leaving > 0 ? view.leaving / view.leavingTotal : 1) *
        (1 - view.fade * 0.72);
      const energy = (view.pulse + view.hover * 0.5 + (view.held ? 0.25 : 0)) *
        (1 - view.fade);
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

      const markSize = view.mark === null ? 0 : radius * MARK_SCALE;
      this.scratchPosition.set(view.x, view.y, view.z);
      this.scratchScale.setScalar(markSize);
      matrix.compose(
        this.scratchPosition,
        view.mark ?? this.noRotation,
        this.scratchScale,
      );
      this.marks.setMatrixAt(index, matrix);

      this.colors[index * 3] = view.color[0];
      this.colors[index * 3 + 1] = view.color[1];
      this.colors[index * 3 + 2] = view.color[2];
      this.energies[index] = energy;
      index++;
    }

    this.cores.count = index;
    this.halos.count = index;
    this.marks.count = index;
    this.cores.instanceMatrix.needsUpdate = true;
    this.halos.instanceMatrix.needsUpdate = true;
    this.marks.instanceMatrix.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.energyAttribute.needsUpdate = true;
  }
}
