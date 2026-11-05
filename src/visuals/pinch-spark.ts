/**
 * A spark between thumb and index that grows as they close. Hands have no
 * haptics, so this is the feel of a pinch arriving, and it shows where an orb
 * will appear before it does. One instanced draw call for both hands.
 */

import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
} from '@iwsdk/core';
import { Vec3Like } from '../sequencer/mapping';
import { createHaloMaterial } from './orbs';
import { Rgb } from './palettes';

const MAX_SIZE = 0.075;
const RISE_RATE = 26;

export class PinchSparks {
  readonly object: InstancedMesh;
  private readonly colors = new Float32Array(6);
  private readonly energies = new Float32Array(2);
  private readonly colorAttribute: InstancedBufferAttribute;
  private readonly energyAttribute: InstancedBufferAttribute;
  private readonly sizes = [0, 0];
  private readonly matrix = new Matrix4();

  constructor() {
    const geometry = new PlaneGeometry(1, 1);
    this.colorAttribute = new InstancedBufferAttribute(this.colors, 3);
    this.energyAttribute = new InstancedBufferAttribute(this.energies, 1);
    this.colorAttribute.setUsage(DynamicDrawUsage);
    this.energyAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aColor', this.colorAttribute);
    geometry.setAttribute('aEnergy', this.energyAttribute);
    this.object = new InstancedMesh(geometry, createHaloMaterial(), 2);
    this.object.instanceMatrix.setUsage(DynamicDrawUsage);
    this.object.frustumCulled = false;
    this.object.renderOrder = 6;
    this.object.count = 2;
  }

  /** @param closeness 0 hides the spark, 1 is fingers about to touch. */
  set(hand: number, point: Vec3Like, closeness: number, color: Rgb, dt: number): void {
    const wanted = closeness * closeness * MAX_SIZE;
    this.sizes[hand] += (wanted - this.sizes[hand]) * (1 - Math.exp(-dt * RISE_RATE));
    const size = this.sizes[hand] < 0.001 ? 0 : this.sizes[hand];
    this.matrix.makeScale(size, size, size);
    this.matrix.setPosition(point.x, point.y, point.z);
    this.object.setMatrixAt(hand, this.matrix);
    this.colors[hand * 3] = color[0];
    this.colors[hand * 3 + 1] = color[1];
    this.colors[hand * 3 + 2] = color[2];
    this.energies[hand] = closeness * 1.4;
    this.object.instanceMatrix.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.energyAttribute.needsUpdate = true;
  }
}
