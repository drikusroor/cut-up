// A minimal type-1 MIDI writer, so anything the app generates can be dragged
// straight into a DAW. No dependencies — MIDI is just bytes.

import { arrange } from './arrange.js';
import { bassInstrument, harmonyInstrument, leadInstrument } from './instruments.js';
import { humanizeOffset } from './humanize.js';
import { isEqualTempered, noteCents } from './tuning.js';
import { DEFAULT_METER, normalizeMeter } from './meter.js';

const TICKS_PER_QUARTER = 480;
const STEPS_PER_QUARTER = 4; // the app works on a sixteenth-note grid
export const TICKS_PER_STEP = TICKS_PER_QUARTER / STEPS_PER_QUARTER;

/**
 * A pitch bend of ±2 semitones is what a synth does unless it is told
 * otherwise, so that is the range the microtonal offsets are written against —
 * and the file says so explicitly rather than hoping.
 */
const BEND_RANGE_CENTS = 200;

/** Variable-length quantity, MIDI's delta-time encoding. */
export function writeVarInt(value) {
  const out = [value & 0x7f];
  let v = Math.floor(value / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

function str(text) {
  return [...text].map((c) => c.charCodeAt(0));
}

function uint32(value) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function chunk(id, data) {
  return [...str(id), ...uint32(data.length), ...data];
}

/**
 * Turns notes into an MTrk chunk.
 *
 * A note may carry a `program`; when it differs from the one before it, a
 * program change goes in ahead of it. That is how a song whose sections use
 * different instruments comes out of the export sounding like it did here.
 *
 * A note may also carry a `bend` in cents, which is how a tuning that is not
 * the piano's survives the trip into a DAW: the note is written on the nearest
 * key and bent onto its real pitch just before it sounds.
 *
 * @param {{name?: string, channel?: number, tempo?: number, meter?: {beats:number, unit:number}, notes: Array<{midi:number, tick:number, durationTicks:number, velocity?:number, program?:number, bend?:number}>}} track
 */
function trackChunk(track) {
  const {
    name, channel = 0, tempo, meter, notes = [],
  } = track;
  const events = [];

  if (name) {
    events.push({ tick: 0, order: 0, bytes: [0xff, 0x03, name.length, ...str(name)] });
  }
  if (tempo) {
    const usPerQuarter = Math.round(60000000 / tempo);
    events.push({
      tick: 0,
      order: 0,
      bytes: [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff],
    });
  }
  if (meter) {
    const { beats, unit } = normalizeMeter(meter);
    events.push({
      tick: 0,
      order: 0,
      bytes: [
        0xff, 0x58, 0x04,
        beats,
        Math.round(Math.log2(unit)),
        // Clocks per metronome click: one click per written beat.
        Math.max(1, Math.round((24 * 4) / unit)),
        8, // thirty-seconds per quarter, which is always eight
      ],
    });
  }
  if (notes.some((note) => note.bend)) {
    // RPN 0: set the pitch bend range to the two semitones the offsets assume.
    for (const [controller, value] of [[101, 0], [100, 0], [6, 2], [38, 0]]) {
      events.push({ tick: 0, order: 0, bytes: [0xb0 | channel, controller, value] });
    }
  }

  let program = null;
  // In tick order, so a program change lands ahead of the note that asked for
  // it however the caller happened to build the list.
  for (const note of [...notes].sort((a, b) => a.tick - b.tick)) {
    const midi = clamp(Math.round(note.midi), 0, 127);
    const velocity = clamp(Math.round(note.velocity ?? 96), 1, 127);
    const start = Math.max(0, Math.round(note.tick));
    const end = start + Math.max(1, Math.round(note.durationTicks));
    if (note.program != null && note.program !== program) {
      program = note.program;
      events.push({ tick: start, order: 1, bytes: [0xc0 | channel, clamp(Math.round(program), 0, 127)] });
    }
    if (note.bend) {
      const value = clamp(Math.round(8192 + (note.bend / BEND_RANGE_CENTS) * 8192), 0, 16383);
      events.push({ tick: start, order: 2.5, bytes: [0xe0 | channel, value & 0x7f, (value >> 7) & 0x7f] });
    }
    events.push({ tick: start, order: 3, bytes: [0x90 | channel, midi, velocity] });
    events.push({ tick: end, order: 2, bytes: [0x80 | channel, midi, 0] });
  }

  // Note-offs go before note-ons at the same tick, so repeated notes retrigger;
  // a program change goes before all of it and a pitch bend immediately before
  // the note it belongs to.
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const data = [];
  let previous = 0;
  for (const event of events) {
    data.push(...writeVarInt(event.tick - previous), ...event.bytes);
    previous = event.tick;
  }
  data.push(0x00, 0xff, 0x2f, 0x00); // end of track
  return chunk('MTrk', data);
}

/**
 * Builds a complete MIDI file.
 * @param {{tempo?: number, meter?: {beats:number, unit:number}, tracks: Array<{name?: string, channel?: number, notes: any[]}>}} song
 * @returns {Uint8Array}
 */
export function buildMidiFile(song) {
  const { tempo = 100, meter = DEFAULT_METER, tracks = [] } = song;
  const chunks = [];
  // Track 0 carries the tempo map and the time signature, which is the type-1
  // convention — a DAW reads its bar lines off this one track.
  chunks.push(trackChunk({
    name: 'Tempo', tempo, meter, notes: [],
  }));
  for (const track of tracks) chunks.push(trackChunk(track));

  const header = chunk('MThd', [
    0x00, 0x01,
    0x00, chunks.length,
    (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff,
  ]);

  return Uint8Array.from([...header, ...chunks.flat()]);
}

/**
 * Converts a step index to ticks, applying the same swing as playback — and,
 * when the humanizer has pushed a note off its step, the same nudge. The offset
 * is seeded rather than rolled, so the file is the take you heard rather than a
 * second, differently sloppy one.
 *
 * @param {number} step
 * @param {number} [swing]
 * @param {number} [drift] humanize offset, in steps
 */
export function stepToTicks(step, swing = 0, drift = 0) {
  const offset = step % 2 === 1 ? TICKS_PER_STEP * swing * 0.5 : 0;
  return Math.max(0, Math.round(step * TICKS_PER_STEP + offset + drift * TICKS_PER_STEP));
}

/**
 * Assembles chords, melody and drums into one MIDI file.
 *
 * @param {object} song
 * @param {number} song.tempo
 * @param {number} [song.swing]
 * @param {number[][]} [song.chordVoicings] MIDI notes per chord
 * @param {number} [song.stepsPerChord]
 * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.melody]
 * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.bass]
 * @param {{steps:number, bars:number, tracks:Array<{note:number, pattern:boolean[], velocities:number[]}>}} [song.rhythm]
 * @param {{beats:number, unit:number}} [song.meter] the time signature
 * @param {object} [song.feel] humanize settings — see humanize.js
 * @param {object} [song.tuning] temperament and detune — see tuning.js
 * @returns {Uint8Array}
 */
export function songToMidi(song) {
  const {
    tempo = 100, swing = 0, instruments = {}, meter = DEFAULT_METER, feel = null, tuning = null,
  } = song;
  // Same layout the audio engine plays, so the export is what you just heard.
  const {
    chords, melody, bass, drums,
  } = arrange(song);

  /** The nudge the humanizer gave this event, in steps. */
  const drift = (part, step, voice) => humanizeOffset(part, step, feel, voice);

  // A tuning that is not the piano's is written as a bend per note, which only
  // works on a part that plays one note at a time. The melody and the bass do;
  // a chord voicing on one channel does not, so it is left on the nearest keys.
  const bendable = !isEqualTempered(tuning);
  const bendOf = (part, note) => (bendable
    ? noteCents({
      part, midi: note.midi, step: note.step, rootPc: note.rootPc ?? song.rootPc ?? 0, tuning,
    })
    : 0);

  const tracks = [];

  if (chords.length) {
    const notes = [];
    for (const chord of chords) {
      const program = harmonyInstrument(chord.instrument || instruments.harmony).program;
      for (const midi of chord.voicing) {
        notes.push({
          midi,
          // Chords are not swung in playback either — see audio.js.
          tick: stepToTicks(chord.step, 0, drift('chords', chord.step)),
          durationTicks: Math.max(1, chord.length * TICKS_PER_STEP - 10),
          velocity: 80,
          program,
        });
      }
    }
    tracks.push({ name: 'Chords', channel: 0, notes });
  }

  if (melody.length) {
    tracks.push({
      name: 'Melody',
      channel: 1,
      notes: melody.map((n) => ({
        midi: n.midi,
        tick: stepToTicks(n.step, swing, drift('melody', n.step)),
        durationTicks: Math.max(1, n.length * TICKS_PER_STEP - 8),
        velocity: n.velocity ?? 96,
        program: leadInstrument(n.instrument || instruments.lead).program,
        bend: bendOf('lead', n),
      })),
    });
  }

  if (bass.length) {
    tracks.push({
      name: 'Bass',
      channel: 2,
      notes: bass.map((n) => ({
        midi: n.midi,
        tick: stepToTicks(n.step, swing, drift('bass', n.step)),
        durationTicks: Math.max(1, n.length * TICKS_PER_STEP - 8),
        velocity: n.velocity ?? 100,
        program: bassInstrument(n.instrument || instruments.bass).program,
        bend: bendOf('bass', n),
      })),
    });
  }

  if (drums.length) {
    tracks.push({
      name: 'Drums',
      // Channel 9 is channel 10 in one-based MIDI speak: the drum channel.
      channel: 9,
      notes: drums.map((hit) => ({
        midi: hit.note,
        tick: stepToTicks(hit.step, swing, drift('drums', hit.step, hit.id)),
        durationTicks: Math.round(TICKS_PER_STEP / 2),
        velocity: hit.velocity,
      })),
    });
  }

  return buildMidiFile({ tempo, meter, tracks });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
