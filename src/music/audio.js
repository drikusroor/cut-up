// Web Audio playback: the transport, and the clock it runs on.
//
// The sounds themselves live in synth.js — this file is about when they
// happen. A song is turned into an ordered list of events once, and then
// booked: a rolling window of them while you are listening, all of them at
// once when render.js is writing a file.

import { arrange, tempoScaleOf } from './arrange.js';
import { swingOffset } from './rhythm.js';
import { bassInstrument, harmonyInstrument, leadInstrument } from './instruments.js';
import { humanizeOffset } from './humanize.js';
import { defaultVocal } from './vocal.js';
import { noteCents } from './tuning.js';
import { masterChain, mtof, Synth } from './synth.js';

// Re-exported because the piano roll and the tests ask this file what a note
// sounds like, and it is a detail of the voice builder that they need.
export { mtof };

/**
 * How the transport books notes ahead of itself.
 *
 * The scheduler wakes on a timer and books everything due before the horizon,
 * so the window has to be comfortably longer than the gap between two wakeups.
 * A backgrounded tab gets its timers throttled to about a second, so the floor
 * is well past that, and the ceiling is there for tabs throttled harder still.
 */
const PUMP_MS = 100;
const MIN_LOOKAHEAD = 1.5;
const MAX_LOOKAHEAD = 12;

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

/**
 * One pass of a song as a list of things to do and when to do them, ordered.
 *
 * Nothing is built here — an event is a closure that will make its nodes when
 * whoever is booking them is ready. That is the whole reason playback and
 * export cannot drift apart: they take the same list and differ only in how
 * far ahead they book it.
 *
 * @param {Synth} synth what the events will sound through
 * @param {object} song see AudioEngine#play
 * @returns {{events: Array<{at:number, play:(time:number)=>void}>, clock:object,
 *   totalSteps:number}} times are seconds from the top of the pass
 */
export function songEvents(synth, song) {
  const {
    tempo = 100,
    swing = 0,
    parts = {
      chords: true, melody: true, bass: true, drums: true, vocal: true,
    },
    instruments = synth.instruments,
    feel = synth.feel,
    tuning = synth.tuning,
  } = song;

  // Shorter parts repeat to fill the loop — see arrange().
  const {
    totalSteps, chords, melody, bass, drums, tempoMap,
  } = arrange(song);
  // A section may be taken faster or slower than the transport, so time is a
  // clock rather than a multiplier. With one tempo it is the same arithmetic.
  const clock = makeClock(tempoMap, 60 / tempo / 4, totalSteps);

  /** Swing delays every other step by a fraction of however long it is here. */
  const swungTime = (step) => clock.timeAt(step)
    + swingOffset(step, clock.stepSeconds(step), swing);

  /**
   * Where an event sounds relative to the top of the pass: its step, swung,
   * then nudged off the grid by however much this part is rushing, dragging
   * or simply not a machine.
   */
  const nudged = (part, step, voice) => swungTime(step)
    + humanizeOffset(part, step, feel, voice) * clock.stepSeconds(step);

  /** How far off the piano one note is: temperament, detune and drift. */
  const centsOf = (part, note) => noteCents({
    part,
    midi: note.midi,
    step: note.step,
    rootPc: note.rootPc ?? song.rootPc ?? synth.rootPc,
    tuning,
  });

  /**
   * One pass of the song as a list of things to do and when to do them,
   * ordered. Nothing is built here — an event is a closure that will make its
   * nodes later, when the playhead is nearly on it.
   */
  const events = [];

  if (parts.chords) {
    for (const chord of chords) {
      // Each note carries the instrument of the section it came from, so a
      // song can change voice from one section to the next.
      const spec = harmonyInstrument(chord.instrument || instruments.harmony);
      // Chords are not swung — a pad landing late on every off-step only
      // smears the harmony — but they are humanised like everything else.
      const at = clock.timeAt(chord.step)
        + humanizeOffset('chords', chord.step, feel) * clock.stepSeconds(chord.step);
      const duration = chord.length * clock.stepSeconds(chord.step) * 0.96;
      events.push({
        at,
        play: (time) => chord.voicing.forEach((midi, voice) => {
          // Tiny spread so the chord sounds strummed rather than stamped.
          synth.voice(
            spec,
            midi,
            time + voice * (spec.spread ?? 0.012),
            duration,
            // Chords are struck at a velocity now, so a section can be played
            // softer than the one before it and a coda can fade.
            ((chord.velocity ?? 80) / 127) * 0.254,
            centsOf('harmony', { midi, step: chord.step, rootPc: chord.rootPc }),
            // Every part arrives on its own channel of the desk — see mixer.js.
            synth.bus('chords'),
          );
        }),
      });
    }
  }
  if (parts.melody) {
    for (const note of melody) {
      const spec = leadInstrument(note.instrument || instruments.lead);
      const duration = Math.max(0.08, note.length * clock.stepSeconds(note.step) * 0.92);
      events.push({
        at: nudged('melody', note.step),
        play: (time) => synth.voice(
          spec, note.midi, time, duration,
          ((note.velocity ?? 96) / 127) * 0.28,
          centsOf('lead', note),
          synth.bus('melody'),
        ),
      });
    }
  }
  // The voice rides on the melody's notes rather than having a part of its
  // own: a syllable is stuck to a note by vocal.js, and the two are heard
  // together or one without the other, whichever the transport is asking for.
  if (parts.vocal !== false) {
    const sung = { ...defaultVocal(), ...(song.vocal || {}) };
    for (const note of melody) {
      if (!note.syllable) continue;
      // A note brings its own singer where it has one, so a song can change
      // voice from one section to the next the way it changes instrument.
      const settings = note.vocal ? { ...sung, ...note.vocal } : sung;
      const duration = Math.max(0.12, note.length * clock.stepSeconds(note.step) * 0.96);
      const lead = leadInstrument(note.instrument || instruments.lead);
      events.push({
        at: nudged('melody', note.step),
        play: (time) => synth.sing(
          note, time, duration,
          ((note.velocity ?? 96) / 127) * 0.34 * settings.level,
          centsOf('lead', note),
          {
            voice: settings.voice, mode: settings.mode, lead, destination: synth.bus('vocal'),
          },
        ),
      });
    }
  }
  if (parts.bass) {
    for (const note of bass) {
      const spec = bassInstrument(note.instrument || instruments.bass);
      const duration = Math.max(0.08, note.length * clock.stepSeconds(note.step) * 0.94);
      events.push({
        at: nudged('bass', note.step),
        // Low notes carry further than high ones, so the bass is mixed a
        // little under the melody rather than level with it.
        play: (time) => synth.voice(
          spec, note.midi, time, duration,
          ((note.velocity ?? 100) / 127) * 0.26,
          centsOf('bass', note),
          synth.bus('bass'),
        ),
      });
    }
  }
  if (parts.drums) {
    for (const hit of drums) {
      const kit = hit.kit || instruments.kit;
      const gain = (hit.velocity / 127) * 0.7;
      events.push({
        // Salted with the piece, so a drummer who drags can drag the snare
        // without dragging the hat that lands on the same step.
        at: nudged('drums', hit.step, hit.id),
        play: (time) => synth.drum(hit.id, time, gain, kit, synth.bus('drums')),
      });
    }
  }

  events.sort((a, b) => a.at - b.at);
  return { events, clock, totalSteps };
}

export class AudioEngine extends Synth {
  constructor() {
    super();
    this.playing = false;
    this.loopHandle = null;
    this.startTime = 0;
    this.loopSeconds = 0;
    this.secondsPerStep = 0;
    // Where the tempo changes, once a song has told us — see makeClock.
    this.clock = null;
  }

  /** Browsers only allow this after a user gesture, so call it from a click. */
  ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctor();
      this.master = masterChain(this.ctx);
    }
    // Not just 'suspended': iOS parks a context in 'interrupted' after a call
    // or a lock screen, and a resume() that is never asked for is a song that
    // never starts. The promise is ignored on purpose — the scheduler asks
    // again on its next wakeup if this one did not take.
    if (this.ctx.state !== 'running') this.ctx.resume?.().catch?.(() => {});
    return this.ctx;
  }


  /**
   * Where the playhead is, in steps, unrounded — for anything that has to move
   * as smoothly as the sound does, like the words going past in the transport.
   */
  get position() {
    if (!this.playing || !this.ctx || !this.loopSeconds) return -1;
    const elapsed = this.ctx.currentTime - this.startTime;
    if (elapsed < 0) return -1;
    // Through the clock rather than by division, so the playhead still lands on
    // the right chip in a song whose coda is in half time.
    return this.clock
      ? this.clock.stepAt(elapsed % this.loopSeconds)
      : (elapsed % this.loopSeconds) / this.secondsPerStep;
  }

  get currentStep() {
    const at = this.position;
    return at < 0 ? -1 : Math.floor(at);
  }

  stop() {
    this.playing = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    this.silence();
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
   * @param {{voice?:string, mode?:string, level?:number}} [song.vocal] how the
   *   words on the melody are sung — see vocal.js
   * @param {object} [song.feel] humanize settings — see humanize.js
   * @param {object} [song.tuning] temperament and detune — see tuning.js
   * @param {number} [song.totalSteps]
   * @param {boolean} [song.loop]
   * @param {{chords?:boolean, melody?:boolean, bass?:boolean, drums?:boolean, vocal?:boolean}} [song.parts]
   * @param {number} [song.startStep] where to enter the pass — a seek, not a
   *   loop point: later passes still start again from the top.
   */
  play(song) {
    this.stop();
    const ctx = this.ensure();
    // A song carries the desk it was mixed on, so playing one is playing it
    // mixed — and so is the file rendered from the same object.
    if (song.mix) this.setMix(song.mix);
    const { loop = true } = song;
    const { events, clock } = songEvents(this, song);

    this.clock = clock;
    this.secondsPerStep = clock.stepSeconds(0);
    this.loopSeconds = clock.total;
    this.playing = true;

    const startAt = ctx.currentTime + 0.08;
    // A seek: the pass is entered partway through rather than at the top, so
    // "now" has to line up with wherever startStep falls in it. Later passes
    // are unaffected — once the loop wraps it plays from the top as normal.
    const seekAt = song.startStep > 0
      ? Math.min(this.loopSeconds, Math.max(0, clock.timeAt(song.startStep)))
      : 0;
    this.startTime = startAt - seekAt;

    // The transport is a rolling window, not one big booking.
    //
    // Scheduling a whole arrangement up front means tens of thousands of nodes
    // in the graph at once — a seven-minute song is around seventy thousand —
    // and the audio thread has to walk every one of them, every 128 samples,
    // for the length of the song. That is what makes a long song stutter,
    // start late, or never start at all. So only the next second or two is ever
    // booked, and the rest is built as the playhead reaches it.
    let origin = this.startTime;
    // Events before the seek point are skipped for this first pass only — the
    // cursor rejoins the top of the list once the loop wraps.
    let cursor = seekAt > 0 ? events.findIndex((event) => event.at >= seekAt) : 0;
    if (cursor < 0) cursor = events.length;
    let lastPump = ctx.currentTime;

    const pump = () => {
      if (!this.playing) return;
      // A context can be suspended out from under us — another tab taking the
      // hardware, a phone call, a lock screen — and it comes back with the
      // clock stopped. Ask for it back rather than playing into silence.
      if (this.ctx.state !== 'running') this.ensure();

      const now = this.ctx.currentTime;
      // A backgrounded tab has its timers throttled, to a second and sometimes
      // a great deal worse, so the window has to cover however long the last
      // gap actually turned out to be — otherwise the song runs out of booked
      // notes between two ticks and simply stops.
      const lookahead = Math.min(MAX_LOOKAHEAD, Math.max(MIN_LOOKAHEAD, (now - lastPump) * 4));
      lastPump = now;
      const horizon = now + lookahead;

      while (events.length) {
        if (cursor >= events.length) {
          if (!loop || !(this.loopSeconds > 0)) break;
          origin += this.loopSeconds;
          cursor = 0;
        }
        const event = events[cursor];
        if (origin + event.at > horizon) break;
        try {
          // Nothing is ever scheduled in the past, or the browser fires it late
          // and the whole bar limps.
          event.play(Math.max(now, origin + event.at));
        } catch {
          // One note the browser will not build must not take the song with it.
        }
        cursor += 1;
      }

      // A song that is not looping is over once the last note has been booked
      // and had time to sound.
      if (!loop && cursor >= events.length && now > origin + this.loopSeconds + 0.5) {
        this.playing = false;
        this.loopHandle = null;
        return;
      }
      this.loopHandle = setTimeout(pump, PUMP_MS);
    };

    pump();
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
      this.bus('chords'),
    ));
  }

  /** A few notes on one instrument, for the "hear it" buttons. */
  audition(spec, midis, {
    gap = 0.16, length = 0.3, gain = 0.18, part = 'lead',
  } = {}) {
    this.ensure();
    const time = this.ctx.currentTime + 0.03;
    // A preview goes through the same channel the part plays on, so auditioning
    // an instrument on a muted channel does not leave you clicking in silence
    // wondering what is broken.
    const channel = { lead: 'melody', harmony: 'chords', bass: 'bass' }[part] || 'melody';
    midis.forEach((midi, i) => this.voice(
      spec, midi, time + i * gap, length, gain, this.previewCents(part, midi), this.bus(channel),
    ));
  }

  /** A line of words on a few notes, for the ▶ next to the voice. */
  auditionVoice(notes, opts = {}) {
    this.ensure();
    // Room in front for the consonants that are sung ahead of the beat.
    const at = this.ctx.currentTime + 0.12;
    for (const note of notes) {
      this.sing(
        note,
        at + note.step * 0.34,
        note.length * 0.34,
        0.24,
        0,
        { ...opts, destination: this.bus('vocal') },
      );
    }
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
      this.bus('melody'),
    );
  }

  /** One kit piece on its own, so switching kits is worth doing by ear. */
  previewDrum(id, kitId = this.instruments.kit) {
    this.ensure();
    this.drum(id, this.ctx.currentTime + 0.01, 0.6, kitId, this.bus('drums'));
  }
}
