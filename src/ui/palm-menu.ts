/**
 * The menu that opens above the left palm. All buttons share one instanced
 * draw call and one icon atlas; only the tempo and goal text add a label each.
 */

import {
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  NoColorSpace,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { Vec3Like } from '../sequencer/mapping';
import { lightMaterial } from '../visuals/materials';
import { Palette } from '../visuals/palettes';
import { ATLAS_COLUMNS, ATLAS_ROWS, drawIconAtlas, IconName, iconUv } from './icons';
import { Label } from './label';
import { PokePanel, PokeRect } from './poke';

export type MenuAction =
  | 'slower'
  | 'faster'
  | 'playPause'
  | 'undo'
  | 'rotate'
  | 'scene'
  | 'backdrop'
  | 'save'
  | 'clear'
  | 'home';

interface ButtonSpec {
  action: MenuAction;
  icon: IconName;
  column: number;
  row: number;
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'slower', icon: 'minus', column: 0, row: 0 },
  { action: 'faster', icon: 'plus', column: 3, row: 0 },
  { action: 'playPause', icon: 'pause', column: 0, row: 1 },
  { action: 'undo', icon: 'undo', column: 1, row: 1 },
  { action: 'rotate', icon: 'rotate', column: 2, row: 1 },
  { action: 'scene', icon: 'palette', column: 3, row: 1 },
  { action: 'backdrop', icon: 'stars', column: 0, row: 2 },
  { action: 'save', icon: 'save', column: 1, row: 2 },
  { action: 'clear', icon: 'trash', column: 2, row: 2 },
  { action: 'home', icon: 'home', column: 3, row: 2 },
];

const CELL = 0.05;
const GAP = 0.007;
const PITCH = CELL + GAP;
const COLUMNS = 4;
const ROWS = 3;
const PANEL_WIDTH = COLUMNS * PITCH + 0.016;
const PANEL_HEIGHT = ROWS * PITCH + 0.016;
const ABOVE_PALM = 0.13;
const FOLLOW_RATE = 12;
/** While a finger is close, the panel nearly stops so buttons hold still. */
const SETTLED_RATE = 1.5;
const FINGER_NEAR = 0.16;
const FADE_RATE = 13;
const FLASH_DECAY = 7;

function buttonRect(spec: ButtonSpec): PokeRect {
  return {
    x: (spec.column - (COLUMNS - 1) / 2) * PITCH,
    y: ((ROWS - 1) / 2 - spec.row) * PITCH,
    width: CELL,
    height: CELL,
  };
}

export class PalmMenu {
  readonly object = new Group();
  /** True when the finger is around the panel, so it should not grab orbs. */
  fingerNear = false;
  onAction: ((action: MenuAction) => void) | null = null;

  private readonly poke = new PokePanel(BUTTONS.map(buttonRect));
  private readonly buttons: InstancedMesh;
  private readonly panelMaterial: ShaderMaterial;
  private readonly buttonMaterial: ShaderMaterial;
  private readonly states: Float32Array;
  private readonly stateAttribute: InstancedBufferAttribute;
  private readonly uvs: Float32Array;
  private readonly uvAttribute: InstancedBufferAttribute;
  private readonly hover = new Float32Array(BUTTONS.length);
  private readonly flash = new Float32Array(BUTTONS.length);
  private readonly tempo = new Label({
    lineHeight: 0.024,
    width: 512,
    height: 96,
    weight: 400,
  });
  private readonly goal = new Label({
    lineHeight: 0.0145,
    width: 1500,
    height: 72,
    weight: 400,
    plate: true,
  });
  private readonly target = new Vector3();
  private readonly localTip = new Vector3();
  private readonly lookAtMatrix = new Matrix4();
  private readonly upAxis = new Vector3(0, 1, 0);
  private readonly targetQuaternion = new Quaternion();
  private visibility = 0;
  private open = false;

  constructor() {
    const atlas = new CanvasTexture(drawIconAtlas());
    atlas.colorSpace = NoColorSpace;
    atlas.minFilter = LinearFilter;
    atlas.generateMipmaps = false;

    this.panelMaterial = lightMaterial({
      side: DoubleSide,
      uniforms: {
        uOpacity: { value: 0 },
        uSize: { value: [PANEL_WIDTH, PANEL_HEIGHT] },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        uniform vec2 uSize;
        varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * uSize;
          vec2 q = abs(p) - uSize * 0.5 + 0.018;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.018;
          float aa = fwidth(d) * 1.2;
          float fill = 1.0 - smoothstep(-aa, 0.0, d);
          float a = fill * 0.74 * uOpacity;
          gl_FragColor = vec4(vec3(0.03, 0.04, 0.1) * a, a);
        }
      `,
    });
    const panel = new Mesh(
      new PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      this.panelMaterial,
    );
    panel.renderOrder = 10;
    panel.frustumCulled = false;

    const geometry = new PlaneGeometry(CELL, CELL);
    this.uvs = new Float32Array(BUTTONS.length * 2);
    this.states = new Float32Array(BUTTONS.length * 2);
    this.uvAttribute = new InstancedBufferAttribute(this.uvs, 2);
    this.stateAttribute = new InstancedBufferAttribute(this.states, 2);
    this.stateAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('aIcon', this.uvAttribute);
    geometry.setAttribute('aState', this.stateAttribute);
    this.buttonMaterial = lightMaterial({
      depthTest: false,
      uniforms: {
        uAtlas: { value: atlas },
        uCell: { value: [1 / ATLAS_COLUMNS, 1 / ATLAS_ROWS] },
        uAccent: { value: new Vector3(1, 1, 1) },
        uOpacity: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec2 aIcon;
        attribute vec2 aState;
        uniform vec2 uCell;
        varying vec2 vUv;
        varying vec2 vIcon;
        varying vec2 vState;
        void main() {
          vUv = uv;
          vIcon = aIcon + uv * uCell;
          vState = aState;
          vec3 p = position;
          p.z -= aState.y * 0.004;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        uniform vec3 uAccent;
        uniform float uOpacity;
        varying vec2 vUv;
        varying vec2 vIcon;
        varying vec2 vState;
        void main() {
          vec2 p = abs(vUv - 0.5) - 0.34;
          float d = length(max(p, 0.0)) + min(max(p.x, p.y), 0.0) - 0.16;
          float aa = fwidth(d) * 1.2;
          float fill = 1.0 - smoothstep(-aa, 0.0, d);
          float border = fill * (1.0 - smoothstep(0.0, aa * 1.5, abs(d + 0.02) - 0.008));
          float hover = vState.x;
          float press = vState.y;
          float icon = texture2D(uAtlas, vIcon).a;
          vec3 base = mix(vec3(0.09, 0.11, 0.2), uAccent * 0.42, hover);
          base = mix(base, uAccent, press);
          vec3 glyph = mix(vec3(0.92), vec3(0.03, 0.04, 0.1), press);
          vec3 color = mix(base, glyph, icon);
          color += uAccent * border * (0.2 + hover * 0.5);
          float a = fill * uOpacity;
          gl_FragColor = vec4(color * a, a);
        }
      `,
    });
    this.buttons = new InstancedMesh(geometry, this.buttonMaterial, BUTTONS.length);
    this.buttons.frustumCulled = false;
    this.buttons.renderOrder = 11;
    const matrix = new Matrix4();
    BUTTONS.forEach((spec, index) => {
      const rect = buttonRect(spec);
      matrix.makeTranslation(rect.x, rect.y, 0.002);
      this.buttons.setMatrixAt(index, matrix);
      this.setIcon(index, spec.icon);
    });

    this.tempo.object.position.set(0, PITCH, 0.003);
    this.goal.object.position.set(0, PANEL_HEIGHT / 2 + 0.018, 0.003);
    this.object.add(panel, this.buttons, this.tempo.object, this.goal.object);
    this.object.visible = false;
  }

  get isOpen(): boolean {
    return this.open;
  }

  setAccent(palette: Palette): void {
    const [r, g, b] = palette.beam;
    (this.buttonMaterial.uniforms.uAccent.value as Vector3).set(r, g, b);
  }

  setTempo(bpm: number): void {
    this.tempo.setText(`${bpm} BPM`);
  }

  setGoal(text: string, done: boolean): void {
    this.goal.setText(done ? `✓ ${text}` : text, done ? '#8dffb0' : '#ffffff');
  }

  setPaused(paused: boolean): void {
    this.setIcon(this.indexOf('playPause'), paused ? 'play' : 'pause');
  }

  setBackdrop(starfield: boolean): void {
    this.setIcon(this.indexOf('backdrop'), starfield ? 'room' : 'stars');
  }

  /** World position of a button's centre. */
  buttonPosition(action: MenuAction, out: Vector3): Vector3 {
    const rect = buttonRect(BUTTONS[this.indexOf(action)]);
    return this.object.localToWorld(out.set(rect.x, rect.y, 0));
  }

  setOpen(open: boolean, palm: Vec3Like, head: Vec3Like): void {
    if (open === this.open) return;
    this.open = open;
    if (open) {
      this.computeTarget(palm, head);
      this.object.position.copy(this.target);
      this.object.quaternion.copy(this.targetQuaternion);
    } else {
      this.poke.reset();
      this.fingerNear = false;
    }
  }

  update(
    palm: Vec3Like,
    head: Vec3Like,
    finger: Vec3Like | null,
    dt: number,
  ): void {
    const rate = 1 - Math.exp(-dt * FADE_RATE);
    this.visibility += ((this.open ? 1 : 0) - this.visibility) * rate;
    if (!this.open && this.visibility < 0.01) this.visibility = 0;
    this.object.visible = this.visibility > 0;
    if (!this.object.visible) return;

    this.fingerNear = false;
    if (this.open && finger !== null) {
      this.fingerNear =
        this.object.position.distanceTo(finger as Vector3) < FINGER_NEAR;
    }

    if (this.open) {
      this.computeTarget(palm, head);
      const follow = 1 - Math.exp(
        -dt * (this.fingerNear ? SETTLED_RATE : FOLLOW_RATE),
      );
      this.object.position.lerp(this.target, follow);
      this.object.quaternion.slerp(this.targetQuaternion, follow);
    }

    const scale = 0.82 + 0.18 * this.visibility;
    this.object.scale.setScalar(scale);
    this.panelMaterial.uniforms.uOpacity.value = this.visibility;
    this.buttonMaterial.uniforms.uOpacity.value = this.visibility;
    this.tempo.opacity = this.visibility;
    this.goal.opacity = this.visibility;

    let hovered = -1;
    if (this.open && finger !== null) {
      this.localTip.copy(finger as Vector3);
      this.object.worldToLocal(this.localTip);
      const result = this.poke.update(
        this.localTip.x,
        this.localTip.y,
        this.localTip.z,
        dt,
      );
      hovered = result.hovered;
      if (result.pressed >= 0) {
        this.flash[result.pressed] = 1;
        this.onAction?.(BUTTONS[result.pressed].action);
      }
    } else {
      this.poke.reset();
    }

    const flashDecay = Math.exp(-dt * FLASH_DECAY);
    for (let i = 0; i < BUTTONS.length; i++) {
      const wanted = i === hovered ? 1 : 0;
      this.hover[i] += (wanted - this.hover[i]) * (1 - Math.exp(-dt * 20));
      this.flash[i] *= flashDecay;
      this.states[i * 2] = this.hover[i];
      this.states[i * 2 + 1] = this.flash[i];
    }
    this.stateAttribute.needsUpdate = true;
  }

  private indexOf(action: MenuAction): number {
    return BUTTONS.findIndex((button) => button.action === action);
  }

  private setIcon(index: number, icon: IconName): void {
    const [u, v] = iconUv(icon);
    this.uvs[index * 2] = u;
    this.uvs[index * 2 + 1] = v;
    this.uvAttribute.needsUpdate = true;
  }

  private computeTarget(palm: Vec3Like, head: Vec3Like): void {
    this.target.set(palm.x, palm.y + ABOVE_PALM, palm.z);
    // Faces the eyes, staying upright: lookAt points -Z of a matrix built with
    // eye = target, so looking from the head at the panel keeps +Z on the user.
    this.lookAtMatrix.lookAt(head as Vector3, this.target, this.upAxis);
    this.targetQuaternion.setFromRotationMatrix(this.lookAtMatrix);
  }
}
