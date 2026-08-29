// The voice builder: everything the app makes a sound with, and nothing about
// when. Playback and offline rendering both stand on this, which is why an
// exported file sounds like what you were listening to rather than like a
// second implementation of it.
//
// There is one voice builder here, and it is driven entirely by the recipes in
// instruments.js: oscillators, an envelope, a filter, optionally a modulator or
// a puff of noise. Adding an instrument means adding data, not code. Drums are
// the same idea with a smaller vocabulary — a table of pieces, and a kit that
// tunes and stretches all of them at once. The voice is a third: a buzz, three
// formants and, where the browser has a wave shaper, a vocoder.

import { drumKit } from './instruments.js';
import { defaultHumanize } from './humanize.js';
import { phoneInfo } from './phonemes.js';
import { phoneSchedule, vocalMode, vocalVoice } from './vocal.js';
import { defaultTuning, noteCents } from './tuning.js';
import { defaultMix, MixerRig } from './mixer.js';

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

/**
 * The vocoder's channels: how many bands the speech is measured in, and the
 * range they are spread over. Fourteen is about where a listener stops hearing
 * separate bands and starts hearing words; the top is high enough for an "s"
 * to be somewhere, and the sibilance bypass takes care of the rest.
 */
const VOCODER_BANDS = 14;
const VOCODER_LOW = 180;
const VOCODER_HIGH = 6500;
const VOCODER_Q = 5;
/** The modulator's own pitch, which a vocoder throws away — only its shape is used. */
const SPEECH_HZ = 132;
/** How fast a formant may move between two sounds. Slower is a mumble. */
const GLIDE = 0.028;

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
 * books a whole song into it as fast as the machine will take it.
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
    // The desk every part is played through — see mixer.js. It is built the
    // first time a note asks for a channel, because a synth may not have a
    // context yet when it is told what the mix is.
    this.mix = defaultMix();
    this.rig = null;
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
   * The mixing desk. Moving a fader adjusts the graph that is already running
   * rather than building a new one, so a slider can be dragged mid-song
   * without the song clicking or restarting.
   */
  setMix(mix) {
    this.mix = mix || defaultMix();
    if (this.rig && this.rig.ctx === this.ctx) this.rig.apply(this.mix);
    else this.rig = null;
  }

  /**
   * Where a part's notes go in: its channel on the desk, or straight to the
   * master bus if there is no context to build a desk in yet.
   *
   * @param {'melody'|'vocal'|'chords'|'bass'|'drums'} part
   */
  bus(part) {
    if (!this.ctx || !this.master) return this.master;
    if (!this.rig || this.rig.ctx !== this.ctx || this.rig.destination !== this.master) {
      this.rig = new MixerRig(this.ctx, this.master, this.mix);
    }
    return this.rig.input(part);
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
   * @param {AudioNode} [destination] where it comes out; the master bus unless
   *   something else wants it, which is how the talk box gets to play the
   *   melody instrument into the vocoder instead of into the room
   */
  voice(spec, midi, time, duration, gain = 0.2, detune = 0, destination = null) {
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
    out.connect(destination || this.master);

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
   * The vocoder, built once and left standing.
   *
   * A channel vocoder is two filter banks and a set of envelope followers
   * between them. The modulator — here, synthesised speech — is split into
   * fourteen bands; each band is rectified and smoothed, which leaves a slow
   * control signal saying "there is this much energy around 800 Hz just now".
   * The carrier is split into the same fourteen bands, and each band's level is
   * driven by the matching control signal. The carrier comes out wearing the
   * modulator's mouth.
   *
   * None of that needs a script processor: an envelope is an audio signal, and
   * an audio signal can be connected straight to a gain's `gain`.
   *
   * The rig is per-context rather than per-note. Fourteen bands is around
   * eighty nodes, and building that for every syllable of a four-minute song
   * would be a great deal of silicon spent on the same eighty filters.
   */
  vocalRig() {
    if (this._rig) return this._rig;
    const ctx = this.ctx;
    const modIn = ctx.createGain();
    const carrierIn = ctx.createGain();
    const out = ctx.createGain();
    out.gain.value = 1.5;
    // The vocoder is the voice, so it comes out on the voice's channel — the
    // fader that says "Voice" moves the talk box as well as the plain singer.
    out.connect(this.bus('vocal'));

    // Rectification: |x|. Turning a waveform into its own outline is the whole
    // of an envelope follower, once a lowpass has taken the ripple off.
    const curve = new Float32Array(257);
    for (let i = 0; i < curve.length; i++) curve[i] = Math.abs((i / 128) - 1);

    const bands = [];
    for (let b = 0; b < VOCODER_BANDS; b++) {
      const hz = VOCODER_LOW * (VOCODER_HIGH / VOCODER_LOW) ** (b / (VOCODER_BANDS - 1));
      const band = (input) => {
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = hz;
        filter.Q.value = VOCODER_Q;
        input.connect(filter);
        return filter;
      };

      const rect = ctx.createWaveShaper();
      rect.curve = curve;
      const follower = ctx.createBiquadFilter();
      follower.type = 'lowpass';
      follower.frequency.value = 24;
      const depth = ctx.createGain();
      // The bands nearer the top carry the consonants and are quieter to start
      // with, so they are opened harder.
      depth.gain.value = 3 + (b / VOCODER_BANDS) * 2.5;
      band(modIn).connect(rect).connect(follower).connect(depth);

      const vca = ctx.createGain();
      vca.gain.value = 0;
      depth.connect(vca.gain);
      band(carrierIn).connect(vca).connect(out);
      bands.push(hz);
    }

    // Sibilance goes straight past the bank. An "s" is noise above where the
    // top band sits, and a vocoder that has to reconstruct it from a sawtooth
    // gets a whistle instead — so the real hiss is simply let through.
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 4000;
    const hissLevel = ctx.createGain();
    hissLevel.gain.value = 0.45;
    modIn.connect(hiss).connect(hissLevel).connect(out);

    this._rig = { modIn, carrierIn, out, bands };
    return this._rig;
  }

  /** Vocoding needs a rectifier, and a rectifier needs a wave shaper. */
  canVocode() {
    return typeof this.ctx?.createWaveShaper === 'function';
  }

  /**
   * Sings one syllable.
   *
   * The voice is three bandpass filters and a buzz — park them at 270, 2290 and
   * 3010 Hz and the buzz says "ee"; move them to 730, 1090, 2440 and it says
   * "ah". Consonants are the same filters plus a band of noise: a hiss for the
   * fricatives, a moment of silence and a click for the plosives. Where each
   * sound falls inside the note is worked out by phoneSchedule(), so this only
   * has to draw what it is told.
   *
   * In `sung` mode that voice goes to the speakers. In the other two it goes to
   * the vocoder instead, at a fixed pitch — a vocoder keeps only the shape of
   * its modulator — and the note's own pitch is played by the carrier: a
   * sawtooth for `vocoder`, the melody's own instrument for `talkbox`.
   *
   * @param {{midi:number, syllable:{phones:string[], tie?:boolean, slideFrom?:number,
   *   stressed?:boolean}}} note
   * @param {number} time when the note is, in context time
   * @param {number} duration
   * @param {number} [gain]
   * @param {number} [detune] cents
   * @param {{voice?:string, mode?:string, lead?:object}} [opts]
   */
  sing(note, time, duration, gain = 0.22, detune = 0, opts = {}) {
    const ctx = this.ctx;
    const syllable = note?.syllable;
    if (!ctx || !syllable?.phones?.length) return;

    const spec = vocalVoice(opts.voice);
    const mode = this.canVocode() ? vocalMode(opts.mode).id : 'sung';
    const vocoded = mode !== 'sung';
    const { segments, lead } = phoneSchedule(syllable.phones, duration);
    // The consonants are sung ahead of the beat, and a context only a moment
    // old has no room in front of it — Web Audio will not be scheduled before
    // zero, so the syllable waits for the lead it needs.
    const at0 = Math.max(time, lead);
    const start = at0 - lead;
    const end = at0 + duration;
    const tail = end + 0.3;
    const freq = mtof(note.midi);

    const destination = vocoded ? this.vocalRig().modIn : (opts.destination || this.master);
    // A vocoder throws its modulator's pitch away, so the speech is spoken on
    // one note and only the carrier knows what the tune is.
    const pitch = vocoded ? SPEECH_HZ : freq;
    const level = gain * (vocoded ? 1.6 : 1);

    // The syllable's own envelope. A tied note is a vowel already sounding, so
    // it fades in rather than starting, which is what makes a melisma one long
    // sound instead of the word said twice.
    const amp = ctx.createGain();
    const attack = syllable.tie ? 0.06 : 0.018;
    amp.gain.setValueAtTime(0, start);
    amp.gain.linearRampToValueAtTime(level * (syllable.stressed ? 1.12 : 1), start + attack);
    amp.gain.setValueAtTime(level * (syllable.stressed ? 1.12 : 1), Math.max(start + attack, end - 0.03));
    amp.gain.setTargetAtTime(0.0001, end, 0.05);
    amp.connect(destination);

    // The throat: three resonances, loudest at the bottom, which between them
    // are the difference between one vowel and another.
    const formants = [];
    for (let i = 0; i < 3; i++) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = [7, 9, 11][i];
      const mix = ctx.createGain();
      mix.gain.value = [1, 0.55, 0.3][i];
      filter.connect(mix).connect(amp);
      formants.push(filter);
    }

    // The glottis: a sawtooth is a rough enough approximation of what vocal
    // folds do, once the formants above have had it.
    const glottis = ctx.createGain();
    glottis.gain.setValueAtTime(0, start);
    for (const filter of formants) glottis.connect(filter);

    const buzz = ctx.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.setValueAtTime(pitch, start);
    buzz.detune.value = detune;
    if (!vocoded && syllable.slideFrom) {
      // A held vowel slides onto its next note instead of restriking it.
      buzz.frequency.setValueAtTime(mtof(syllable.slideFrom), start);
      buzz.frequency.exponentialRampToValueAtTime(freq, start + Math.min(0.09, duration * 0.4));
    }
    buzz.connect(glottis);
    buzz.start(start);
    buzz.stop(tail);
    this.track(buzz, tail);

    // Nobody sings dead straight. The android does.
    if (spec.vibrato && !vocoded) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = spec.vibrato.rate;
      const swing = ctx.createGain();
      swing.gain.setValueAtTime(0, start);
      swing.gain.linearRampToValueAtTime(spec.vibrato.depth, start + (spec.vibrato.delay ?? 0.25));
      lfo.connect(swing).connect(buzz.detune);
      lfo.start(start);
      lfo.stop(tail);
      this.track(lfo, tail);
    }

    // The breath: one noise source, filtered differently from moment to moment,
    // which is every fricative, every plosive burst and the air around a vowel.
    const breath = ctx.createBufferSource();
    breath.buffer = this.noiseBuffer();
    breath.loop = true;
    const breathBand = ctx.createBiquadFilter();
    breathBand.type = 'bandpass';
    breathBand.frequency.setValueAtTime(1500, start);
    breathBand.Q.setValueAtTime(1, start);
    const breathLevel = ctx.createGain();
    breathLevel.gain.setValueAtTime(0, start);
    breath.connect(breathBand).connect(breathLevel).connect(amp);
    breath.start(start);
    breath.stop(tail);
    this.track(breath, tail);

    const scale = spec.formant ?? 1;
    const voicing = spec.voicing ?? 1;
    const formantHz = (f, i) => Math.max(80, Math.min(f[i] * scale, ctx.sampleRate / 2 - 200));
    /** Moves the throat to a new shape, over `glide` seconds. */
    const setFormants = (f, at, glide = GLIDE) => {
      formants.forEach((filter, i) => {
        if (glide > 0) filter.frequency.linearRampToValueAtTime(formantHz(f, i), at + glide);
        else filter.frequency.setValueAtTime(formantHz(f, i), at);
      });
    };

    let placed = false;
    for (const segment of segments) {
      const info = phoneInfo(segment.p);
      if (!info) continue;
      const at = at0 + segment.at;
      const stop = at + segment.dur;

      if (info.f) {
        // A vowel, a nasal or a liquid: shape the throat and let the folds run.
        setFormants(info.f, at, placed ? GLIDE : 0);
        placed = true;
        if (info.glide) {
          // A diphthong is one mouth moving. It holds the first shape, then
          // starts travelling about halfway through, and arrives at the end.
          const from = at + segment.dur * 0.45;
          formants.forEach((filter, i) => filter.frequency.setValueAtTime(formantHz(info.f, i), from));
          setFormants(info.glide, from, Math.max(0.04, segment.dur * 0.5));
        }
        glottis.gain.setTargetAtTime(voicing * (info.level ?? 1), at, 0.012);
        breathLevel.gain.setTargetAtTime(spec.breath * 0.25 * (info.kind === 'vowel' ? 1 : 0.4), at, 0.02);
        continue;
      }

      if (info.kind === 'plosive' || info.kind === 'affricate') {
        // Silence, then a click. The silence is the consonant, really — it is
        // what tells you a "t" happened rather than a hiss.
        const closure = Math.min(info.closure ?? 0.025, segment.dur * 0.6);
        glottis.gain.setTargetAtTime(info.voiced ? voicing * 0.15 : 0, at, 0.006);
        breathLevel.gain.setTargetAtTime(0, at, 0.006);
        const burstAt = at + closure;
        breathBand.frequency.setValueAtTime(info.burst, burstAt);
        breathBand.Q.setValueAtTime(info.q ?? 1.2, burstAt);
        breathLevel.gain.setValueAtTime(info.level, burstAt);
        if (info.kind === 'affricate') {
          // A "ch" is a "t" that lets go into a "sh".
          breathBand.frequency.linearRampToValueAtTime(info.band, burstAt + 0.02);
          breathLevel.gain.setTargetAtTime(info.level * 0.8, burstAt + 0.02, 0.03);
          breathLevel.gain.setTargetAtTime(0.0001, stop, 0.015);
        } else {
          breathLevel.gain.setTargetAtTime(0.0001, burstAt + 0.012, 0.02);
        }
        if (info.voiced) glottis.gain.setTargetAtTime(voicing, burstAt, 0.01);
        continue;
      }

      // A fricative or an aspirate: noise in a band, with the folds running
      // underneath it or not.
      breathBand.frequency.setTargetAtTime(info.band, at, 0.01);
      breathBand.Q.setValueAtTime(info.q ?? 1.2, at);
      breathLevel.gain.setTargetAtTime(info.level, at, 0.012);
      glottis.gain.setTargetAtTime(info.voiced ? voicing * 0.35 : 0, at, 0.012);
    }

    // Whatever the last sound was, the mouth closes at the end of the note.
    glottis.gain.setTargetAtTime(0.0001, end, 0.04);
    breathLevel.gain.setTargetAtTime(0.0001, end, 0.04);

    if (!vocoded) return;

    // The carrier: what the words are sung *on*. This is where the tune is.
    const rig = this.vocalRig();
    if (mode === 'talkbox' && opts.lead) {
      this.voice(opts.lead, note.midi, at0, duration, 0.9, detune, rig.carrierIn);
      return;
    }
    const carrier = ctx.createGain();
    carrier.gain.setValueAtTime(0, start);
    carrier.gain.linearRampToValueAtTime(0.5, start + 0.012);
    carrier.gain.setValueAtTime(0.5, Math.max(start + 0.012, end - 0.02));
    carrier.gain.setTargetAtTime(0.0001, end, 0.04);
    carrier.connect(rig.carrierIn);
    // Two saws a few cents apart and an octave under, so every band has
    // something to open onto — a vocoder is only as rich as what it is fed.
    for (const [type, ratio, cents, mix] of [
      ['sawtooth', 1, -7, 1], ['sawtooth', 1, 7, 1], ['square', 0.5, 0, 0.5],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * ratio;
      osc.detune.value = detune + cents;
      const trim = ctx.createGain();
      trim.gain.value = mix;
      osc.connect(trim).connect(carrier);
      osc.start(start);
      osc.stop(tail);
      this.track(osc, tail);
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
   * @param {AudioNode} [destination] where it comes out; the master bus unless
   *   the desk has a channel for the kit
   */
  drum(id, time, gain = 0.6, kitId = this.instruments.kit, destination = null) {
    const ctx = this.ctx;
    const spec = DRUM_VOICES[id];
    if (!spec) return;
    const kit = drumKit(kitId);
    const level = gain * (spec.level ?? 1) * (kit.gain ?? 1);
    const decay = (t) => Math.max(0.01, t * (kit.decay ?? 1));
    const tune = (hz) => hz * (kit.pitch ?? 1);

    // A kit-wide lid, so "tape" and "cardboard" are dull all the way through.
    const out = destination || this.master;
    let bus = out;
    if (kit.lowpass) {
      const lid = ctx.createBiquadFilter();
      lid.type = 'lowpass';
      lid.frequency.value = kit.lowpass;
      lid.connect(out);
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
