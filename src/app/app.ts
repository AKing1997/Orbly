/** Wires input, state, sound and visuals together, once per frame. */

import {
  Group,
  MathUtils,
  Matrix4,
  Quaternion,
  SessionMode,
  Vector3,
  World,
} from '@iwsdk/core';
import {
  AimDwell,
  ListeningDetector,
  ListeningHand,
  PalmUpDetector,
  PinchDetector,
  PinchEdges,
} from '../interaction/gestures';
import { GrabController, OrbHost } from '../interaction/grab';
import { HandState, XRHandReader } from '../interaction/xr-hands';
import { RoomMemory, sameFrame } from '../room/memory';
import {
  resolveSpot,
  RoomHit,
  roomSlot,
  snapToStep,
  stageEye,
  SURFACE_BAND,
  toSpot,
} from '../room/surfaces';
import { assistAim, planThrow } from '../room/throw';
import { XRAnchorBackend } from '../room/xr-anchors';
import {
  canCreateAt,
  clampToStage,
  dropZoneAmount,
  makeStage,
  polarToPosition,
  positionToSlot,
  Slot,
  slotToPosition,
  Stage,
  Vec3Like,
} from '../sequencer/mapping';
import { challengeFor, dateKey } from '../state/challenge';
import { emptyComposition, MAX_ORBS, OrbData } from '../state/composition';
import { browserStorage, Library, Progress } from '../state/storage';
import { CompositionStore, StoreEvent } from '../state/store';
import { HomeScreen } from '../ui/home';
import { EntryOverlay } from '../ui/overlay';
import { MenuAction, PalmMenu } from '../ui/palm-menu';
import { locale, t } from '../ui/strings';
import { Toast } from '../ui/toast';
import { TutorialView } from '../ui/tutorial';
import { Backdrop } from '../visuals/backdrop';
import { Beam } from '../visuals/beam';
import { OrbField } from '../visuals/orbs';
import { Palette, PALETTES } from '../visuals/palettes';
import { Particles } from '../visuals/particles';
import { FloorRing } from '../visuals/ring';
import { RoomPulse } from '../visuals/room';
import { Tether } from '../visuals/tether';
import { RoomVeil } from '../visuals/veil';
import { DemoDirector, DemoHost } from './demo';
import { BEAT_FLASH, Music } from './music';
import { SessionLifecycle } from './session';
import { HeadPose } from './stage-pose';

type Mode = 'idle' | 'home' | 'tutorial' | 'play' | 'demo';

interface EmulatedDevice {
  /** 'programmatic' hands the camera to the page and hides the emulator UI. */
  controlMode: 'manual' | 'programmatic';
  position: { set(x: number, y: number, z: number): void };
  quaternion: { set(x: number, y: number, z: number, w: number): void };
  hands: Record<'left' | 'right', { connected: boolean }>;
  controllers: Record<'left' | 'right', { connected: boolean }>;
  devui?: { devUIContainer?: HTMLElement };
}

/** Present only in the IWER emulator, never in a production build. */
function emulator(): EmulatedDevice | null {
  const scope = globalThis as unknown as { IWER_DEVICE?: EmulatedDevice };
  return scope.IWER_DEVICE ?? null;
}

const DEMO_EYE_HEIGHT = 1.22;
const TARGET_FRAME_RATE = 72;

const MAX_DT = 0.1;
const CELEBRATION_CHORD = [72, 76, 79, 84];
const MAX_PARTICLES = 360;
const BPM_STEP = 4;
/** Quarter turn of the ring, bringing what was on the right to the front. */
const RING_TURN_STEPS = -4;
/** cos 8 degrees: how precisely a hand must point at a far orb. */
const FAR_AIM_COSINE = 0.99;
/** Closer than this an orb is simply within reach. */
const FAR_MIN_DISTANCE = 0.7;
/** Lifts orbs off the surface so they sit on it, not inside it. */
const SURFACE_OFFSET = 0.02;
const RECALL_DONE_DISTANCE = 0.08;
const MEMORY_CHECK_INTERVAL = 0.25;
/** How long to look for a song in this room before leaving the user at home. */
const ROOM_SEARCH_SECONDS = 6;
/** Hands lower than this above the lowest note are resting. */
const REST_LINE_ABOVE_BASE = 0.05;
/** How far the house lights go down: the room stays faintly visible. */
const CONCERT_DARKNESS = 0.68;
const CONCERT_FADE_IN = 0.9;
const CONCERT_FADE_OUT = 5;
const COMET_LIFE = 0.5;
const XR_PIXELS_PER_UNIT = 820;
const XR_STAR_SCALE = 2;
const SESSION_START_TIMEOUT = 12000;

export class OrblyApp implements DemoHost {
  readonly store = new CompositionStore();
  readonly root = new Group();
  readonly head: HeadPose;
  readonly hands = new XRHandReader();
  readonly orbs = new OrbField(MAX_ORBS + 12);
  readonly music: Music;
  readonly menu = new PalmMenu();
  readonly home = new HomeScreen();
  readonly tutorial = new TutorialView();
  readonly library: Library;
  readonly progress: Progress;

  stage: Stage | null = null;
  mode: Mode = 'idle';

  private readonly beam = new Beam();
  private readonly ring = new FloorRing();
  private readonly particles = new Particles(MAX_PARTICLES);
  private readonly room = new RoomPulse();
  private readonly tethers = [new Tether(), new Tether()];
  private readonly veil = new RoomVeil();
  private readonly listening = new ListeningDetector();
  private readonly listeningHands: ListeningHand[] = [
    { position: null, pinching: false },
    { position: null, pinching: false },
  ];
  /** 0 with the lights up, 1 in full concert. */
  private concertLevel = 0;
  private concertHintShown = false;
  private demoConcert = false;
  /** The last orb that sounded in concert, where the next comet starts. */
  private readonly lastFlash = new Vector3();
  private hasLastFlash = false;
  private readonly anchorBackend = new XRAnchorBackend();
  private readonly memory = new RoomMemory(this.anchorBackend);
  /** The anchor pinning the current song to this room, if it has one. */
  private songAnchor: string | null = null;
  /**
   * The frame room orbs are stored in, once the song's anchor is found. Until
   * then they are placed from the user's own stage, which is what also lets a
   * song land on the surfaces of a different room.
   */
  private songStage: Stage | null = null;
  /** Changes with each song, so a slow pin cannot land on the next one. */
  private songToken = 0;
  private pinning = false;
  private anchorChanged = false;
  private lookingForSong = false;
  private searchTime = 0;
  private sinceMemoryCheck = 0;
  private readonly backdrop = new Backdrop();
  private readonly toast = new Toast();
  private readonly overlay: EntryOverlay;
  private readonly palm = new PalmUpDetector();
  private readonly pinches = [new PinchDetector(), new PinchDetector()];
  private readonly grabs: GrabController[];
  private readonly aims = [new AimDwell(), new AimDwell()];
  /** The far orb each hand has pointed at for long enough, or -1. */
  private readonly aimed = [-1, -1];
  private readonly scratch = new Vector3();
  /** Separate from `scratch`: store events fire in the middle of its users. */
  private readonly eventScratch = new Vector3();
  private readonly tetherScratch = new Vector3();
  /** The stage centre at eye level, where the room's light sweeps from. */
  private readonly eye = new Vector3();
  /** Where each flying orb will come to rest. */
  private readonly landings = new Map<number, RoomHit>();
  /** Far orbs on their way back to the hand that called them. */
  private readonly reeling = new Set<number>();
  /** Orbs still in the gesture that created them: one gesture, one undo. */
  private readonly freshOrbs = new Set<number>();
  private readonly dropSlot: Slot = { step: 0, degree: 0, band: 0 };
  private readonly dragSlot: Slot = { step: -1, degree: -1, band: -1 };
  private readonly hoverIds = [-1, -1];
  private palette: Palette = PALETTES[0];
  private inSession = false;
  private sessionMode = SessionMode.ImmersiveAR;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;
  private level = 0;
  private beat = 0;
  private controllerMenuOpen = false;
  private menuButtonWasDown = false;
  private readonly demoRequested: boolean;
  /** `&flat=1` films the starfield view even inside the emulator. */
  private readonly demoInXR: boolean;
  private demo: DemoDirector | null = null;
  private readonly lookScratch = new Matrix4();
  private readonly lookQuaternion = new Quaternion();
  private readonly edges: PinchEdges[] = [];
  private readonly tips: (Vec3Like | null)[] = [null, null];
  private readonly pinchPoints: Vec3Like[];
  private readonly pinchStarts = [false, false];
  /** The library entry being edited, or null for a loop not yet saved. */
  private saveId: number | null = null;
  private savedRevision = 0;
  private dragStartDegree = 0;
  private readonly challenge = challengeFor(new Date());
  private readonly challengeKey = dateKey(new Date());

  constructor(private readonly world: World) {
    this.head = new HeadPose(world);
    const storage = browserStorage();
    this.library = new Library(storage);
    this.progress = new Progress(storage);
    this.pinchPoints = [this.hands.left.pinchPoint, this.hands.right.pinchPoint];
    this.music = new Music(
      this.store,
      (id) => this.isHeld(id) || this.orbs.isFlying(id),
    );
    this.grabs = [new GrabController(0, this), new GrabController(1, this)];

    world.createTransformEntity(this.root);
    this.root.visible = false;
    this.root.add(
      this.backdrop.object,
      this.veil.object,
      this.room.object,
      this.ring.object,
      this.beam.object,
      this.orbs.object,
      this.particles.object,
      this.tethers[0].object,
      this.tethers[1].object,
      this.menu.object,
      this.home.object,
      this.tutorial.object,
      this.toast.object,
    );
    this.menu.onAction = (action) => this.onMenuAction(action);
    this.menu.setTempo(this.store.bpm);
    this.updateGoal();
    this.home.onPick = (index) => this.openFromHome(index);
    this.tutorial.onSkip = () => this.finishTutorial(false);
    this.orbs.onLand = (id) => this.onOrbLanded(id);
    this.room.onSurfacesChanged = () => this.relocateOrbs();
    this.applyPalette();

    this.store.subscribe((event) => this.onStoreEvent(event));

    const query = new URLSearchParams(location.search);
    this.demoRequested = query.get('demo') === '1';
    this.demoInXR = emulator() !== null && query.get('flat') !== '1';
    this.overlay = new EntryOverlay(() => this.enter());
    this.showEntry();
    new SessionLifecycle(world, {
      onStart: () => this.onSessionStart(),
      onEnd: () => this.onSessionEnd(),
      onActiveChange: (active) => this.onActiveChange(active),
    });
  }

  /** Offers the right start for this device. */
  private showEntry(): void {
    if (this.demoRequested) {
      this.overlay.show('demo');
      return;
    }
    this.overlay.show('loading');
    const xr = navigator.xr;
    if (xr === undefined) {
      this.overlay.show('unsupported');
      return;
    }
    Promise.all([
      xr.isSessionSupported('immersive-ar').catch(() => false),
      xr.isSessionSupported('immersive-vr').catch(() => false),
    ]).then(([ar, vr]) => {
      this.sessionMode = ar ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR;
      this.overlay.show(ar || vr ? 'ready' : 'unsupported');
    });
  }

  update(dt: number, time: number): void {
    this.step(dt, time);
    this.anchorBackend.endFrame();
  }

  private step(dt: number, time: number): void {
    const delta = Math.min(dt, MAX_DT);
    this.head.update();

    const frame = this.world.xrFrame;
    const session = this.world.session;
    const space = this.world.xrReferenceSpace;
    if (frame !== null && session !== undefined && space !== null) {
      this.anchorBackend.beginFrame(frame, space, session);
      if (this.stage === null) this.calibrate();
      this.hands.read(frame, session, space);
    } else {
      this.hands.clear();
    }

    const stage = this.stage;
    if (stage === null) return;

    this.readPinches(delta);
    this.updateMode(delta, time);
    this.updateTethers();
    this.updateRoomMemory(stage, delta);
    this.updateConcert(stage, delta);

    this.music.clock.tick();
    this.music.drainFlashes((id) => this.flash(id));
    if (this.mode !== 'demo') {
      this.music.setListener(this.head.position, this.head.forward, this.head.up);
    }

    const target = this.mode === 'home' ? 0.15 : this.music.paused ? 0.35 : 1;
    this.level += (target - this.level) * (1 - Math.exp(-delta * 3));
    const angle = this.music.beamAngle();
    // In concert the light rises and falls with the music.
    const glow = this.level *
      (1 + this.concertLevel * (0.2 + this.music.concertEnergy * 0.9));
    this.beam.update(angle, stage.yaw, this.head.position, glow);
    this.ring.update(angle, delta, this.level);
    this.beat *= Math.exp(-delta * 5);
    this.backdrop.update(this.head.position, this.beat, delta);
    this.room.update(frame, space, this.eye, angle - stage.yaw, glow, delta);
    this.orbs.update(delta);
    this.particles.update(delta);
    this.toast.update(delta);
  }

  /** Fits the grid to the current seat position and heading. */
  calibrate(): void {
    const { position, yaw } = this.head;
    if (position.lengthSq() === 0) return;
    const floorY = position.y > 0.6 ? 0 : position.y - 1.15;
    this.fitStage(makeStage(position, yaw, floorY));
    this.relocateOrbs();
    this.music.run();
    if (this.mode === 'idle') this.beginExperience();
  }

  private fitStage(stage: Stage): void {
    this.stage = stage;
    const { x, y, z } = stageEye(stage);
    this.eye.set(x, y, z);
    this.beam.setStage(stage);
    this.ring.setStage(stage);
    this.root.visible = true;
  }

  /** First visit: tutorial. Returning: home, or back to the loop in memory. */
  private beginExperience(): void {
    const known = this.library.anchors();
    if (this.songAnchor !== null) known.add(this.songAnchor);
    this.memory.prune(known);
    this.memory.recall(known);
    if (!this.progress.onboarded) {
      this.startTutorial();
    } else if (this.store.orbs.length > 0) {
      this.setMode('play');
    } else {
      this.goHome();
      this.lookingForSong = true;
      this.searchTime = 0;
    }
  }

  /** Sits back when the hands do, and hands the loop back when they rise. */
  private updateConcert(stage: Stage, dt: number): void {
    const { left, right } = this.hands;
    const [leftHand, rightHand] = this.listeningHands;
    leftHand.position = left.tracked ? left.steadyPoint : null;
    leftHand.pinching = this.pinches[0].isActive;
    rightHand.position = right.tracked ? right.steadyPoint : null;
    rightHand.pinching = this.pinches[1].isActive;

    const allowed = this.mode === 'play' && !this.music.paused &&
      this.store.orbs.length > 0 && !this.menu.isOpen &&
      this.grabs[0].held < 0 && this.grabs[1].held < 0;
    const listening = this.mode === 'demo'
      ? this.demoConcert
      : this.listening.update(
        this.listeningHands,
        stage.baseY + REST_LINE_ABOVE_BASE,
        allowed,
        dt,
      );

    if (listening !== this.music.inConcert) {
      this.music.setConcert(listening, Math.floor(Math.random() * 1e6));
      this.hasLastFlash = false;
      if (listening && !this.concertHintShown && this.mode !== 'demo') {
        this.concertHintShown = true;
        this.say(t('concertHint'));
      }
    }

    const rate = listening ? CONCERT_FADE_IN : CONCERT_FADE_OUT;
    const target = listening ? 1 : 0;
    this.concertLevel += (target - this.concertLevel) * (1 - Math.exp(-dt * rate));
    // The starfield is already dark, and opaque: there is nothing to dim.
    const darkness = this.backdrop.enabled ? 0 : this.concertLevel * CONCERT_DARKNESS;
    this.veil.update(this.eye, darkness);
  }

  /** Follows the song's anchor, and finds the song that belongs to this room. */
  private updateRoomMemory(stage: Stage, dt: number): void {
    this.sinceMemoryCheck += dt;
    if (this.sinceMemoryCheck < MEMORY_CHECK_INTERVAL) return;
    const elapsed = this.sinceMemoryCheck;
    this.sinceMemoryCheck = 0;

    if (this.songAnchor !== null) {
      const found = this.memory.locate(this.songAnchor, stage.floorY);
      if (
        found !== null &&
        (this.songStage === null || !sameFrame(found, this.songStage))
      ) {
        this.songStage = found;
        this.relocateOrbs();
      }
    }

    if (!this.lookingForSong) return;
    this.searchTime += elapsed;
    const index = this.library
      .list()
      .findIndex(
        (save) => save.anchor !== undefined && this.memory.isHere(save.anchor),
      );
    if (index >= 0) {
      this.openFromHome(index);
      this.say(t('roomRemembered'));
    } else if (this.mode !== 'home' || this.searchTime >= ROOM_SEARCH_SECONDS) {
      this.lookingForSong = false;
    }
  }

  /**
   * Fixes the song to this room, the first time one of its orbs lands here. A
   * song opened somewhere new gets a new anchor, since its orbs now belong to
   * this room's surfaces.
   */
  private pinSong(stage: Stage): void {
    if (this.pinning || this.mode === 'demo') return;
    if (this.songAnchor !== null && this.songStage !== null) return;
    const token = this.songToken;
    const frame: Stage = { ...stage };
    this.pinning = true;
    this.memory.pin(frame).then((uuid) => {
      this.pinning = false;
      if (uuid === null || token !== this.songToken) return;
      this.songAnchor = uuid;
      this.songStage = frame;
      this.anchorChanged = true;
    });
  }

  /** Starts a new song, which is pinned to `anchor` if it already has a room. */
  private beginSong(anchor: string | null): void {
    this.songToken++;
    this.songAnchor = anchor;
    this.songStage = null;
    this.anchorChanged = false;
    const stage = this.stage;
    if (anchor === null || stage === null) return;
    this.memory.recall([anchor]);
    this.songStage = this.memory.locate(anchor, stage.floorY);
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    if (mode !== 'home') this.home.hide();
    if (mode === 'home') this.music.clock.stop();
    else if (!this.music.paused) this.music.run();
    this.beam.object.visible = mode !== 'home';
  }

  private startTutorial(): void {
    if (this.stage === null) return;
    this.setMode('tutorial');
    this.tutorial.start(this.stage);
  }

  private finishTutorial(completed: boolean): void {
    this.tutorial.stop();
    this.progress.markOnboarded();
    this.setMode('play');
    if (completed) {
      this.say(t('tutorialDone'));
      this.celebrate();
    }
  }

  private goHome(): void {
    const stage = this.stage;
    if (stage === null) return;
    if (this.mode === 'tutorial') this.finishTutorial(false);
    this.saveIfChanged();
    this.grabs.forEach((grab) => grab.cancel());
    this.palm.reset();
    this.menu.setOpen(false, this.head.position, this.head);
    this.beginSong(null);
    this.store.load(emptyComposition());
    this.saveId = null;
    this.savedRevision = this.store.revision;
    this.setMode('home');
    this.home.show(
      stage,
      this.library.list(),
      this.challenge.text[locale],
      this.progress.challengeDone(this.challengeKey),
    );
  }

  private openFromHome(saveIndex: number): void {
    const save = this.library.list()[saveIndex];
    this.lookingForSong = false;
    this.calibrate();
    this.beginSong(save?.anchor ?? null);
    this.store.load(save?.composition ?? emptyComposition());
    this.saveId = save?.id ?? null;
    this.savedRevision = this.store.revision;
    this.music.setPaused(false);
    this.menu.setPaused(false);
    this.music.audio.ui('confirm');
    this.setMode('play');
  }

  private saveCurrent(): void {
    this.saveId = this.library.save(
      this.store.snapshot(),
      this.saveId,
      Date.now(),
      this.songAnchor,
    );
    this.savedRevision = this.store.revision;
    this.anchorChanged = false;
  }

  /** Never lose work on the way home. */
  private saveIfChanged(): void {
    if (this.store.orbs.length === 0) return;
    if (this.store.revision !== this.savedRevision || this.anchorChanged) {
      this.saveCurrent();
    }
  }

  private updateGoal(): void {
    this.menu.setGoal(
      this.challenge.text[locale],
      this.progress.challengeDone(this.challengeKey),
    );
  }

  private checkChallenge(): void {
    if (this.mode !== 'play') return;
    if (this.progress.challengeDone(this.challengeKey)) return;
    if (!this.challenge.isMet(this.store.snapshot())) return;
    this.progress.markChallengeDone(this.challengeKey);
    this.updateGoal();
    this.say(t('challengeDone'));
    this.celebrate();
  }

  /** A ring of sparks around the user and a rising chord. */
  private celebrate(): void {
    const stage = this.stage;
    if (stage === null) return;
    const y = this.head.position.y - 0.25;
    for (let i = 0; i < 16; i++) {
      polarToPosition((i / 16) * Math.PI * 2, 0.55, stage, this.eventScratch);
      this.particles.burst(
        this.eventScratch.x,
        y,
        this.eventScratch.z,
        this.palette.instruments[i % 3],
        { count: 7, speed: 0.42, size: 0.012, life: 1.1, lift: 0.8 },
      );
    }
    const { audio } = this.music;
    CELEBRATION_CHORD.forEach((note, index) => {
      setTimeout(() => audio.playCentered(note, 0, 0.7), index * 70);
    });
  }

  private enter(): void {
    this.music.unlock();
    if (this.demoRequested && !this.demoInXR) {
      this.overlay.hide();
      this.startDemo();
      return;
    }
    const failed = this.sessionFailed;
    this.sessionTimer = setTimeout(failed, SESSION_START_TIMEOUT);
    this.world.launchXR({ sessionMode: this.sessionMode });
  }

  /** The headset refused or never answered: let the user try again. */
  private readonly sessionFailed = (): void => {
    if (this.inSession) return;
    this.overlay.showError();
  };

  private startDemo(): void {
    const { fov } = this.world.camera;
    const stage = makeStage({ x: 0, y: DEMO_EYE_HEIGHT, z: 0 }, 0, 0);
    this.fitStage(stage);
    if (!this.inSession) {
      const height = this.world.renderer.domElement.height;
      this.particles.setPixelsPerUnit(
        height / (2 * Math.tan(MathUtils.degToRad(fov) / 2)),
      );
      this.setBackdrop(true);
    }
    this.mode = 'demo';
    this.music.run();
    this.demo = new DemoDirector(
      this,
      stage,
      this.root,
      () => this.palette.beam,
    );
  }

  private onSessionStart(): void {
    this.inSession = true;
    if (this.sessionTimer !== null) clearTimeout(this.sessionTimer);
    this.overlay.hide();
    this.music.unlock();
    this.particles.setPixelsPerUnit(XR_PIXELS_PER_UNIT);
    this.backdrop.setPointScale(XR_STAR_SCALE);
    this.setBackdrop(this.sessionMode === SessionMode.ImmersiveVR);
    const session = this.world.session;
    session?.addEventListener('selectstart', this.onSelect);
    this.tuneForHeadset(session);
    if (this.demoRequested) {
      const device = emulator();
      if (device !== null) {
        device.controlMode = 'programmatic';
        device.devui?.devUIContainer?.style.setProperty('display', 'none');
        for (const side of ['left', 'right'] as const) {
          device.hands[side].connected = false;
          device.controllers[side].connected = false;
        }
      }
      this.startDemo();
    }
  }

  /** Spends less per frame on what orbly does not use. */
  private tuneForHeadset(session: XRSession | undefined): void {
    this.world.renderer.xr.setFoveation(1);
    session?.updateTargetFrameRate?.(TARGET_FRAME_RATE)?.catch(() => undefined);
    const { multiPointers } = this.world.input.xr;
    for (const pointer of [multiPointers.left, multiPointers.right]) {
      pointer.toggleSubPointer('ray', false);
      pointer.toggleSubPointer('touch', false);
    }
  }

  /** A pinch counts as a user gesture, in case audio is still locked. */
  private readonly onSelect = (): void => {
    if (!this.music.audio.isRunning) this.music.unlock();
  };

  private onSessionEnd(): void {
    this.inSession = false;
    this.grabs.forEach((grab) => grab.cancel());
    this.pinches.forEach((pinch) => pinch.reset());
    this.palm.reset();
    this.menu.setOpen(false, this.head.position, this.head);
    this.saveIfChanged();
    this.tutorial.stop();
    this.home.hide();
    this.mode = 'idle';
    this.demo = null;
    this.lookingForSong = false;
    this.memory.reset();
    this.anchorBackend.endSession();
    this.songStage = null;
    this.listening.reset();
    this.music.setConcert(false, 0);
    this.concertLevel = 0;
    this.veil.update(this.eye, 0);
    this.music.halt();
    this.room.clear();
    this.stage = null;
    this.root.visible = false;
    this.showEntry();
  }

  private onActiveChange(active: boolean): void {
    if (active) {
      this.music.audio.resume();
    } else {
      this.grabs.forEach((grab) => grab.cancel());
      this.music.audio.suspend();
      // Taking the headset off may be the last thing that ever happens.
      this.saveIfChanged();
    }
  }

  private onStoreEvent(event: StoreEvent): void {
    const stage = this.stage;
    switch (event.type) {
      case 'add':
      case 'move':
        if (stage !== null) {
          this.placeOf(event.orb, stage, this.eventScratch);
          this.music.audio.setOrbPosition(event.orb.id, this.eventScratch);
        }
        this.checkChallenge();
        break;
      case 'remove':
        this.orbs.dissolve(event.orb.id);
        this.music.audio.releaseOrb(event.orb.id);
        this.onOrbsChanged();
        break;
      case 'reset':
        this.relocateOrbs();
        this.onOrbsChanged();
        break;
      case 'bpm':
        this.music.setBpm(event.bpm);
        this.menu.setTempo(event.bpm);
        break;
      case 'scene':
        this.applyPalette();
        break;
    }
  }

  private onOrbsChanged(): void {
    this.checkChallenge();
    if (this.mode === 'tutorial' && this.store.orbs.length === 0) {
      this.tutorial.flow.orbsGone();
    }
  }

  /**
   * Where an orb rests, written to `out`. Returns the surface it sits on, or
   * null for an orb on the near ring.
   */
  private placeOf(orb: OrbData, stage: Stage, out: Vector3): RoomHit | null {
    if (orb.spot === undefined) {
      slotToPosition(orb, stage, out);
      return null;
    }
    const frame = this.songStage ?? stage;
    const hit = resolveSpot(orb.spot, frame, this.room.surfaces);
    out.set(hit.point.x, hit.point.y, hit.point.z);
    out.addScaledVector(hit.normal as Vector3, SURFACE_OFFSET);
    return hit;
  }

  /** Far orbs grow a little, so one across the room still reads. */
  private orbSizeAt(point: Vec3Like): number {
    return 1 + 0.32 * this.eye.distanceTo(point as Vector3);
  }

  /** Brings views and panners in line with the store, whatever changed. */
  private relocateOrbs(): void {
    const stage = this.stage;
    if (stage === null) return;
    const position = this.eventScratch;
    for (const id of this.orbs.liveIds([])) {
      if (this.store.find(id) === undefined) {
        this.orbs.dissolve(id);
        this.music.audio.releaseOrb(id);
      }
    }
    for (const orb of this.store.orbs) {
      // Hands and flights own their orbs until they let go.
      if (this.isHeld(orb.id) || this.orbs.isFlying(orb.id)) continue;
      const hit = this.placeOf(orb, stage, position);
      // The same song turns into a different band in a different room.
      if (hit !== null) this.store.setRoomBand(orb.id, SURFACE_BAND[hit.kind]);
      if (this.orbs.has(orb.id)) {
        this.orbs.setBand(orb.id, orb.band);
        this.orbs.moveTo(orb.id, position);
      } else {
        this.orbs.spawn(orb.id, orb.band, position);
      }
      this.orbs.stick(
        orb.id,
        hit === null ? null : hit.normal,
        hit === null ? 1 : this.orbSizeAt(hit.point),
      );
      this.music.audio.setOrbPosition(orb.id, position);
    }
  }

  private onOrbLanded(id: number): void {
    const orb = this.store.find(id);
    const landing = this.landings.get(id);
    this.landings.delete(id);
    if (orb === undefined || landing === undefined) return;
    const { point, normal } = landing;
    const color = this.palette.instruments[orb.band];
    this.orbs.stick(id, normal, this.orbSizeAt(point));
    this.scratch.set(point.x, point.y, point.z);
    this.orbs.moveTo(
      id,
      this.scratch.addScaledVector(normal as Vector3, SURFACE_OFFSET),
    );
    this.particles.burst(point.x, point.y, point.z, color, {
      count: 26,
      speed: 0.6,
      size: 0.016,
      life: 0.8,
    });
    this.room.pulse(color, 1, point);
    this.orbs.pulse(id);
    this.music.sound(orb);
    if (this.mode === 'tutorial') this.tutorial.flow.orbThrown();
    this.checkChallenge();
    if (this.stage !== null) this.pinSong(this.stage);
  }

  private applyPalette(): void {
    this.palette = PALETTES[this.store.sceneId];
    this.orbs.setPalette(this.palette);
    this.beam.setColor(this.palette.beam);
    this.ring.setPalette(this.palette);
    this.backdrop.setPalette(this.palette);
    this.room.setBeamColor(this.palette.beam);
    this.veil.setColor(this.palette.skyBottom);
    this.menu.setAccent(this.palette);
    this.tutorial.setPalette(this.palette);
  }

  private flash(id: number): void {
    if (id === BEAT_FLASH) {
      this.ring.pulse(0.7);
      this.beat = 1;
      return;
    }
    this.orbs.pulse(id);
    const orb = this.store.find(id);
    if (orb === undefined) return;
    if (this.mode === 'tutorial' && this.tutorial.flow.orbSounded()) {
      this.placeOf(orb, this.stage as Stage, this.eventScratch);
      this.tutorial.setOrbSpot(this.eventScratch);
    }
    const color = this.palette.instruments[orb.band];
    const wave = 0.8 + this.concertLevel * 0.9;
    if (orb.spot === undefined) this.room.pulse(color, wave, this.eye);
    if (this.orbs.getPosition(id, this.scratch) !== null) {
      const { x, y, z } = this.scratch;
      if (orb.spot !== undefined) this.room.pulse(color, wave, this.scratch);
      if (this.music.inConcert) {
        // The melody draws itself in the air, from each note to the next.
        if (this.hasLastFlash) {
          this.particles.comet(this.lastFlash, this.scratch, color, COMET_LIFE);
        }
        this.lastFlash.copy(this.scratch);
        this.hasLastFlash = true;
      }
      this.particles.burst(x, y, z, this.palette.instruments[orb.band], {
        count: 6,
        speed: 0.16,
        size: 0.008,
        life: 0.55,
      });
    }
  }

  private isHeld(id: number): boolean {
    return this.grabs[0].held === id || this.grabs[1].held === id;
  }

  private readPinches(dt: number): void {
    const { left, right } = this.hands;
    for (let index = 0; index < 2; index++) {
      const hand = index === 0 ? left : right;
      const pinch = this.pinches[index];
      const edges = hand.kind === 'controller'
        ? pinch.updateButton(hand.triggerPressed, dt)
        : pinch.update(hand.pinchGap, dt);
      this.edges[index] = edges;
      this.pinchStarts[index] = edges.started;
      this.tips[index] = hand.tracked ? hand.pokeTip : null;
    }
  }

  private updateMode(dt: number, time: number): void {
    const { left, right } = this.hands;
    const headPosition = this.head.position;
    if (this.demo !== null) {
      this.demo.update(dt);
      return;
    }
    if (this.mode === 'home') {
      this.home.update(this.tips, this.pinchPoints, this.pinchStarts, headPosition, dt);
      // Keeps fading out a menu that was just used to come here.
      this.menu.update(headPosition, this.head, null, dt);
      this.updateHand(left, 0, false, dt, time);
      this.updateHand(right, 1, false, dt, time);
      return;
    }
    this.home.update(this.tips, this.pinchPoints, this.pinchStarts, headPosition, dt);
    this.updateMenu(dt);
    let leftFree = !this.menu.isOpen;
    let rightFree = !this.menu.fingerNear;
    if (this.mode === 'tutorial') {
      this.tutorial.update(this.tips, this.pinchPoints, this.pinchStarts, headPosition, dt);
      if (this.mode !== 'tutorial') return;
      leftFree = leftFree && !this.tutorial.isNearSkip(left.pinchPoint);
      rightFree = rightFree && !this.tutorial.isNearSkip(right.pinchPoint);
    }
    this.updateHand(left, 0, leftFree, dt, time);
    this.updateHand(right, 1, rightFree, dt, time);
  }

  private updateMenu(dt: number): void {
    const { left, right } = this.hands;
    const head = this.head.position;
    let open = false;
    let anchor: Vec3Like = left.pinchPoint;
    if (left.kind === 'hand') {
      const pinching = this.pinches[0].isActive;
      open = this.palm.update(left.joints, 'left', head, pinching, dt);
      anchor = left.joints.middleMeta;
    } else {
      this.palm.update(null, 'left', head, false, dt);
      if (left.kind === 'controller') {
        if (left.menuPressed && !this.menuButtonWasDown) {
          this.controllerMenuOpen = !this.controllerMenuOpen;
        }
        open = this.controllerMenuOpen;
      }
    }
    this.menuButtonWasDown = left.menuPressed;
    this.menu.setOpen(open, anchor, this.head);
    this.menu.update(anchor, this.head, right.tracked ? right.pokeTip : null, dt);
    // Not an edge: the menu may already be open when step three begins.
    if (open && this.mode === 'tutorial' && this.tutorial.flow.menuOpened()) {
      this.finishTutorial(true);
    }
  }

  private onMenuAction(action: MenuAction): void {
    const { audio } = this.music;
    audio.ui('tick');
    switch (action) {
      case 'slower':
        this.store.setBpm(this.store.bpm - BPM_STEP);
        break;
      case 'faster':
        this.store.setBpm(this.store.bpm + BPM_STEP);
        break;
      case 'playPause':
        this.music.setPaused(!this.music.paused);
        this.menu.setPaused(this.music.paused);
        break;
      case 'undo':
        if (!this.store.undo()) audio.ui('error');
        break;
      case 'rotate':
        audio.ui(this.store.rotateRing(RING_TURN_STEPS) ? 'whoosh' : 'error');
        break;
      case 'scene':
        this.store.setScene(this.store.sceneId + 1);
        this.say(this.palette.name);
        break;
      case 'clear':
        if (this.store.orbs.length > 0) {
          this.store.clear();
          audio.ui('whoosh');
          this.say(t('cleared'));
        }
        break;
      case 'backdrop':
        this.setBackdrop(!this.backdrop.enabled);
        break;
      case 'save':
        if (this.store.orbs.length === 0) {
          audio.ui('error');
        } else {
          this.saveCurrent();
          audio.ui('confirm');
          this.say(t('saved'));
        }
        break;
      case 'home':
        this.goHome();
        break;
    }
  }

  /** Switches between the real room and the starfield, instantly. */
  private setBackdrop(starfield: boolean): void {
    this.backdrop.enabled = starfield;
    this.room.object.visible = !starfield;
    this.menu.setBackdrop(starfield);
  }

  // DemoHost --------------------------------------------------------------

  addOrb(slot: Slot): void {
    this.store.add(slot);
    this.relocateOrbs();
  }

  clearAll(): void {
    this.store.load({ ...emptyComposition(), sceneId: this.store.sceneId });
  }

  menuAction(action: MenuAction): void {
    this.onMenuAction(action);
  }

  setConcert(on: boolean): void {
    this.demoConcert = on;
  }

  setStarfield(on: boolean): void {
    this.setBackdrop(on || !this.inSession);
  }

  orbAt(slot: Slot): number {
    const orb = this.store.orbs.find(
      (other) =>
        other.step === slot.step && other.degree === slot.degree &&
        other.band === slot.band,
    );
    return orb?.id ?? -1;
  }

  setCamera(position: Vector3, target: Vector3): void {
    const { camera } = this.world;
    const device = emulator();
    if (device !== null && this.inSession) {
      this.lookScratch.lookAt(position, target, camera.up);
      this.lookQuaternion.setFromRotationMatrix(this.lookScratch);
      const q = this.lookQuaternion;
      device.position.set(position.x, position.y, position.z);
      device.quaternion.set(q.x, q.y, q.z, q.w);
    } else {
      camera.position.copy(position);
      camera.lookAt(target);
    }
  }

  private say(text: string): void {
    const near = this.menu.isOpen ? this.menu.object.position : null;
    this.toast.show(text, this.head, near);
  }

  private updateHand(
    hand: HandState,
    index: number,
    enabled: boolean,
    dt: number,
    time: number,
  ): void {
    // A hand holding something, or busy with UI, is not pointing at the room.
    const pointing = enabled && hand.hasRay && this.grabs[index].held < 0;
    const candidate = pointing
      ? this.orbs.nearestInCone(
        hand.rayOrigin,
        hand.rayDirection,
        FAR_AIM_COSINE,
        FAR_MIN_DISTANCE,
      )
      : -1;
    this.aimed[index] = this.aims[index].update(candidate, dt);
    this.grabs[index].update(
      hand.tracked ? hand.pinchPoint : null,
      this.edges[index],
      enabled,
      time,
      dt,
      hand.tracked ? hand.steadyPoint : null,
    );
  }

  /** Shows which far orb a pinch would call back, while a hand points at it. */
  private updateTethers(): void {
    for (let index = 0; index < 2; index++) {
      const id = this.hoverIds[index];
      const hand = index === 0 ? this.hands.left : this.hands.right;
      const target = id >= 0 && this.orbs.isStuck(id)
        ? this.orbs.getPosition(id, this.tetherScratch)
        : null;
      if (target === null) {
        this.tethers[index].hide();
      } else {
        const color = this.palette.instruments[this.store.find(id)?.band ?? 0];
        this.tethers[index].show(hand.pinchPoint, target, color);
      }
    }
  }

  private pulseHaptics(hand: number, strength: number, ms: number): void {
    const state = hand === 0 ? this.hands.left : this.hands.right;
    const actuator = state.gamepad?.hapticActuators?.[0];
    actuator?.pulse(strength, ms)?.catch?.(() => undefined);
  }

  // OrbHost ---------------------------------------------------------------

  pick(point: Vec3Like, radius: number): number {
    return this.orbs.nearest(point, radius);
  }

  pickFar(hand: number): number {
    return this.aimed[hand];
  }

  recall(id: number): void {
    this.orbs.stick(id, null);
    this.reeling.add(id);
    this.music.audio.ui('whoosh');
  }

  create(point: Vec3Like): number {
    const stage = this.stage;
    if (stage === null || !canCreateAt(point, stage)) return -1;
    const spot = clampToStage(this.scratch.copy(point as Vector3), stage);
    const orb = this.store.add(positionToSlot(spot, stage, this.dropSlot));
    if (orb === null) {
      this.music.audio.ui('error');
      return -1;
    }
    this.orbs.spawn(orb.id, orb.band, spot);
    this.freshOrbs.add(orb.id);
    this.music.audio.ui('pop');
    return orb.id;
  }

  beginDrag(id: number): void {
    this.orbs.setHeld(id, true);
    this.dragSlot.step = -1;
    this.dragStartDegree = this.store.find(id)?.degree ?? 0;
    this.pulseHaptics(this.grabs[0].held === id ? 0 : 1, 0.5, 20);
  }

  drag(id: number, point: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    const at = clampToStage(this.scratch.copy(point as Vector3), stage);
    if (this.reeling.has(id)) {
      this.orbs.moveTo(id, at);
      const orb = this.orbs.getPosition(id, this.tetherScratch);
      if (orb === null || orb.distanceTo(at) < RECALL_DONE_DISTANCE) {
        this.reeling.delete(id);
      }
    } else {
      this.orbs.place(id, at);
    }
    this.orbs.setFade(id, dropZoneAmount(at, stage));
    const slot = positionToSlot(at, stage, this.dropSlot);
    this.orbs.setBand(id, slot.band);
    const moved = slot.degree !== this.dragSlot.degree ||
      slot.band !== this.dragSlot.band;
    if (moved && this.dragSlot.step >= 0) this.music.preview(slot);
    this.dragSlot.step = slot.step;
    this.dragSlot.degree = slot.degree;
    this.dragSlot.band = slot.band;
  }

  drop(id: number, point: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    this.reeling.delete(id);
    this.orbs.setHeld(id, false);
    this.orbs.setFade(id, 0);
    const at = clampToStage(this.scratch.copy(point as Vector3), stage);
    if (dropZoneAmount(at, stage) >= 1) {
      // Let go over the lap: the orb is gone, and undo can bring it back.
      this.freshOrbs.delete(id);
      this.store.remove(id);
      this.music.audio.ui('pop');
      return;
    }
    const slot = positionToSlot(at, stage, this.dropSlot);
    const isNew = this.freshOrbs.delete(id);
    const orb = this.store.move(id, slot, !isNew);
    if (orb === null) return;
    if (this.mode === 'tutorial' && !isNew && orb.degree > this.dragStartDegree) {
      this.tutorial.flow.orbRaised();
    }
    this.orbs.setBand(id, orb.band);
    this.orbs.stick(id, null);
    this.orbs.moveTo(id, slotToPosition(orb, stage, this.scratch));
    this.orbs.pulse(id);
    this.music.sound(orb);
  }

  fling(id: number, velocity: Vec3Like): void {
    const stage = this.stage;
    if (stage === null) return;
    const start = this.orbs.getPosition(id, this.scratch);
    if (start === null) return;
    this.reeling.delete(id);
    this.orbs.setFade(id, 0);
    const { surfaces } = this.room;
    const aimed = assistAim(velocity, this.head.forward);
    const plan = planThrow(start, aimed, surfaces, this.eye, stage.floorY);
    const landing = snapToStep(plan.hit, stage, surfaces);
    const isNew = this.freshOrbs.delete(id);
    const orb = this.store.move(
      id,
      roomSlot(landing, stage),
      !isNew,
      toSpot(landing.point, this.songStage ?? stage),
    );
    if (orb === null) return;
    this.landings.set(id, landing);
    this.orbs.setBand(id, orb.band);
    this.orbs.launch(id, plan);
    this.music.audio.ui('whoosh');
  }

  setHover(hand: number, id: number): void {
    const previous = this.hoverIds[hand];
    this.hoverIds[hand] = id;
    if (previous >= 0 && !this.hoverIds.includes(previous)) {
      this.orbs.setHover(previous, false);
    }
    if (id >= 0) this.orbs.setHover(id, true);
  }
}
