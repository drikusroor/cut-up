// A minimal type-1 MIDI writer, so anything the app generates can be dragged
// straight into a DAW. No dependencies — MIDI is just bytes.

import { arrange } from './arrange.js';

const TICKS_PER_QUARTER = 480;
const STEPS_PER_QUARTER = 4; // the app works on a sixteenth-note grid
export const TICKS_PER_STEP = TICKS_PER_QUARTER / STEPS_PER_QUARTER;

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
 * @param {{name?: string, channel?: number, tempo?: number, notes: Array<{midi:number, tick:number, durationTicks:number, velocity?:number}>}} track
 */
function trackChunk(track) {
  const { name, channel = 0, tempo, notes = [] } = track;
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

  for (const note of notes) {
    const midi = clamp(Math.round(note.midi), 0, 127);
    const velocity = clamp(Math.round(note.velocity ?? 96), 1, 127);
    const start = Math.max(0, Math.round(note.tick));
    const end = start + Math.max(1, Math.round(note.durationTicks));
    events.push({ tick: start, order: 2, bytes: [0x90 | channel, midi, velocity] });
    events.push({ tick: end, order: 1, bytes: [0x80 | channel, midi, 0] });
  }

  // Note-offs go before note-ons at the same tick, so repeated notes retrigger.
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
 * @param {{tempo?: number, tracks: Array<{name?: string, channel?: number, notes: any[]}>}} song
 * @returns {Uint8Array}
 */
export function buildMidiFile(song) {
  const { tempo = 100, tracks = [] } = song;
  const chunks = [];
  // Track 0 carries the tempo map, which is the type-1 convention.
  chunks.push(trackChunk({ name: 'Tempo', tempo, notes: [] }));
  for (const track of tracks) chunks.push(trackChunk(track));

  const header = chunk('MThd', [
    0x00, 0x01,
    0x00, chunks.length,
    (TICKS_PER_QUARTER >> 8) & 0xff, TICKS_PER_QUARTER & 0xff,
  ]);

  return Uint8Array.from([...header, ...chunks.flat()]);
}

/** Converts a step index to ticks, applying the same swing as playback. */
export function stepToTicks(step, swing = 0) {
  const offset = step % 2 === 1 ? TICKS_PER_STEP * swing * 0.5 : 0;
  return Math.round(step * TICKS_PER_STEP + offset);
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
 * @param {{steps:number, bars:number, tracks:Array<{note:number, pattern:boolean[], velocities:number[]}>}} [song.rhythm]
 * @returns {Uint8Array}
 */
export function songToMidi(song) {
  const { tempo = 100, swing = 0 } = song;
  // Same layout the audio engine plays, so the export is what you just heard.
  const { chords, melody, drums } = arrange(song);

  const tracks = [];

  if (chords.length) {
    const notes = [];
    for (const chord of chords) {
      for (const midi of chord.voicing) {
        notes.push({
          midi,
          tick: stepToTicks(chord.step, 0),
          durationTicks: Math.max(1, chord.length * TICKS_PER_STEP - 10),
          velocity: 80,
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
        tick: stepToTicks(n.step, swing),
        durationTicks: Math.max(1, n.length * TICKS_PER_STEP - 8),
        velocity: n.velocity ?? 96,
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
        tick: stepToTicks(hit.step, swing),
        durationTicks: Math.round(TICKS_PER_STEP / 2),
        velocity: hit.velocity,
      })),
    });
  }

  return buildMidiFile({ tempo, tracks });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
