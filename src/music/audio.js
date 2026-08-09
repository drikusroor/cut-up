// Web Audio playback. Everything is synthesised on the fly — no samples, so
// the whole app stays a handful of text files.

import { arrange } from './arrange.js';
import { stepTime } from './rhythm.js';

/** How far ahead of the clock notes are handed to the audio thread. */
const LOOKAHEAD = 1.5;
/** How often we top that window up. */
const PUMP_MS = 60;

/**
 * A tempo we can actually divide by. An empty BPM box reads back as 0, which
 * makes every note infinitely long — in other words, silence — so anything that
 * is not a positive, finite number falls back rather than poisoning the clock.
 */
export function safeTempo(value, fallback = 100) {
  const tempo = Number(value);
  return Number.isFinite(tempo) && tempo > 0 ? tempo : fallback;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.playing = false;
    this.loopHandle = null;
    this.startTime = 0;
    this.loopSeconds = 0;
    this.secondsPerStep = 0;
    this.voices = [];
  }

  /** Browsers only allow this after a user gesture, so call it from a click. */
  ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.85;
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10;
      limiter.ratio.value = 12;
      this.master.connect(limiter).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  get currentStep() {
    if (!this.playing || !this.ctx || !this.secondsPerStep) return -1;
    const elapsed = this.ctx.currentTime - this.startTime;
    if (elapsed < 0) return -1;
    return Math.floor((elapsed % this.loopSeconds) / this.secondsPerStep);
  }

  stop() {
    this.playing = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    for (const voice of this.voices) {
      try {
        voice.node.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.voices = [];
  }

  /**
   * Holds on to a scheduled voice so stop() can silence it, and forgets it once
   * it has rung out — otherwise a long session accumulates every note it ever
   * played.
   */
  keep(node, until) {
    this.voices.push({ node, until });
  }

  forgetSpentVoices() {
    if (this.voices.length < 64) return;
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((voice) => voice.until > now);
  }

  /**
   * Plays a song, optionally looping.
   *
   * @param {object} song
   * @param {number} song.tempo
   * @param {number} [song.swing]
   * @param {number[][]} [song.chordVoicings]
   * @param {number} [song.stepsPerChord]
   * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.melody]
   * @param {{tracks: Array<{id:string, pattern:boolean[], velocities:number[]}>}} [song.rhythm]
   * @param {number} [song.totalSteps]
   * @param {boolean} [song.loop]
   * @param {{chords?:boolean, melody?:boolean, drums?:boolean}} [song.parts]
   */
  play(song) {
    this.stop();
    const ctx = this.ensure();

    const {
      swing = 0,
      loop = true,
      parts = { chords: true, melody: true, drums: true },
    } = song;
    const tempo = safeTempo(song.tempo);

    // Shorter parts repeat to fill the loop — see arrange().
    const { totalSteps, chords, melody, drums } = arrange(song);
    const secondsPerStep = 60 / tempo / 4;

    this.secondsPerStep = secondsPerStep;
    // A zero-length loop would leave the scheduler below spinning on the spot.
    this.loopSeconds = Math.max(totalSteps, 1) * secondsPerStep;

    // One pass of the song, flattened into things to do at an offset from its
    // start. A section-by-section arrangement can be hundreds of bars long, so
    // this is built once and then fed to the audio thread a window at a time —
    // handing over the whole song at once locks the tab up for seconds.
    const events = [];
    if (parts.chords) {
      for (const chord of chords) {
        const duration = chord.length * secondsPerStep * 0.96;
        chord.voicing.forEach((midi, voice) => {
          // Tiny spread so the chord sounds strummed rather than stamped.
          events.push({
            at: chord.step * secondsPerStep + voice * 0.012,
            play: (time) => this.pad(midi, time, duration, 0.16),
          });
        });
      }
    }
    if (parts.melody) {
      for (const note of melody) {
        const duration = Math.max(0.08, note.length * secondsPerStep * 0.92);
        const gain = ((note.velocity ?? 96) / 127) * 0.28;
        events.push({
          at: stepTime(note.step, secondsPerStep, swing),
          play: (time) => this.lead(note.midi, time, duration, gain),
        });
      }
    }
    if (parts.drums) {
      for (const hit of drums) {
        const gain = (hit.velocity / 127) * 0.7;
        events.push({
          at: stepTime(hit.step, secondsPerStep, swing),
          play: (time) => this.drum(hit.id, time, gain),
        });
      }
    }
    events.sort((a, b) => a.at - b.at);

    this.startTime = ctx.currentTime + 0.08;
    this.playing = true;

    let pass = 0;
    let cursor = 0;

    const pump = () => {
      if (!this.playing) return;
      const horizon = ctx.currentTime + LOOKAHEAD;

      while (events.length) {
        if (cursor >= events.length) {
          if (!loop) break;
          pass += 1;
          cursor = 0;
        }
        const event = events[cursor];
        const time = this.startTime + pass * this.loopSeconds + event.at;
        if (time > horizon) break;
        event.play(time);
        cursor += 1;
      }

      this.forgetSpentVoices();

      const done = !loop && cursor >= events.length;
      if (done && ctx.currentTime > this.startTime + this.loopSeconds) {
        this.playing = false;
        return;
      }
      this.loopHandle = setTimeout(pump, PUMP_MS);
    };

    pump();
  }

  /** Warm sustained voice for chords. */
  pad(midi, time, duration, gain = 0.15) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, time);
    out.gain.linearRampToValueAtTime(gain, time + 0.04);
    out.gain.setTargetAtTime(gain * 0.7, time + 0.05, 0.4);
    out.gain.setTargetAtTime(0.0001, time + duration, 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, time);
    filter.Q.value = 0.5;

    for (const [type, detune, level] of [['triangle', -4, 1], ['sine', 5, 0.7]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(midi);
      osc.detune.value = detune;
      const level_ = ctx.createGain();
      level_.gain.value = level;
      osc.connect(level_).connect(filter);
      osc.start(time);
      osc.stop(time + duration + 0.6);
      this.keep(osc, time + duration + 0.6);
    }

    filter.connect(out).connect(this.master);
  }

  /** Brighter voice for the melody line. */
  lead(midi, time, duration, gain = 0.2) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = mtof(midi);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600, time);
    filter.frequency.setTargetAtTime(1100, time + 0.02, 0.25);
    filter.Q.value = 3;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(gain, time + 0.012);
    env.gain.setTargetAtTime(gain * 0.6, time + 0.03, 0.15);
    env.gain.setTargetAtTime(0.0001, time + duration, 0.06);

    osc.connect(filter).connect(env).connect(this.master);
    osc.start(time);
    osc.stop(time + duration + 0.4);
    this.keep(osc, time + duration + 0.4);
  }

  /** Synthesised kit pieces. */
  drum(id, time, gain = 0.6) {
    const ctx = this.ctx;
    if (id === 'kick') {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.frequency.setValueAtTime(140, time);
      osc.frequency.exponentialRampToValueAtTime(45, time + 0.09);
      env.gain.setValueAtTime(gain, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
      osc.connect(env).connect(this.master);
      osc.start(time);
      osc.stop(time + 0.35);
      this.keep(osc, time + 0.35);
      return;
    }

    if (id === 'tom' || id === 'rim') {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const base = id === 'tom' ? 220 : 900;
      osc.type = id === 'tom' ? 'sine' : 'square';
      osc.frequency.setValueAtTime(base, time);
      osc.frequency.exponentialRampToValueAtTime(base * 0.55, time + 0.12);
      env.gain.setValueAtTime(gain * (id === 'rim' ? 0.4 : 0.8), time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + (id === 'rim' ? 0.06 : 0.28));
      osc.connect(env).connect(this.master);
      osc.start(time);
      osc.stop(time + 0.3);
      this.keep(osc, time + 0.3);
      return;
    }

    // Everything else is shaped noise.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    let stopAt;

    if (id === 'hat' || id === 'openhat') {
      filter.type = 'highpass';
      filter.frequency.value = 7000;
      const decay = id === 'hat' ? 0.045 : 0.28;
      env.gain.setValueAtTime(gain * 0.35, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + decay);
      stopAt = time + decay + 0.05;
    } else {
      // Snare and clap: band-passed noise, snare with a bit of body under it.
      filter.type = 'bandpass';
      filter.frequency.value = id === 'clap' ? 1400 : 1900;
      filter.Q.value = id === 'clap' ? 1.6 : 0.9;
      env.gain.setValueAtTime(gain * 0.6, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + 0.19);
      stopAt = time + 0.25;

      if (id === 'snare') {
        const body = ctx.createOscillator();
        const bodyEnv = ctx.createGain();
        body.frequency.setValueAtTime(190, time);
        bodyEnv.gain.setValueAtTime(gain * 0.25, time);
        bodyEnv.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
        body.connect(bodyEnv).connect(this.master);
        body.start(time);
        body.stop(time + 0.15);
        this.keep(body, time + 0.15);
      }
    }

    noise.connect(filter).connect(env).connect(this.master);
    // stop() must come after start(), or the node throws.
    noise.start(time);
    noise.stop(stopAt);
    this.keep(noise, stopAt);
  }

  noiseBuffer() {
    if (!this._noise) {
      const ctx = this.ctx;
      const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buffer;
    }
    return this._noise;
  }

  /** One-off chord preview, used when you click a chord card. */
  strum(voicing) {
    this.ensure();
    const time = this.ctx.currentTime + 0.02;
    voicing.forEach((midi, i) => this.pad(midi, time + i * 0.02, 1.1, 0.18));
  }

  /** Short blip, so dragging a note in the piano roll tells you where you are. */
  preview(midi) {
    this.ensure();
    this.lead(midi, this.ctx.currentTime + 0.01, 0.18, 0.16);
  }
}

export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
