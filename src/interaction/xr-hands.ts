/**
 * Reads WebXR input into plain per-hand state for the gesture code. Hands use
 * real joints. Controllers are optional and pretend to be a hand: the trigger
 * pinches and the X button stands in for the palm gesture.
 */

import { Vec3Like } from '../sequencer/mapping';
import {
  createHandJoints,
  distance,
  HandJoints,
  Handedness,
} from './gestures';

/** Same order as the fields filled in `readJoints`. */
const JOINT_NAMES: readonly XRHandJoint[] = [
  'wrist',
  'thumb-tip',
  'index-finger-tip',
  'middle-finger-tip',
  'ring-finger-tip',
  'pinky-finger-tip',
  'index-finger-metacarpal',
  'middle-finger-metacarpal',
  'pinky-finger-metacarpal',
];

type FrameWithFillPoses = XRFrame & {
  fillPoses?: (
    spaces: XRSpace[],
    baseSpace: XRSpace,
    transforms: Float32Array,
  ) => boolean;
};

export type InputKind = 'none' | 'hand' | 'controller';

export class HandState {
  kind: InputKind = 'none';
  readonly joints: HandJoints = createHandJoints();
  /** Between thumb and index tips: where a pinch acts. */
  readonly pinchPoint: Vec3Like = { x: 0, y: 0, z: 0 };
  /** The fingertip that presses buttons. */
  readonly pokeTip: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Thumb-to-index distance, or null when it is not known this frame. */
  pinchGap: number | null = null;
  triggerPressed = false;
  menuPressed = false;
  gamepad: Gamepad | null = null;

  constructor(readonly handedness: Handedness) {}

  get tracked(): boolean {
    return this.kind !== 'none';
  }

  reset(): void {
    this.kind = 'none';
    this.pinchGap = null;
    this.triggerPressed = false;
    this.menuPressed = false;
    this.gamepad = null;
  }
}

function assign(target: Vec3Like, values: Float32Array, offset: number): void {
  target.x = values[offset];
  target.y = values[offset + 1];
  target.z = values[offset + 2];
}

export class XRHandReader {
  readonly left = new HandState('left');
  readonly right = new HandState('right');
  private readonly matrices = new Float32Array(JOINT_NAMES.length * 16);
  private readonly spaces = new WeakMap<XRHand, XRJointSpace[]>();

  read(frame: XRFrame, session: XRSession, space: XRReferenceSpace): void {
    this.left.reset();
    this.right.reset();
    const sources = session.inputSources;
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (source.handedness === 'none') continue;
      const state = source.handedness === 'left' ? this.left : this.right;
      // A hand always wins over a controller listed for the same side.
      if (source.hand !== undefined && source.hand !== null) {
        this.readHand(state, source.hand, frame, space);
      } else if (state.kind === 'none') {
        this.readController(state, source, frame, space);
      }
    }
  }

  clear(): void {
    this.left.reset();
    this.right.reset();
  }

  private spacesFor(hand: XRHand): XRJointSpace[] | null {
    let spaces = this.spaces.get(hand);
    if (spaces !== undefined) return spaces;
    spaces = [];
    for (const name of JOINT_NAMES) {
      const joint = hand.get(name);
      if (joint === undefined) return null;
      spaces.push(joint);
    }
    this.spaces.set(hand, spaces);
    return spaces;
  }

  private readHand(
    state: HandState,
    hand: XRHand,
    frame: XRFrame,
    space: XRReferenceSpace,
  ): void {
    const spaces = this.spacesFor(hand);
    if (spaces === null) return;
    if (!this.fillMatrices(frame, spaces, space)) return;

    const { joints } = state;
    const m = this.matrices;
    assign(joints.wrist, m, 12);
    assign(joints.thumbTip, m, 16 + 12);
    assign(joints.indexTip, m, 32 + 12);
    assign(joints.middleTip, m, 48 + 12);
    assign(joints.ringTip, m, 64 + 12);
    assign(joints.pinkyTip, m, 80 + 12);
    assign(joints.indexMeta, m, 96 + 12);
    assign(joints.middleMeta, m, 112 + 12);
    assign(joints.pinkyMeta, m, 128 + 12);

    state.kind = 'hand';
    state.pinchGap = distance(joints.thumbTip, joints.indexTip);
    state.pinchPoint.x = (joints.thumbTip.x + joints.indexTip.x) / 2;
    state.pinchPoint.y = (joints.thumbTip.y + joints.indexTip.y) / 2;
    state.pinchPoint.z = (joints.thumbTip.z + joints.indexTip.z) / 2;
    state.pokeTip.x = joints.indexTip.x;
    state.pokeTip.y = joints.indexTip.y;
    state.pokeTip.z = joints.indexTip.z;
  }

  /** Prefers the allocation-free batch call the Hand Input spec defines. */
  private fillMatrices(
    frame: XRFrame,
    spaces: XRJointSpace[],
    space: XRReferenceSpace,
  ): boolean {
    const batched = frame as FrameWithFillPoses;
    if (batched.fillPoses !== undefined) {
      return batched.fillPoses(spaces, space, this.matrices);
    }
    for (let i = 0; i < spaces.length; i++) {
      const pose = frame.getJointPose?.(spaces[i], space);
      if (pose === undefined || pose === null) return false;
      this.matrices.set(pose.transform.matrix, i * 16);
    }
    return true;
  }

  private readController(
    state: HandState,
    source: XRInputSource,
    frame: XRFrame,
    space: XRReferenceSpace,
  ): void {
    const pose = frame.getPose(source.gripSpace ?? source.targetRaySpace, space);
    if (pose === undefined || pose === null) return;
    const { position } = pose.transform;
    state.kind = 'controller';
    state.pinchPoint.x = state.pokeTip.x = position.x;
    state.pinchPoint.y = state.pokeTip.y = position.y;
    state.pinchPoint.z = state.pokeTip.z = position.z;
    const gamepad = source.gamepad ?? null;
    state.gamepad = gamepad;
    state.triggerPressed = gamepad?.buttons[0]?.pressed ?? false;
    state.menuPressed = gamepad?.buttons[4]?.pressed ?? false;
  }
}
