// Melody generation over a chord progression, plus the cut-up transforms
// (retrograde, inversion, strip shuffle) that make it feel like the same
// technique applied to notes instead of words.

import { chance, pick, pickWeighted, randInt, shuffle } from '../rng.js';
import { scalePitchClasses } from './theory.js';

/**
 * @typedef {object} Note
 * @property {number} midi
 * @property {number} step   start, in grid steps from the top of the phrase
 * @property {number} length duration in steps
 * @property {number} velocity 1-127
 */

export const MELODY_SHAPES = [
  { id: 'wander', label: 'Wander', hint: 'Mostly steps, the occasional leap.' },
  { id: 'arch', label: 'Arch', hint: 'Rises through the phrase and comes back down.' },
  { id: 'descend', label: 'Descend', hint: 'Falls across the phrase.' },
  { id: 'leaps', label: 'Leaps', hint: 'Angular — wide intervals, chord tones.' },
];

/**
 * @param {object} opts
 * @param {() => number} opts.rng
 * @param {import('./theory.js').Chord[]} opts.chords
 * @param {number} opts.rootPc
 * @param {string} opts.scaleId
 * @param {number} [opts.stepsPerChord]
 * @param {number} [opts.density] 0..1 how many grid steps get a note
 * @param {number} [opts.chordTones] 0..1 pull towards notes in the current chord
 * @param {number} [opts.restiness] 0..1 chance a candidate note becomes a rest
 * @param {string} [opts.shape] one of MELODY_SHAPES
 * @param {[number, number]} [opts.range] MIDI low/high
 * @returns {Note[]}
 */
export function generateMelody(opts) {
  const {
    rng,
    chords = [],
    rootPc = 0,
    scaleId = 'major',
    stepsPerChord = 16,
    density = 0.45,
    chordTones = 0.6,
    restiness = 0.2,
    shape = 'wander',
    range = [60, 84],
  } = opts;

  if (!chords.length) return [];

  const scalePcs = scalePitchClasses(rootPc, scaleId);
  const [low, high] = range;
  const notes = [];
  let current = nearest(low + Math.floor((high - low) / 2), scalePcs, low, high);

  const totalSteps = chords.length * stepsPerChord;

  for (let chordIndex = 0; chordIndex < chords.length; chordIndex++) {
    const chord = chords[chordIndex];
    const chordPcs = chord.intervals.map((i) => (chord.rootPc + i) % 12);

    let step = 0;
    while (step < stepsPerChord) {
      const absolute = chordIndex * stepsPerChord + step;
      const onBeat = step % 4 === 0;
      const hitChance = density * (onBeat ? 1.5 : 0.7);

      if (!chance(rng, hitChance) || chance(rng, restiness * (onBeat ? 0.4 : 1))) {
        step += 1;
        continue;
      }

      const targetPcs = chance(rng, chordTones) ? chordPcs : scalePcs;
      const drift = shapeDrift(shape, absolute, totalSteps, rng);
      current = stepTowards(current, targetPcs, drift, rng, low, high, shape);

      const length = pickWeighted(rng, [
        { value: 1, weight: onBeat ? 1 : 3 },
        { value: 2, weight: 4 },
        { value: 3, weight: 1.5 },
        { value: 4, weight: onBeat ? 3 : 1 },
        { value: 8, weight: onBeat ? 1 : 0 },
      ]);

      notes.push({
        midi: current,
        step: absolute,
        length: Math.min(length, stepsPerChord - step),
        velocity: onBeat ? randInt(rng, 92, 112) : randInt(rng, 70, 96),
      });

      step += Math.max(1, length);
    }
  }

  return notes;
}

/** Bias, in semitones, for where the line should be heading right now. */
function shapeDrift(shape, position, total, rng) {
  const t = total > 0 ? position / total : 0;
  switch (shape) {
    case 'arch':
      return (t < 0.5 ? 1 : -1) * randInt(rng, 1, 3);
    case 'descend':
      return -randInt(rng, 1, 3);
    case 'leaps':
      return chance(rng, 0.5) ? randInt(rng, 4, 9) : -randInt(rng, 4, 9);
    default:
      return chance(rng, 0.5) ? randInt(rng, 1, 2) : -randInt(rng, 1, 2);
  }
}

/** Moves from `from` in the direction of `drift`, landing on an allowed pitch. */
function stepTowards(from, allowedPcs, drift, rng, low, high, shape) {
  let target = from + drift;
  // Bounce off the edges of the range instead of piling up against them.
  if (target > high) target = high - randInt(rng, 0, 4);
  if (target < low) target = low + randInt(rng, 0, 4);
  const landed = nearest(target, allowedPcs, low, high);
  if (landed !== from || shape === 'leaps') return landed;

  // The nearest allowed pitch to a small drift is very often the note we are
  // already sitting on: a triad can be four semitones wide, so every ±1 and ±2
  // rounds straight back. Left alone the line locks onto one pitch and the
  // piano roll draws a flat bar, so walk out to the next allowed pitch instead.
  return nextAllowed(from, allowedPcs, low, high, drift >= 0 ? 1 : -1) ?? landed;
}

/** Closest MIDI note to `target` whose pitch class is allowed. */
function nearest(target, allowedPcs, low, high) {
  let best = null;
  let bestDistance = Infinity;
  for (let midi = low; midi <= high; midi++) {
    if (!allowedPcs.includes(midi % 12)) continue;
    const distance = Math.abs(midi - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = midi;
    }
  }
  return best ?? Math.min(high, Math.max(low, target));
}

/**
 * The first allowed pitch strictly away from `from`, searching in `direction`
 * and turning round at the edge of the range. Null when nothing is allowed.
 */
function nextAllowed(from, allowedPcs, low, high, direction) {
  for (const dir of [direction, -direction]) {
    for (let midi = from + dir; midi >= low && midi <= high; midi += dir) {
      if (allowedPcs.includes(((midi % 12) + 12) % 12)) return midi;
    }
  }
  return null;
}

// --- Cut-up transforms ------------------------------------------------------

export const MELODY_TRANSFORMS = [
  { id: 'retrograde', label: 'Retrograde', hint: 'Play the phrase backwards.' },
  { id: 'invert', label: 'Invert', hint: 'Flip every interval around the first note.' },
  { id: 'shuffle', label: 'Shuffle bars', hint: 'Cut the phrase into bars and reorder them.' },
  { id: 'octave', label: 'Octave jumps', hint: 'Throw random notes up or down an octave.' },
];

/**
 * Applies a cut-up transform to a melody, keeping it inside the grid.
 * @param {Note[]} notes
 * @param {string} transform
 * @param {{rng?: () => number, totalSteps?: number, stepsPerBar?: number, range?: [number, number]}} [opts]
 * @returns {Note[]}
 */
export function transformMelody(notes, transform, opts = {}) {
  const { rng, totalSteps = 64, stepsPerBar = 16, range = [48, 96] } = opts;
  if (!notes.length) return notes;

  if (transform === 'retrograde') {
    return notes
      .map((n) => ({ ...n, step: Math.max(0, totalSteps - n.step - n.length) }))
      .sort((a, b) => a.step - b.step);
  }

  if (transform === 'invert') {
    const pivot = notes[0].midi;
    return notes.map((n) => ({
      ...n,
      midi: clampMidi(pivot - (n.midi - pivot), range),
    }));
  }

  if (transform === 'shuffle' && rng) {
    const barCount = Math.max(1, Math.ceil(totalSteps / stepsPerBar));
    const bars = Array.from({ length: barCount }, () => []);
    for (const note of notes) {
      const bar = Math.min(barCount - 1, Math.floor(note.step / stepsPerBar));
      bars[bar].push({ ...note, step: note.step - bar * stepsPerBar });
    }
    return shuffle(rng, bars)
      .flatMap((bar, index) => bar.map((n) => ({ ...n, step: n.step + index * stepsPerBar })))
      .sort((a, b) => a.step - b.step);
  }

  if (transform === 'octave' && rng) {
    return notes.map((n) => (chance(rng, 0.25)
      ? { ...n, midi: clampMidi(n.midi + pick(rng, [-12, 12]), range) }
      : n));
  }

  return notes;
}

function clampMidi(midi, [low, high]) {
  let out = midi;
  while (out < low) out += 12;
  while (out > high) out -= 12;
  return Math.min(127, Math.max(0, out));
}
