/**
 * Lets the real room react to the music: detected walls and tables catch
 * waves of colour travelling out from the user. Without plane detection this
 * simply stays empty, and the floor ring keeps doing its job.
 */

import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { lightMaterial } from './materials';
import { Rgb } from './palettes';

const WAVE_COUNT = 3;
const WAVE_SPEED = 3.2;
const WAVE_FADE = 1.1;
/** Planes rarely change: rescanning a few times a second is plenty. */
const SCAN_INTERVAL = 0.5;

interface TrackedPlane {
  mesh: Mesh;
  changedAt: number;
}

type FrameWithPlanes = XRFrame & { detectedPlanes?: XRPlaneSet };

export class RoomPulse {
  readonly object = new Group();
  private readonly material: ShaderMaterial;
  private readonly planes = new Map<XRPlane, TrackedPlane>();
  private readonly radii = new Float32Array(WAVE_COUNT);
  private readonly strengths = new Float32Array(WAVE_COUNT);
  private readonly colors = [new Vector3(), new Vector3(), new Vector3()];
  private readonly ages = new Float32Array(WAVE_COUNT).fill(100);
  private nextWave = 0;
  private sinceScan = SCAN_INTERVAL;

  constructor() {
    this.material = lightMaterial({
      side: DoubleSide,
      uniforms: {
        uCenter: { value: new Vector3() },
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
        uniform vec3 uCenter;
        uniform float uRadii[${WAVE_COUNT}];
        uniform float uStrengths[${WAVE_COUNT}];
        uniform vec3 uColors[${WAVE_COUNT}];
        varying vec3 vWorld;
        void main() {
          float d = distance(vWorld, uCenter);
          vec3 color = vec3(0.0);
          for (int i = 0; i < ${WAVE_COUNT}; i++) {
            float x = (d - uRadii[i]) / 0.34;
            color += uColors[i] * exp(-x * x) * uStrengths[i];
          }
          color *= 0.42;
          float intensity = max(color.r, max(color.g, color.b));
          gl_FragColor = vec4(color, intensity * 0.16);
        }
      `,
    });
    this.object.renderOrder = -1;
  }

  get planeCount(): number {
    return this.planes.size;
  }

  /** Starts a wave from the user in this colour. */
  pulse(color: Rgb, strength: number): void {
    const index = this.nextWave;
    this.nextWave = (index + 1) % WAVE_COUNT;
    this.ages[index] = 0;
    this.strengths[index] = strength;
    this.colors[index].set(color[0], color[1], color[2]);
  }

  update(
    frame: XRFrame | null,
    space: XRReferenceSpace | null,
    center: Vector3,
    dt: number,
  ): void {
    (this.material.uniforms.uCenter.value as Vector3).copy(center);
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
    for (const tracked of this.planes.values()) this.removeMesh(tracked);
    this.planes.clear();
  }

  private sync(
    detected: XRPlaneSet,
    frame: XRFrame,
    space: XRReferenceSpace,
  ): void {
    for (const [plane, tracked] of this.planes) {
      if (!detected.has(plane)) {
        this.removeMesh(tracked);
        this.planes.delete(plane);
      }
    }
    detected.forEach((plane) => {
      const tracked = this.planes.get(plane);
      if (tracked !== undefined && tracked.changedAt === plane.lastChangedTime) {
        return;
      }
      const pose = frame.getPose(plane.planeSpace, space);
      if (pose === undefined || pose === null) return;
      const mesh = tracked?.mesh ?? this.addMesh();
      mesh.geometry.dispose();
      mesh.geometry = polygonGeometry(plane.polygon);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.fromArray(pose.transform.matrix);
      mesh.matrixWorldNeedsUpdate = true;
      this.planes.set(plane, { mesh, changedAt: plane.lastChangedTime });
    });
  }

  private addMesh(): Mesh {
    const mesh = new Mesh(new BufferGeometry(), this.material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    this.object.add(mesh);
    return mesh;
  }

  private removeMesh(tracked: TrackedPlane): void {
    tracked.mesh.geometry.dispose();
    this.object.remove(tracked.mesh);
  }
}

/** Plane polygons are convex and lie in the plane's XZ: a fan covers them. */
export function polygonGeometry(polygon: readonly DOMPointReadOnly[]): BufferGeometry {
  const positions = new Float32Array(polygon.length * 3);
  polygon.forEach((point, index) => {
    positions[index * 3] = point.x;
    positions[index * 3 + 1] = point.y;
    positions[index * 3 + 2] = point.z;
  });
  const indices: number[] = [];
  for (let i = 1; i + 1 < polygon.length; i++) indices.push(0, i, i + 1);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}
