/** Text on a quad, drawn once to a canvas. Cheap: one draw call per label. */

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  ShaderMaterial,
} from '@iwsdk/core';
import { lightMaterial } from '../visuals/materials';

export interface LabelOptions {
  /** World height of the text line, in metres. */
  lineHeight: number;
  /** Canvas size in pixels. */
  width?: number;
  height?: number;
  weight?: number;
  /** Adds a soft dark plate so text reads over a bright room. */
  plate?: boolean;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export class Label {
  readonly object: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly material: ShaderMaterial;
  private text = '';

  constructor(private readonly options: LabelOptions) {
    const width = options.width ?? 1024;
    const height = options.height ?? 128;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('2D canvas is not available');
    this.context = context;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = NoColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.premultiplyAlpha = true;
    this.material = lightMaterial({
      depthTest: false,
      uniforms: {
        uMap: { value: this.texture },
        uOpacity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uOpacity;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(uMap, vUv) * uOpacity;
        }
      `,
    });
    const worldHeight = options.lineHeight * 1.5;
    const geometry = new PlaneGeometry(
      (worldHeight * width) / height,
      worldHeight,
    );
    this.object = new Mesh(geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 20;
  }

  set opacity(value: number) {
    this.material.uniforms.uOpacity.value = value;
    this.object.visible = value > 0.003;
  }

  /** Redraws only when the text changes. */
  setText(text: string, color = '#ffffff'): void {
    const key = text + color;
    if (key === this.text) return;
    this.text = key;
    const { canvas, context } = this;
    const { width, height } = canvas;
    context.clearRect(0, 0, width, height);
    const size = Math.floor(height / 1.5);
    context.font = `${this.options.weight ?? 500} ${size}px ${FONT}`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    if (this.options.plate === true && text.length > 0) {
      const measured = Math.min(width, context.measureText(text).width + size * 1.4);
      const left = (width - measured) / 2;
      context.fillStyle = 'rgba(6, 8, 22, 0.62)';
      context.beginPath();
      context.roundRect(left, 2, measured, height - 4, (height - 4) / 2);
      context.fill();
    }
    context.fillStyle = color;
    context.fillText(text, width / 2, height / 2 + size * 0.04, width - 8);
    this.texture.needsUpdate = true;
  }
}
