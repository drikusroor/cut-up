// Web Audio playback. Everything is synthesised on the fly — no samples, so
// the whole app stays a handful of text files.
//
// There is one voice builder here, and it is driven entirely by the recipes in
// instruments.js: oscillators, an envelope, a filter, optionally a modulator or
// a puff of noise. Adding an instrument means adding data, not code. Drums are
// the same idea with a smaller vocabulary — a table of pieces, and a kit that
// tunes and stretches all of them at once.

import { arrange, tempoScaleOf } from './arrange.js';
import { swingOffset } from './rhythm.js';
import { bassInstrument, drumKit, harmonyInstrument, leadInstrument } from './instruments.js';
import { defaultHumanize, humanizeOffset } from './humanize.js';
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

/**
 * The clock a song runs on.
 *
 * With one tempo this is a multiplication: step times step length. A song
 * whose sections lean on the transport — a coda in half time, a middle eight
 * that pushes — is a piecewise version of the same thing, so the map of where
 * the tempo changes is turned into segments once and every lookup walks them.
 * The inverse matters too: the playhead asks which step a moment in time is,
 * and it has to get the same answer back.
 *
 * @param {Array<{step:number, scale:number}>} map
 * @param {number} base seconds per step at the transport's tempo
 * @param {number} totalSteps
 */
export function makeClock(map, base, totalSteps) {
  const entries = (map?.length ? [...map] : [{ step: 0, scale: 1 }])
    .map((entry) => ({ step: Math.max(0, Math.round(entry.step)), scale: tempoScaleOf(entry.scale) }))
    .sort((a, b) => a.step - b.step);
  if (entries[0].step > 0) entries.unshift({ step: 0, scale: 1 });

  const segments = [];
  let at = 0;
  entries.forEach((entry, index) => {
    const end = index + 1 < entries.length ? entries[index + 1].step : Math.max(totalSteps, entry.step);
    const seconds = base / entry.scale;
    segments.push({ step: entry.step, end, seconds, at });
    at += Math.max(0, end - entry.step) * seconds;
  });

  const forStep = (step) => {
    for (let i = segments.length - 1; i > 0; i--) if (step >= segments[i].step) return segments[i];
    return segments[0];
  };
  const forTime = (time) => {
    for (let i = segments.length - 1; i > 0; i--) if (time >= segments[i].at) return segments[i];
    return segments[0];
  };

  return {
    /** How long the whole pass lasts, in seconds. */
    total: Math.max(at, base),
    /** When a step falls, in seconds from the top. */
    timeAt(step) {
      const segment = forStep(step);
      return segment.at + (step - segment.step) * segment.seconds;
    },
    /** How long one step lasts where that step is. */
    stepSeconds(step) {
      return forStep(step).seconds;
    },
    /** Which step a moment in time lands on — the playhead's question. */
    stepAt(time) {
      const segment = forTime(time);
      return segment.step + (time - segment.at) / segment.seconds;
    },
  };
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
    // Where the tempo changes, once a song has told us — see makeClock.
    this.clock = null;
    this.voices = [];
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

  get currentStep() {
    if (!this.playing || !this.ctx || !this.loopSeconds) return -1;
    const elapsed = this.ctx.currentTime - this.startTime;
    if (elapsed < 0) return -1;
    // Through the clock rather than by division, so the playhead still lands on
    // the right chip in a song whose coda is in half time.
    return Math.floor(this.clock
      ? this.clock.stepAt(elapsed % this.loopSeconds)
      : (elapsed % this.loopSeconds) / this.secondsPerStep);
  }

  stop() {
    this.playing = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    for (const voice of this.voices) {
      try {
        voice.stop();
      } catch {
        // Already stopped; nothing to do.
      }
    }
    this.voices = [];
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
   * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.bass]
   * @param {{tracks: Array<{id:string, pattern:boolean[], velocities:number[]}>}} [song.rhythm]
   * @param {{lead?:string, harmony?:string, bass?:string, kit?:string}} [song.instruments]
   * @param {object} [song.feel] humanize settings — see humanize.js
   * @param {object} [song.tuning] temperament and detune — see tuning.js
   * @param {number} [song.totalSteps]
   * @param {boolean} [song.loop]
   * @param {{chords?:boolean, melody?:boolean, bass?:boolean, drums?:boolean}} [song.parts]
   */
  play(song) {
    this.stop();
    const ctx = this.ensure();

    const {
      tempo = 100,
      swing = 0,
      loop = true,
      parts = {
        chords: true, melody: true, bass: true, drums: true,
      },
      instruments = this.instruments,
      feel = this.feel,
      tuning = this.tuning,
    } = song;

    // Shorter parts repeat to fill the loop — see arrange().
    const {
      totalSteps, chords, melody, bass, drums, tempoMap,
    } = arrange(song);
    // A section may be taken faster or slower than the transport, so time is a
    // clock rather than a multiplier. With one tempo it is the same arithmetic.
    const clock = makeClock(tempoMap, 60 / tempo / 4, totalSteps);

    this.clock = clock;
    this.secondsPerStep = clock.stepSeconds(0);
    this.loopSeconds = clock.total;
    this.playing = true;

    /**
     * Where an event actually sounds: its step, swung, then nudged off the grid
     * by however much this part is rushing, dragging or simply not a machine.
     * Nothing is ever scheduled in the past, or the browser fires it late and
     * the whole bar limps.
     */
    /** Swing delays every other step by a fraction of however long it is here. */
    const swungTime = (step) => clock.timeAt(step)
      + swingOffset(step, clock.stepSeconds(step), swing);

    const timeOf = (part, step, at, voice) => Math.max(
      ctx.currentTime,
      at + swungTime(step)
        + humanizeOffset(part, step, feel, voice) * clock.stepSeconds(step),
    );

    /** How far off the piano one note is: temperament, detune and drift. */
    const centsOf = (part, note) => noteCents({
      part,
      midi: note.midi,
      step: note.step,
      rootPc: note.rootPc ?? song.rootPc ?? this.rootPc,
      tuning,
    });

    const schedule = (at) => {
      if (parts.chords) {
        for (const chord of chords) {
          // Each note carries the instrument of the section it came from, so a
          // song can change voice from one section to the next.
          const spec = harmonyInstrument(chord.instrument || instruments.harmony);
          // Chords are not swung — a pad landing late on every off-step only
          // smears the harmony — but they are humanised like everything else.
          const time = Math.max(
            ctx.currentTime,
            at + clock.timeAt(chord.step)
              + humanizeOffset('chords', chord.step, feel) * clock.stepSeconds(chord.step),
          );
          const duration = chord.length * clock.stepSeconds(chord.step) * 0.96;
          chord.voicing.forEach((midi, voice) => {
            // Tiny spread so the chord sounds strummed rather than stamped.
            this.voice(
              spec,
              midi,
              time + voice * (spec.spread ?? 0.012),
              duration,
              // Chords are struck at a velocity now, so a section can be played
              // softer than the one before it and a coda can fade.
              ((chord.velocity ?? 80) / 127) * 0.254,
              centsOf('harmony', { midi, step: chord.step, rootPc: chord.rootPc }),
            );
          });
        }
      }
      if (parts.melody) {
        for (const note of melody) {
          this.voice(
            leadInstrument(note.instrument || instruments.lead),
            note.midi,
            timeOf('melody', note.step, at),
            Math.max(0.08, note.length * clock.stepSeconds(note.step) * 0.92),
            ((note.velocity ?? 96) / 127) * 0.28,
            centsOf('lead', note),
          );
        }
      }
      if (parts.bass) {
        for (const note of bass) {
          // Low notes carry further than high ones, so the bass is mixed a
          // little under the melody rather than level with it.
          this.voice(
            bassInstrument(note.instrument || instruments.bass),
            note.midi,
            timeOf('bass', note.step, at),
            Math.max(0.08, note.length * clock.stepSeconds(note.step) * 0.94),
            ((note.velocity ?? 100) / 127) * 0.26,
            centsOf('bass', note),
          );
        }
      }
      if (parts.drums) {
        for (const hit of drums) {
          // Salted with the piece, so a drummer who drags can drag the snare
          // without dragging the hat that lands on the same step.
          const time = timeOf('drums', hit.step, at, hit.id);
          this.drum(hit.id, time, (hit.velocity / 127) * 0.7, hit.kit || instruments.kit);
        }
      }
    };

    const startAt = ctx.currentTime + 0.08;
    this.startTime = startAt;
    schedule(startAt);

    if (loop) {
      let nextAt = startAt + this.loopSeconds;
      const tick = () => {
        if (!this.playing) return;
        // Schedule the next pass a little before the current one runs out.
        if (nextAt - ctx.currentTime < this.loopSeconds) {
          schedule(nextAt);
          nextAt += this.loopSeconds;
        }
        this.loopHandle = setTimeout(tick, Math.max(50, (this.loopSeconds * 1000) / 4));
      };
      this.loopHandle = setTimeout(tick, Math.max(50, (this.loopSeconds * 1000) / 4));
    } else {
      this.loopHandle = setTimeout(() => {
        this.playing = false;
      }, (this.loopSeconds + 0.5) * 1000);
    }
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
      this.voices.push(lfo);
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
        this.voices.push(modulator);
      }

      osc.connect(mix).connect(filter);
      osc.start(time);
      osc.stop(time + tail);
      this.voices.push(osc);
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
      this.voices.push(noise);
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
      this.voices.push(source);
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
      this.voices.push(body);
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
    this.voices.push(noise);
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

  /** One-off chord preview, used when you click a chord card. */
  strum(voicing, instrumentId = this.instruments.harmony) {
    this.ensure();
    const spec = harmonyInstrument(instrumentId);
    const time = this.ctx.currentTime + 0.02;
    voicing.forEach((midi, i) => this.voice(
      spec,
      midi,
      time + i * Math.max(0.02, spec.spread ?? 0.02),
      1.1,
      0.18,
      this.previewCents('harmony', midi),
    ));
  }

  /** A few notes on one instrument, for the "hear it" buttons. */
  audition(spec, midis, {
    gap = 0.16, length = 0.3, gain = 0.18, part = 'lead',
  } = {}) {
    this.ensure();
    const time = this.ctx.currentTime + 0.03;
    midis.forEach((midi, i) => this.voice(
      spec, midi, time + i * gap, length, gain, this.previewCents(part, midi),
    ));
  }

  /** Short blip, so dragging a note in the piano roll tells you where you are. */
  preview(midi, instrumentId = this.instruments.lead) {
    this.ensure();
    this.voice(
      leadInstrument(instrumentId),
      midi,
      this.ctx.currentTime + 0.01,
      0.18,
      0.16,
      this.previewCents('lead', midi),
    );
  }

  /** One kit piece on its own, so switching kits is worth doing by ear. */
  previewDrum(id, kitId = this.instruments.kit) {
    this.ensure();
    this.drum(id, this.ctx.currentTime + 0.01, 0.6, kitId);
  }
}

export function mtof(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
