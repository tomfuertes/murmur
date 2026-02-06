import * as Tone from "tone";
import type { VibeState } from "../types";
import { getScaleNotes, getChordNotes, createSeededRandom } from "./scales";

const RAMP_TIME = 3; // seconds — smooth parameter transitions

export class SoundscapeEngine {
  private started = false;
  private currentState: VibeState | null = null;
  private random: (() => number) | null = null;

  // Synths
  private pad: Tone.PolySynth | null = null;
  private pluck: Tone.PolySynth | null = null;
  private bass: Tone.MonoSynth | null = null;
  private bells: Tone.PolySynth | null = null;
  private noise: Tone.NoiseSynth | null = null;

  // Effects
  private reverb: Tone.Reverb | null = null;
  private delay: Tone.FeedbackDelay | null = null;
  private filter: Tone.Filter | null = null;

  // Channels per instrument (for volume control)
  private padChannel: Tone.Channel | null = null;
  private pluckChannel: Tone.Channel | null = null;
  private bassChannel: Tone.Channel | null = null;
  private bellsChannel: Tone.Channel | null = null;
  private noiseChannel: Tone.Channel | null = null;

  // Loops
  private padLoop: Tone.Loop | null = null;
  private pluckLoop: Tone.Loop | null = null;
  private bassLoop: Tone.Loop | null = null;
  private bellsLoop: Tone.Loop | null = null;
  private noiseLoop: Tone.Loop | null = null;

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.initEffects();
    this.initSynths();
    this.started = true;
  }

  private initEffects() {
    this.reverb = new Tone.Reverb({ decay: 6, wet: 0.3 }).toDestination();
    this.delay = new Tone.FeedbackDelay({
      delayTime: "8n",
      feedback: 0.3,
      wet: 0.2,
    }).connect(this.reverb);
    this.filter = new Tone.Filter({
      frequency: 4000,
      type: "lowpass",
      rolloff: -12,
    }).connect(this.delay);
  }

  private initSynths() {
    // Pad — warm sustained chords
    this.padChannel = new Tone.Channel({ volume: -6 }).connect(this.filter!);
    this.pad = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 2, decay: 1, sustain: 0.8, release: 4 },
    }).connect(this.padChannel);

    // Pluck — arpeggiated notes
    this.pluckChannel = new Tone.Channel({ volume: -10 }).connect(this.filter!);
    this.pluck = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 1.5 },
    }).connect(this.pluckChannel);

    // Bass — low foundation
    this.bassChannel = new Tone.Channel({ volume: -8 }).connect(this.filter!);
    this.bass = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.1, decay: 0.4, sustain: 0.6, release: 2 },
      filterEnvelope: {
        attack: 0.06,
        decay: 0.2,
        sustain: 0.5,
        release: 2,
        baseFrequency: 100,
        octaves: 2,
      },
    }).connect(this.bassChannel);

    // Bells — high sparkly accents
    this.bellsChannel = new Tone.Channel({ volume: -14 }).connect(this.filter!);
    this.bells = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 2 },
    }).connect(this.bellsChannel);

    // Noise — textural percussion
    this.noiseChannel = new Tone.Channel({ volume: -20 }).connect(this.filter!);
    this.noise = new Tone.NoiseSynth({
      noise: { type: "pink" },
      envelope: { attack: 0.5, decay: 0.3, sustain: 0, release: 1 },
    }).connect(this.noiseChannel);
  }

  applyState(state: VibeState) {
    if (!this.started) return;

    const prev = this.currentState;
    this.currentState = state;

    // If seed changed, rebuild the random generator
    if (!prev || prev.seed !== state.seed) {
      this.random = createSeededRandom(state.seed);
    }

    // Tempo
    Tone.getTransport().bpm.rampTo(state.tempo, RAMP_TIME);

    // Effects
    this.reverb?.set({ wet: state.reverbMix });
    this.delay?.set({ wet: state.delayMix });
    this.filter?.frequency.rampTo(state.filterCutoff, RAMP_TIME);

    // Instrument volumes based on active instruments + brightness/density
    const active = new Set(state.instruments);

    this.padChannel?.volume.rampTo(active.has("pad") ? -6 + (state.brightness - 0.5) * 6 : -Infinity, RAMP_TIME);
    this.pluckChannel?.volume.rampTo(active.has("pluck") ? -10 + state.density * 4 : -Infinity, RAMP_TIME);
    this.bassChannel?.volume.rampTo(active.has("bass") ? -8 : -Infinity, RAMP_TIME);
    this.bellsChannel?.volume.rampTo(active.has("bells") ? -14 + state.brightness * 6 : -Infinity, RAMP_TIME);
    this.noiseChannel?.volume.rampTo(active.has("noise") ? -20 + state.density * 4 : -Infinity, RAMP_TIME);

    // Rebuild loops if key/mode changed or first apply
    if (!prev || prev.key !== state.key || prev.mode !== state.mode || prev.density !== state.density) {
      this.rebuildLoops(state);
    }

    // Start transport if not running
    if (Tone.getTransport().state !== "started") {
      Tone.getTransport().start();
    }
  }

  private rebuildLoops(state: VibeState) {
    // Clear existing loops
    this.padLoop?.dispose();
    this.pluckLoop?.dispose();
    this.bassLoop?.dispose();
    this.bellsLoop?.dispose();
    this.noiseLoop?.dispose();

    const scaleNotes = getScaleNotes(state.key, state.mode);
    const chordNotes = getChordNotes(state.key, state.mode, 4);
    const bassNotes = getScaleNotes(state.key, state.mode).filter(
      (n) => parseInt(n.slice(-1)) <= 3
    );
    const highNotes = scaleNotes.filter(
      (n) => parseInt(n.slice(-1)) >= 5
    );

    const rand = this.random!;

    // Pad: play chords every 2 bars
    this.padLoop = new Tone.Loop((time) => {
      this.pad?.triggerAttackRelease(chordNotes, "2n", time, 0.3);
    }, "2m");
    this.padLoop.start(0);

    // Pluck: arpeggiate based on density
    const pluckInterval = state.density > 0.5 ? "8n" : "4n";
    this.pluckLoop = new Tone.Loop((time) => {
      if (rand() < state.density) {
        const note = scaleNotes[Math.floor(rand() * scaleNotes.length)];
        this.pluck?.triggerAttackRelease(note, "16n", time, 0.2 + rand() * 0.3);
      }
    }, pluckInterval);
    this.pluckLoop.start(0);

    // Bass: root notes on the beat
    this.bassLoop = new Tone.Loop((time) => {
      if (bassNotes.length > 0) {
        const note = bassNotes[Math.floor(rand() * bassNotes.length)];
        this.bass?.triggerAttackRelease(note, "2n", time, 0.5);
      }
    }, "1m");
    this.bassLoop.start(0);

    // Bells: sparse high accents
    this.bellsLoop = new Tone.Loop((time) => {
      if (rand() < state.density * 0.5 && highNotes.length > 0) {
        const note = highNotes[Math.floor(rand() * highNotes.length)];
        this.bells?.triggerAttackRelease(note, "32n", time, 0.15 + rand() * 0.2);
      }
    }, "4n");
    this.bellsLoop.start(0);

    // Noise: textural hits
    this.noiseLoop = new Tone.Loop((time) => {
      if (rand() < state.density * 0.3) {
        this.noise?.triggerAttackRelease("8n", time, 0.1);
      }
    }, "2n");
    this.noiseLoop.start(0);
  }

  stop() {
    Tone.getTransport().stop();
    this.padLoop?.stop();
    this.pluckLoop?.stop();
    this.bassLoop?.stop();
    this.bellsLoop?.stop();
    this.noiseLoop?.stop();
  }

  dispose() {
    this.stop();
    this.pad?.dispose();
    this.pluck?.dispose();
    this.bass?.dispose();
    this.bells?.dispose();
    this.noise?.dispose();
    this.padChannel?.dispose();
    this.pluckChannel?.dispose();
    this.bassChannel?.dispose();
    this.bellsChannel?.dispose();
    this.noiseChannel?.dispose();
    this.reverb?.dispose();
    this.delay?.dispose();
    this.filter?.dispose();
    this.padLoop?.dispose();
    this.pluckLoop?.dispose();
    this.bassLoop?.dispose();
    this.bellsLoop?.dispose();
    this.noiseLoop?.dispose();
    this.started = false;
    this.currentState = null;
  }

  get isStarted() {
    return this.started;
  }
}
