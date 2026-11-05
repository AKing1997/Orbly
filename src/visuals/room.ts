/**
 * Lets the real room react to the music. The beam sweeps across detected walls
 * and furniture like a lighthouse, and surfaces catch waves of colour from
 * notes and impacts. Without plane detection the mesh stays empty, thrown orbs
 * float on a dome instead, and the floor ring keeps doing its job.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { Surface, surfaceFromPlane } from '../room/surfaces';
import { Vec3Like } from '../sequencer/mapping';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

const WAVE_COUNT = 3;
const WAVE_SPEED = 3.2;
const WAVE_FADE = 1.1;
/** Planes rarely change: rescanning a few times a second is plenty. */
const SCAN_INTERVAL = 0.5;

type FrameWithPlanes = XRFrame & { detectedPlanes?: XRPlaneSet };

export class RoomPulse {
  /** Every plane merged into one mesh: one draw call however big the room. */
  readonly object: Mesh;
  /** The room as the music sees it. */
  surfaces: readonly Surface[] = [];
  /** Fires when the room is first detected or changes shape. */
  onSurfacesChanged: (() => void) | null = null;

  private readonly material: ShaderMaterial;
  /** Last change time of each plane, to rebuild only when something moved. */
  private readonly planes = new Map<XRPlane, number>();
  private readonly radii = new Float32Array(WAVE_COUNT);
  private readonly strengths = new Float32Array(WAVE_COUNT);
  private readonly colors = [new Vector3(), new Vector3(), new Vector3()];
  private readonly origins = [new Vector3(), new Vector3(), new Vector3()];
  private readonly ages = new Float32Array(WAVE_COUNT).fill(100);
  private readonly beamColor = new Vector3(1, 1, 1);
  private nextWave = 0;
  private sinceScan = SCAN_INTERVAL;

  constructor() {
    this.material = lightMaterial({
      side: DoubleSide,
      uniforms: {
        uCenter: { value: new Vector3() },
        uBeam: { value: 0 },
        uBeamLevel: { value: 1 },
        uBeamColor: { value: this.beamColor },
        uOrigins: { value: this.origins },
        uRadii: { value: this.radii },
        uStrengths: { value: this.strengths },
        uColors: { value: this.colors },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        #define TAU 6.28318530718
        uniform vec3 uCenter;
        uniform float uBeam;
        uniform float uBeamLevel;
        uniform vec3 uBeamColor;
        uniform vec3 uOrigins[${WAVE_COUNT}];
        uniform float uRadii[${WAVE_COUNT}];
        uniform float uStrengths[${WAVE_COUNT}];
        uniform vec3 uColors[${WAVE_COUNT}];
        varying vec3 vWorld;
        void main() {
          vec3 color = vec3(0.0);
          for (int i = 0; i < ${WAVE_COUNT}; i++) {
            float x = (distance(vWorld, uOrigins[i]) - uRadii[i]) / 0.34;
            color += uColors[i] * exp(-x * x) * uStrengths[i];
          }
          color *= 0.42;

          // The beam, read as an angle around the user: a soft tail behind it
          // and a crisp leading edge, like a lighthouse crossing the wall.
          vec2 d = vWorld.xz - uCenter.xz;
          float angle = atan(d.x, -d.y);
          float behind = mod(uBeam - angle, TAU);
          float ahead = mod(angle - uBeam, TAU);
          float sweep = exp(-behind * 3.4) + exp(-ahead * 26.0);
          color += uBeamColor * sweep * 0.2 * uBeamLevel;

          float intensity = max(color.r, max(color.g, color.b));
          gl_FragColor = vec4(color, intensity * 0.16);
        }
      `,
    });
    this.object = new Mesh(new BufferGeometry(), this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = -1;
  }

  get planeCount(): number {
    return this.planes.size;
  }

  setBeamColor(color: Rgb): void {
    this.beamColor.set(color[0], color[1], color[2]);
  }

  /** Starts a wave in this colour, from the user unless told otherwise. */
  pulse(color: Rgb, strength: number, from: Vec3Like): void {
    const index = this.nextWave;
    this.nextWave = (index + 1) % WAVE_COUNT;
    this.ages[index] = 0;
    this.strengths[index] = strength;
    this.colors[index].set(color[0], color[1], color[2]);
    this.origins[index].set(from.x, from.y, from.z);
  }

  /**
   * @param beamAngle clockwise from world forward (-Z), radians.
   * @param beamLevel 0 hides the sweep, 1 is full strength.
   */
  update(
    frame: XRFrame | null,
    space: XRReferenceSpace | null,
    center: Vector3,
    beamAngle: number,
    beamLevel: number,
    dt: number,
  ): void {
    const { uniforms } = this.material;
    (uniforms.uCenter.value as Vector3).copy(center);
    uniforms.uBeam.value = beamAngle;
    uniforms.uBeamLevel.value = beamLevel;
    for (let i = 0; i < WAVE_COUNT; i++) {
      this.ages[i] += dt;
      this.radii[i] = this.ages[i] * WAVE_SPEED;
      this.strengths[i] *= Math.exp(-dt * WAVE_FADE);
    }
    this.sinceScan += dt;
    if (frame === null || space === null || this.sinceScan < SCAN_INTERVAL) {
      return;
    }
    this.sinceScan = 0;
    const detected = (frame as FrameWithPlanes).detectedPlanes;
    if (detected !== undefined) this.sync(detected, frame, space);
  }

  clear(): void {
    this.planes.clear();
    this.surfaces = [];
    this.setGeometry(new BufferGeometry());
  }

  private sync(
    detected: XRPlaneSet,
    frame: XRFrame,
    space: XRReferenceSpace,
  ): void {
    let changed = detected.size !== this.planes.size;
    detected.forEach((plane) => {
      if (this.planes.get(plane) !== plane.lastChangedTime) changed = true;
    });
    if (!changed) return;

    const placed: PlacedPolygon[] = [];
    const surfaces: Surface[] = [];
    this.planes.clear();
    detected.forEach((plane) => {
      const pose = frame.getPose(plane.planeSpace, space);
      // Left out of `planes`, so the next scan tries this one again.
      if (pose === undefined || pose === null) return;
      const { matrix } = pose.transform;
      this.planes.set(plane, plane.lastChangedTime);
      placed.push({
        polygon: plane.polygon,
        matrix: new Matrix4().fromArray(matrix),
      });
      surfaces.push(
        surfaceFromPlane(
          plane.polygon,
          matrix,
          plane.semanticLabel,
          plane.orientation,
        ),
      );
    });
    this.surfaces = surfaces;
    this.setGeometry(mergePolygons(placed));
    this.onSurfacesChanged?.();
  }

  private setGeometry(geometry: BufferGeometry): void {
    this.object.geometry.dispose();
    this.object.geometry = geometry;
  }
}

export interface PlacedPolygon {
  polygon: readonly DOMPointReadOnly[];
  matrix: Matrix4;
}

/** Plane polygons are convex, so each becomes a triangle fan in world space. */
export function mergePolygons(placed: readonly PlacedPolygon[]): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const point = new Vector3();
  for (const { polygon, matrix } of placed) {
    const first = positions.length / 3;
    for (const corner of polygon) {
      point.set(corner.x, corner.y, corner.z).applyMatrix4(matrix);
      positions.push(point.x, point.y, point.z);
    }
    for (let i = 1; i + 1 < polygon.length; i++) {
      indices.push(first, first + i, first + i + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setIndex(indices);
  return geometry;
}
