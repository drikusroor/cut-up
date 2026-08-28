// The voice builder: everything the app makes a sound with, and nothing about
// when. Playback and offline rendering both stand on this, which is why an
// exported file sounds like what you were listening to rather than like a
// second implementation of it.
//
// There is one voice builder here, and it is driven entirely by the recipes in
// instruments.js: oscillators, an envelope, a filter, optionally a modulator or
// a puff of noise. Adding an instrument means adding data, not code. Drums are
// the same idea with a smaller vocabulary — a table of pieces, and a kit that
// tunes and stretches all of them at once.

import { drumKit } from './instruments.js';
import { defaultHumanize } from './humanize.js';
import { defaultTuning, noteCents } from './tuning.js';

/**
 * How each kit piece is made. `kind` picks the renderer:
 *   tonal  a pitched body with a downward sweep — kicks, toms, congas
 *   noise  filtered noise, with an optional pitched body under it — snare, shaker
 *   clap   three noise bursts in quick succession
 *   metal  six detuned squares through a highpass — the 808 cymbal trick
 *   bell   a couple of squares through a bandpass — cowbell, triangle
 *   wood   a very short click plus a tick of noise — rim, block, clave
 */
const DRUM_VOICES = {
  kick: { kind: 'tonal', type: 'sine', from: 140, to: 45, sweep: 0.09, decay: 0.32, level: 1 },
  tom: { kind: 'tonal', type: 'sine', from: 220, to: 121, sweep: 0.12, decay: 0.28, level: 0.7 },
  conga: { kind: 'tonal', type: 'sine', from: 340, to: 250, sweep: 0.06, decay: 0.18, level: 0.6 },
  snare: { kind: 'noise', band: 1900, q: 0.9, decay: 0.19, level: 0.7, body: 190, bodyLevel: 0.25, bodyDecay: 0.12 },
  shaker: { kind: 'noise', band: 6200, q: 1.2, decay: 0.06, level: 0.34, attack: 0.008 },
  clap: { kind: 'clap', band: 1400, q: 1.6, decay: 0.19, level: 0.75 },
  hat: { kind: 'metal', base: 320, high: 7000, decay: 0.045, level: 0.38 },
  openhat: { kind: 'metal', base: 320, high: 7000, decay: 0.28, level: 0.34 },
  ride: { kind: 'metal', base: 280, high: 5200, decay: 0.9, level: 0.26, ping: 1400 },
  crash: { kind: 'metal', base: 240, high: 3600, decay: 1.6, level: 0.28, noise: 0.5 },
  tamb: { kind: 'metal', base: 520, high: 8200, decay: 0.12, level: 0.28, noise: 0.6 },
  cowbell: { kind: 'bell', partials: [540, 800], band: 2600, decay: 0.32, level: 0.4 },
  triangle: { kind: 'bell', partials: [4200, 5300, 6900], band: 6000, decay: 1.1, level: 0.2, type: 'sine' },
  rim: { kind: 'wood', from: 1700, to: 900, decay: 0.05, level: 0.4, noise: 0.5, band: 2600 },
  woodblock: { kind: 'wood', from: 1200, to: 1050, decay: 0.06, level: 0.4, noise: 0.25, band: 2200 },
  clave: { kind: 'wood', from: 2500, to: 2350, decay: 0.05, level: 0.4, noise: 0.15, band: 3200 },
};

/** The 808's six-oscillator cymbal, as frequency ratios off a base. */
const METAL_RATIOS = [1, 1.4471, 1.6171, 1.9265, 2.5028, 2.6637];

/** How many finished notes may pile up before the engine forgets them. */
const SWEEP_AT = 512;

export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * The bus everything goes through: a little headroom, then a limiter, so a
 * chorus with the whole band in it does not clip.
 *
 * Playback and export share it on purpose — a render that skipped the limiter
 * would come out louder and harder than the thing you approved by ear.
 *
 * @param {BaseAudioContext} ctx
 * @returns {GainNode} what to connect voices to
 */
export function masterChain(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.ratio.value = 12;
  master.connect(limiter).connect(ctx.destination);
  return master;
}

/**
 * One synth: a context, a bus to play into, and the sounds to play with.
 *
 * It knows nothing about songs or transports. The live engine subclasses it
 * and adds a clock; the renderer points one at an OfflineAudioContext and
 * books the whole song into it at once.
 */
export class Synth {
  /**
   * @param {BaseAudioContext} [ctx] the live engine builds its own, later
   * @param {AudioNode} [master] where voices land — see masterChain()
   */
  constructor(ctx = null, master = null) {
    this.ctx = ctx;
    this.master = master;
    // Every source that is scheduled but not yet finished, so stop() can cut it
    // short — see track() for why they do not simply accumulate.
    this.voices = [];
    this.sweepAt = SWEEP_AT;
    // What a one-off preview should sound like. Playback carries its own
    // instruments per note, but a click on a chord card has no note to ask.
    this.instruments = {
      lead: 'saw', harmony: 'pad', bass: 'finger', kit: 'studio',
    };
    // Same for how in tune and how in time it is: a song says so per play, a
    // preview has to be told once and remember.
    this.feel = defaultHumanize();
    this.tuning = defaultTuning();
    this.rootPc = 0;
  }

  /** Keeps previews in step with whatever the panels currently have selected. */
  setInstruments(instruments) {
    this.instruments = { ...this.instruments, ...instruments };
  }

  /** How loose the band is. Only playback uses it — a preview is one note. */
  setFeel(feel) {
    this.feel = feel || defaultHumanize();
  }

  /**
   * The temperament and the detune, plus the key they are measured from. An
   * unequal temperament tunes relative to the tonic, so a preview has to know
   * which key it is previewing.
   */
  setTuning(tuning, rootPc = 0) {
    this.tuning = tuning || defaultTuning();
    this.rootPc = rootPc;
  }

  /**
   * Remembers a source until it has finished, so stop() can cut it short.
   *
   * The "until" is the point of it. A list that is only ever appended to is a
   * leak that grows for as long as the transport runs — a full arrangement is
   * thousands of notes a minute, every one of them holding its whole voice
   * alive behind it — so notes that have already sounded are dropped once
   * there are enough of them to be worth the pass.
   *
   * @param {AudioScheduledSourceNode} source
   * @param {number} until when it stops, in context time
   */
  track(source, until) {
    this.voices.push({ source, until });
    if (this.voices.length > this.sweepAt) this.sweep();
  }

  /** Cuts every voice that is still sounding, and forgets them all. */
  silence() {
    for (const { source } of this.voices) {
      try {
        source.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.voices = [];
    this.sweepAt = SWEEP_AT;
  }

  /** Forgets the notes that have already finished. */
  sweep() {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((voice) => voice.until > now);
    // Whatever is still ringing is the floor for next time, so a dense
    // arrangement does not sweep on every single note it plays.
    this.sweepAt = Math.max(SWEEP_AT, this.voices.length * 2);
  }
  /**
   * Builds one note out of an instrument recipe. Every melodic sound in the app
   * comes through here.
   *
   * @param {object} spec an entry from LEAD_INSTRUMENTS or HARMONY_INSTRUMENTS
   * @param {number} midi
   * @param {number} time when to start, in context time
   * @param {number} duration how long the key is held, in seconds
   * @param {number} gain
   * @param {number} [detune] cents off equal temperament — an unequal
   *   temperament, an instrument that is slightly out, or both
   */
  voice(spec, midi, time, duration, gain = 0.2, detune = 0) {
    const ctx = this.ctx;
    const freq = mtof(midi);
    const env = { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.1, ...(spec.env || {}) };
    const level = gain * (spec.gain ?? 1);
    // Long releases have to be given room to finish, or the note is cut off.
    const tail = duration + env.release * 6 + 0.1;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, time);
    out.gain.linearRampToValueAtTime(level, time + env.attack);
    out.gain.setTargetAtTime(level * env.sustain, time + env.attack, Math.max(0.005, env.decay));
    out.gain.setTargetAtTime(0.0001, time + duration, Math.max(0.005, env.release));
    out.connect(this.master);

    const shape = spec.filter || { type: 'lowpass', from: 12000 };
    const filter = ctx.createBiquadFilter();
    filter.type = shape.type;
    filter.Q.value = shape.q ?? 0.7;
    filter.frequency.setValueAtTime(shape.from, time);
    if (shape.to != null) {
      filter.frequency.setTargetAtTime(shape.to, time + 0.01, Math.max(0.01, shape.time ?? 0.2));
    }
    filter.connect(out);

    // One LFO for the whole voice, so the partials wobble together.
    let vibrato = null;
    if (spec.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = spec.vibrato.rate;
      vibrato = ctx.createGain();
      vibrato.gain.setValueAtTime(0, time);
      vibrato.gain.linearRampToValueAtTime(spec.vibrato.depth, time + (spec.vibrato.delay ?? 0.2));
      lfo.connect(vibrato);
      lfo.start(time);
      lfo.stop(time + tail);
      this.track(lfo, time + tail);
    }

    for (const partial of spec.partials || [{ type: 'sine' }]) {
      const osc = ctx.createOscillator();
      osc.type = partial.type || 'sine';
      osc.frequency.value = freq * (partial.ratio ?? 1);
      // The recipe's own detune is what makes a voice thick; this one is what
      // makes it play in a different tuning from the piano.
      osc.detune.value = (partial.detune ?? 0) + detune;
      if (vibrato) vibrato.connect(osc.detune);

      const mix = ctx.createGain();
      if (partial.decay) {
        // A partial that fades on its own is how a bell loses its overtones
        // before its fundamental.
        mix.gain.setValueAtTime(partial.level ?? 1, time);
        mix.gain.setTargetAtTime(0.0001, time, partial.decay);
      } else {
        mix.gain.value = partial.level ?? 1;
      }

      if (partial.fm) {
        const modulator = ctx.createOscillator();
        modulator.frequency.value = osc.frequency.value * partial.fm.ratio;
        const index = ctx.createGain();
        index.gain.setValueAtTime(partial.fm.index, time);
        if (partial.fm.decay) index.gain.setTargetAtTime(0.0001, time, partial.fm.decay);
        modulator.connect(index).connect(osc.frequency);
        modulator.start(time);
        modulator.stop(time + tail);
        this.track(modulator, time + tail);
      }

      osc.connect(mix).connect(filter);
      osc.start(time);
      osc.stop(time + tail);
      this.track(osc, time + tail);
    }

    // Breath, pick noise, hammer — whatever the attack needs.
    if (spec.noise) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer();
      const band = ctx.createBiquadFilter();
      band.type = spec.noise.type;
      band.frequency.value = spec.noise.frequency;
      const puff = ctx.createGain();
      puff.gain.setValueAtTime(spec.noise.level, time);
      puff.gain.setTargetAtTime(0.0001, time, spec.noise.decay);
      noise.connect(band).connect(puff).connect(filter);
      const noiseTail = Math.min(tail, spec.noise.decay * 8 + 0.05);
      noise.start(time);
      noise.stop(time + noiseTail);
      this.track(noise, time + noiseTail);
    }
  }

  /**
   * Synthesised kit pieces. The kit does not swap the sounds out; it tunes,
   * stretches and dulls the ones that are already there.
   *
   * @param {string} id one of the TRACKS ids
   * @param {number} time
   * @param {number} gain
   * @param {string} [kitId]
   */
  drum(id, time, gain = 0.6, kitId = this.instruments.kit) {
    const ctx = this.ctx;
    const spec = DRUM_VOICES[id];
    if (!spec) return;
    const kit = drumKit(kitId);
    const level = gain * (spec.level ?? 1) * (kit.gain ?? 1);
    const decay = (t) => Math.max(0.01, t * (kit.decay ?? 1));
    const tune = (hz) => hz * (kit.pitch ?? 1);

    // A kit-wide lid, so "tape" and "cardboard" are dull all the way through.
    let bus = this.master;
    if (kit.lowpass) {
      const lid = ctx.createBiquadFilter();
      lid.type = 'lowpass';
      lid.frequency.value = kit.lowpass;
      lid.connect(this.master);
      bus = lid;
    }

    const run = (source, stopAt) => {
      source.start(time);
      source.stop(stopAt);
      this.track(source, stopAt);
    };

    if (spec.kind === 'tonal' || spec.kind === 'wood') {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const tail = decay(spec.decay);
      osc.type = spec.type || (spec.kind === 'wood' ? 'square' : 'sine');
      osc.frequency.setValueAtTime(tune(spec.from), time);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, tune(spec.to)),
        time + (spec.sweep ?? tail * 0.8),
      );
      env.gain.setValueAtTime(level, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + tail);
      osc.connect(env).connect(bus);
      run(osc, time + tail + 0.05);

      // A woodblock is mostly a click; the tick of noise is what sells it.
      if (spec.noise) {
        this.noiseHit({
          time,
          level: level * spec.noise,
          decay: decay(spec.decay * 0.6),
          type: 'bandpass',
          frequency: (spec.band ?? 2400) * (kit.tone ?? 1),
          q: 1.4,
          bus,
        });
      }
      return;
    }

    if (spec.kind === 'metal' || spec.kind === 'bell') {
      const tail = decay(spec.decay);
      const env = ctx.createGain();
      env.gain.setValueAtTime(level, time);
      env.gain.exponentialRampToValueAtTime(0.0001, time + tail);

      const shape = ctx.createBiquadFilter();
      if (spec.kind === 'metal') {
        shape.type = 'highpass';
        shape.frequency.value = (spec.high ?? 7000) * (kit.tone ?? 1);
      } else {
        shape.type = 'bandpass';
        shape.frequency.value = (spec.band ?? 2600) * (kit.tone ?? 1);
        shape.Q.value = 2;
      }
      shape.connect(env).connect(bus);

      const freqs = spec.kind === 'metal'
        ? METAL_RATIOS.map((r) => spec.base * r)
        : spec.partials;
      for (const hz of freqs) {
        const osc = ctx.createOscillator();
        osc.type = spec.type || 'square';
        osc.frequency.value = tune(hz);
        const mix = ctx.createGain();
        mix.gain.value = 1 / freqs.length;
        osc.connect(mix).connect(shape);
        run(osc, time + tail + 0.05);
      }

      // A ride has a stick on it as well as a wash.
      if (spec.ping) {
        this.noiseHit({
          time,
          level: level * 0.8,
          decay: decay(0.04),
          type: 'bandpass',
          frequency: spec.ping * (kit.tone ?? 1),
          q: 2,
          bus,
        });
      }
      if (spec.noise) {
        this.noiseHit({
          time,
          level: level * spec.noise,
          decay: tail * 0.5,
          type: 'highpass',
          frequency: (spec.high ?? 6000) * 0.8 * (kit.tone ?? 1),
          bus,
        });
      }
      return;
    }

    if (spec.kind === 'clap') {
      // Three bursts a few milliseconds apart, then a longer tail — the whole
      // trick of a handclap is that it is not one hit.
      for (const [offset, amount] of [[0, 0.7], [0.011, 0.9], [0.023, 1]]) {
        this.noiseHit({
          time: time + offset,
          level: level * amount,
          decay: decay(offset === 0.023 ? spec.decay : 0.012),
          type: 'bandpass',
          frequency: spec.band * (kit.tone ?? 1),
          q: spec.q,
          bus,
        });
      }
      return;
    }

    // Plain filtered noise: snare, shaker.
    this.noiseHit({
      time,
      level,
      decay: decay(spec.decay),
      attack: spec.attack,
      type: 'bandpass',
      frequency: spec.band * (kit.tone ?? 1),
      q: spec.q,
      bus,
    });

    if (spec.body) {
      const body = ctx.createOscillator();
      const bodyEnv = ctx.createGain();
      body.frequency.setValueAtTime(tune(spec.body), time);
      bodyEnv.gain.setValueAtTime(level * spec.bodyLevel, time);
      bodyEnv.gain.exponentialRampToValueAtTime(0.0001, time + decay(spec.bodyDecay));
      body.connect(bodyEnv).connect(bus);
      body.start(time);
      body.stop(time + decay(spec.bodyDecay) + 0.05);
      this.track(body, time + decay(spec.bodyDecay) + 0.05);
    }
  }

  /** One shaped burst of noise — the building block of half the kit. */
  noiseHit({ time, level, decay, attack = 0, type = 'bandpass', frequency, q = 1, bus }) {
    const ctx = this.ctx;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.max(20, Math.min(frequency, ctx.sampleRate / 2 - 100));
    filter.Q.value = q;
    const env = ctx.createGain();
    if (attack) {
      env.gain.setValueAtTime(0.0001, time);
      env.gain.linearRampToValueAtTime(level, time + attack);
    } else {
      env.gain.setValueAtTime(level, time);
    }
    env.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
    noise.connect(filter).connect(env).connect(bus || this.master);
    // stop() must come after start(), or the node throws.
    noise.start(time);
    noise.stop(time + attack + decay + 0.05);
    this.track(noise, time + attack + decay + 0.05);
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

  /**
   * How far off the piano a previewed note is. Previews go through the same
   * temperament as playback — a microtonal key you can only hear when the whole
   * loop is running would be no use to anyone tuning by ear.
   */
  previewCents(part, midi) {
    return noteCents({
      part, midi, step: 0, rootPc: this.rootPc, tuning: this.tuning,
    });
  }
}
