/**
 * Web Audio engine. All sound is synthesized here: there are no samples.
 *
 * Signal path:
 *   voice -> orb panner (HRTF) -> dry bus ---------------> compressor -> out
 *                               \-> reverb (generated IR) /
 *                               \-> tempo-synced delay ---/
 */

import { Vec3Like } from '../sequencer/mapping';
import { midiToFrequency } from './scale';

const REVERB_SECONDS = 2.2;
const PANNER_RELEASE_SECONDS = 4;
/** Upper bound of simultaneously sounding voices; extra notes are skipped. */
const MAX_VOICES = 28;

export type UiSound = 'tick' | 'confirm' | 'error' | 'pop' | 'whoosh';

interface NoteRequest {
  midi: number;
  band: number;
  time: number;
  /** Seconds in one step, so note lengths follow the tempo. */
  stepDuration: number;
  velocity: number;
  /** Panner to play through; null plays dead centre. */
  panner: PannerNode | null;
}

type AudioContextClass = typeof AudioContext;

function contextClass(): AudioContextClass | undefined {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextClass;
    webkitAudioContext?: AudioContextClass;
  };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private dry: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private delaySend: GainNode | null = null;
  private delay: DelayNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly panners = new Map<number, PannerNode>();
  private activeVoices = 0;
  private wantsRunning = true;

  get context(): AudioContext | null {
    return this.ctx;
  }

  get currentTime(): number {
    return this.ctx?.currentTime ?? 0;
  }

  /** Output latency, used to line visuals up with what is actually heard. */
  get latency(): number {
    return this.ctx === null
      ? 0
      : (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
  }

  get isRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /**
   * Must first run from a user gesture: browsers keep audio suspended until
   * then. Safe to call any number of times.
   */
  unlock(): void {
    this.wantsRunning = true;
    if (this.ctx === null) this.build();
    if (this.ctx !== null && this.ctx.state !== 'running') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  /** Pauses the whole audio graph, freezing the audio clock with it. */
  suspend(): void {
    this.wantsRunning = false;
    if (this.ctx?.state === 'running') {
      this.ctx.suspend().catch(() => undefined);
    }
  }

  resume(): void {
    this.wantsRunning = true;
    if (this.ctx !== null && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => undefined);
    }
  }

  setDelayTime(seconds: number): void {
    if (this.delay === null || this.ctx === null) return;
    this.delay.delayTime.setTargetAtTime(
      Math.min(1.9, seconds),
      this.ctx.currentTime,
      0.05,
    );
  }

  setListener(position: Vec3Like, forward: Vec3Like, up: Vec3Like): void {
    if (this.ctx === null) return;
    const { listener } = this.ctx;
    if (listener.positionX !== undefined) {
      listener.positionX.value = position.x;
      listener.positionY.value = position.y;
      listener.positionZ.value = position.z;
      listener.forwardX.value = forward.x;
      listener.forwardY.value = forward.y;
      listener.forwardZ.value = forward.z;
      listener.upX.value = up.x;
      listener.upY.value = up.y;
      listener.upZ.value = up.z;
    } else {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(
        forward.x,
        forward.y,
        forward.z,
        up.x,
        up.y,
        up.z,
      );
    }
  }

  /** Creates or moves the spatial source that belongs to an orb. */
  setOrbPosition(id: number, position: Vec3Like): void {
    const panner = this.pannerFor(id);
    if (panner === null) return;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
  }

  /** Frees an orb's panner once its last notes have rung out. */
  releaseOrb(id: number): void {
    const panner = this.panners.get(id);
    if (panner === undefined) return;
    this.panners.delete(id);
    setTimeout(() => panner.disconnect(), PANNER_RELEASE_SECONDS * 1000);
  }

  playOrb(
    id: number,
    midi: number,
    band: number,
    time: number,
    stepDuration: number,
    velocity: number,
  ): void {
    this.play({
      midi,
      band,
      time,
      stepDuration,
      velocity,
      panner: this.pannerFor(id),
    });
  }

  /** Plays a note with no orb behind it, as in the menu chords. */
  playCentered(midi: number, band: number, velocity: number): void {
    if (this.ctx === null) return;
    this.play({
      midi,
      band,
      time: this.ctx.currentTime + 0.01,
      stepDuration: 0.35,
      velocity,
      panner: null,
    });
  }

  ui(sound: UiSound): void {
    const ctx = this.ctx;
    if (ctx === null || this.dry === null) return;
    const t = ctx.currentTime + 0.005;
    switch (sound) {
      case 'tick':
        this.blip(t, 1320, 1320, 0.05, 0.06, 'sine');
        break;
      case 'confirm':
        this.blip(t, 880, 880, 0.09, 0.07, 'sine');
        this.blip(t + 0.07, 1320, 1320, 0.14, 0.07, 'sine');
        break;
      case 'error':
        this.blip(t, 240, 180, 0.12, 0.08, 'triangle');
        break;
      case 'pop':
        this.blip(t, 300, 900, 0.08, 0.1, 'sine');
        break;
      case 'whoosh':
        this.noiseSweep(t);
        break;
    }
  }

  /** A quiet blip at a pitch, so a dragged orb can be heard changing. */
  pitchBlip(midi: number): void {
    if (this.ctx === null) return;
    const frequency = midiToFrequency(midi);
    this.blip(this.ctx.currentTime + 0.005, frequency, frequency, 0.07, 0.05, 'sine');
  }

  private build(): void {
    const Context = contextClass();
    if (Context === undefined) return;
    const ctx = new Context({ latencyHint: 'interactive' });
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    compressor.connect(out).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(compressor);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.32;
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(convolver).connect(reverbGain).connect(compressor);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.5;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.34;
    const tone = ctx.createBiquadFilter();
    tone.type = 'bandpass';
    tone.frequency.value = 1400;
    tone.Q.value = 0.4;
    const delayGain = ctx.createGain();
    delayGain.gain.value = 0.3;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(this.delay);
    this.delay.connect(tone).connect(feedback).connect(this.delay);
    tone.connect(delayGain).connect(compressor);
    tone.connect(this.reverbSend);

    this.noise = this.makeNoise(ctx);

    ctx.addEventListener('statechange', () => {
      // Some browsers interrupt the context on their own (for example when
      // the headset sleeps); recover as soon as we still want sound.
      if (ctx.state === 'suspended' && this.wantsRunning) {
        ctx.resume().catch(() => undefined);
      }
    });
  }

  /** Exponentially decaying filtered noise: a soft, wide room. */
  private makeImpulse(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * REVERB_SECONDS);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let low = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const decay = Math.pow(1 - t, 2.6);
        const damp = 0.55 - 0.45 * t;
        low += damp * ((Math.random() * 2 - 1) - low);
        data[i] = low * decay;
      }
    }
    return buffer;
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private pannerFor(id: number): PannerNode | null {
    const existing = this.panners.get(id);
    if (existing !== undefined) return existing;
    const ctx = this.ctx;
    if (ctx === null || this.dry === null) return null;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 0.5;
    panner.rolloffFactor = 0.5;
    this.connectOutputs(panner, 0.2, 0.14);
    this.panners.set(id, panner);
    return panner;
  }

  private connectOutputs(node: AudioNode, reverb: number, delay: number): void {
    const ctx = this.ctx;
    if (
      ctx === null || this.dry === null || this.reverbSend === null ||
      this.delaySend === null
    ) {
      return;
    }
    node.connect(this.dry);
    const reverbTap = ctx.createGain();
    reverbTap.gain.value = reverb;
    node.connect(reverbTap).connect(this.reverbSend);
    const delayTap = ctx.createGain();
    delayTap.gain.value = delay;
    node.connect(delayTap).connect(this.delaySend);
  }

  private play(note: NoteRequest): void {
    if (this.ctx === null || this.dry === null) return;
    if (this.activeVoices >= MAX_VOICES) return;
    const target: AudioNode = note.panner ?? this.dry;
    switch (note.band) {
      case 0:
        this.pluck(note, target);
        break;
      case 1:
        this.pad(note, target);
        break;
      default:
        this.bass(note, target);
        break;
    }
  }

  private trackVoice(lastNode: AudioScheduledSourceNode): void {
    this.activeVoices++;
    lastNode.onended = () => {
      this.activeVoices--;
    };
  }

  /** Bright FM pluck with a quick filter closing. */
  private pluck(note: NoteRequest, target: AudioNode): void {
    const ctx = this.ctx as AudioContext;
    const { time } = note;
    const frequency = midiToFrequency(note.midi);
    const length = 0.95;

    const carrier = ctx.createOscillator();
    carrier.type = 'triangle';
    carrier.frequency.value = frequency;

    const modulator = ctx.createOscillator();
    modulator.frequency.value = frequency * 3;
    const modulation = ctx.createGain();
    modulation.gain.setValueAtTime(frequency * 1.6, time);
    modulation.gain.exponentialRampToValueAtTime(
      frequency * 0.02,
      time + 0.22,
    );
    modulator.connect(modulation).connect(carrier.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(6200, time);
    filter.frequency.exponentialRampToValueAtTime(1100, time + 0.3);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.42 * note.velocity, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + length);

    carrier.connect(filter).connect(amp).connect(target);
    carrier.start(time);
    modulator.start(time);
    carrier.stop(time + length + 0.02);
    modulator.stop(time + length + 0.02);
    this.trackVoice(carrier);
  }

  /** Slow, warm chord tone: detuned saws under a gentle filter sweep. */
  private pad(note: NoteRequest, target: AudioNode): void {
    const ctx = this.ctx as AudioContext;
    const { time } = note;
    const frequency = midiToFrequency(note.midi);
    const attack = 0.14;
    const hold = note.stepDuration * 2.4;
    const release = 1.3;
    const end = time + attack + hold + release;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.5;
    filter.frequency.setValueAtTime(500, time);
    filter.frequency.linearRampToValueAtTime(1700, time + attack + hold * 0.6);
    filter.frequency.linearRampToValueAtTime(420, end);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(0.13 * note.velocity, time + attack);
    amp.gain.setValueAtTime(0.13 * note.velocity, time + attack + hold);
    amp.gain.exponentialRampToValueAtTime(0.0001, end);
    filter.connect(amp).connect(target);

    let last: OscillatorNode | null = null;
    for (const detune of [-7, 7]) {
      const oscillator = ctx.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.detune.value = detune;
      oscillator.connect(filter);
      oscillator.start(time);
      oscillator.stop(end + 0.02);
      last = oscillator;
    }
    const sine = ctx.createOscillator();
    sine.frequency.value = frequency;
    const sineGain = ctx.createGain();
    sineGain.gain.value = 0.9;
    sine.connect(sineGain).connect(filter);
    sine.start(time);
    sine.stop(end + 0.02);
    this.trackVoice(last ?? sine);
  }

  /** Round bass with a soft percussive knock on the attack. */
  private bass(note: NoteRequest, target: AudioNode): void {
    const ctx = this.ctx as AudioContext;
    const { time } = note;
    const frequency = midiToFrequency(note.midi);
    const length = 0.62;

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(frequency * 1.9, time);
    body.frequency.exponentialRampToValueAtTime(frequency, time + 0.05);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1600, time);
    filter.frequency.exponentialRampToValueAtTime(420, time + 0.2);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.6 * note.velocity, time + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
    body.connect(filter).connect(amp).connect(target);
    body.start(time);
    body.stop(time + length + 0.02);
    this.trackVoice(body);

    if (this.noise !== null) {
      const knock = ctx.createBufferSource();
      knock.buffer = this.noise;
      const knockFilter = ctx.createBiquadFilter();
      knockFilter.type = 'bandpass';
      knockFilter.frequency.value = 900;
      knockFilter.Q.value = 0.9;
      const knockAmp = ctx.createGain();
      knockAmp.gain.setValueAtTime(0.12 * note.velocity, time);
      knockAmp.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
      knock.connect(knockFilter).connect(knockAmp).connect(target);
      knock.start(time, Math.random() * 0.8, 0.09);
    }
  }

  private blip(
    time: number,
    from: number,
    to: number,
    length: number,
    level: number,
    type: OscillatorType,
  ): void {
    const ctx = this.ctx as AudioContext;
    const oscillator = ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, time + length);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(level, time + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
    oscillator.connect(amp).connect(this.dry as GainNode);
    oscillator.start(time);
    oscillator.stop(time + length + 0.02);
  }

  private noiseSweep(time: number): void {
    const ctx = this.ctx as AudioContext;
    if (this.noise === null) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(600, time);
    filter.frequency.exponentialRampToValueAtTime(3800, time + 0.3);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.12, time + 0.05);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.34);
    source.connect(filter).connect(amp).connect(this.dry as GainNode);
    source.start(time, 0, 0.4);
  }
}
