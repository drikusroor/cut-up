// Chord and scale theory: enough to generate progressions that sound like
// music, and to cut up progressions you already have.
//
// Pitches are MIDI numbers (60 = middle C). Pitch classes are 0-11 from C.

import { chance, pick, pickWeighted, randInt, shuffle } from '../rng.js';

export const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Keys that read better with flats than sharps. */
const FLAT_KEYS = new Set([1, 3, 5, 8, 10]);

export const SCALES = [
  { id: 'major', label: 'Major (Ionian)', steps: [0, 2, 4, 5, 7, 9, 11] },
  { id: 'minor', label: 'Natural minor (Aeolian)', steps: [0, 2, 3, 5, 7, 8, 10] },
  { id: 'dorian', label: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10] },
  { id: 'phrygian', label: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10] },
  { id: 'lydian', label: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11] },
  { id: 'mixolydian', label: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10] },
  { id: 'locrian', label: 'Locrian', steps: [0, 1, 3, 5, 6, 8, 10] },
  { id: 'harmonicMinor', label: 'Harmonic minor', steps: [0, 2, 3, 5, 7, 8, 11] },
  { id: 'melodicMinor', label: 'Melodic minor', steps: [0, 2, 3, 5, 7, 9, 11] },
  { id: 'majorPentatonic', label: 'Major pentatonic', steps: [0, 2, 4, 7, 9] },
  { id: 'minorPentatonic', label: 'Minor pentatonic', steps: [0, 3, 5, 7, 10] },
  { id: 'blues', label: 'Blues', steps: [0, 3, 5, 6, 7, 10] },
];

export const CHORD_TYPES = [
  { id: 'maj', suffix: '', intervals: [0, 4, 7] },
  { id: 'min', suffix: 'm', intervals: [0, 3, 7] },
  { id: 'dim', suffix: 'dim', intervals: [0, 3, 6] },
  { id: 'aug', suffix: 'aug', intervals: [0, 4, 8] },
  { id: 'sus2', suffix: 'sus2', intervals: [0, 2, 7] },
  { id: 'sus4', suffix: 'sus4', intervals: [0, 5, 7] },
  { id: 'maj7', suffix: 'maj7', intervals: [0, 4, 7, 11] },
  { id: 'min7', suffix: 'm7', intervals: [0, 3, 7, 10] },
  { id: 'dom7', suffix: '7', intervals: [0, 4, 7, 10] },
  { id: 'min7b5', suffix: 'm7b5', intervals: [0, 3, 6, 10] },
  { id: 'dim7', suffix: 'dim7', intervals: [0, 3, 6, 9] },
  { id: 'minMaj7', suffix: 'mMaj7', intervals: [0, 3, 7, 11] },
  { id: 'maj6', suffix: '6', intervals: [0, 4, 7, 9] },
  { id: 'min6', suffix: 'm6', intervals: [0, 3, 7, 9] },
  { id: 'add9', suffix: 'add9', intervals: [0, 4, 7, 14] },
  { id: 'madd9', suffix: 'madd9', intervals: [0, 3, 7, 14] },
];

const TYPE_BY_ID = new Map(CHORD_TYPES.map((t) => [t.id, t]));

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function getScale(id) {
  return SCALES.find((s) => s.id === id) || SCALES[0];
}

export function noteName(pc, useFlats = false) {
  const names = useFlats ? FLAT_NAMES : SHARP_NAMES;
  return names[((pc % 12) + 12) % 12];
}

export function keyUsesFlats(rootPc, scaleId) {
  const minorish = ['minor', 'dorian', 'phrygian', 'harmonicMinor', 'melodicMinor', 'minorPentatonic'];
  return FLAT_KEYS.has(((rootPc % 12) + 12) % 12) || (minorish.includes(scaleId) && FLAT_KEYS.has((rootPc + 3) % 12));
}

/** Pitch classes of a scale, in order. */
export function scalePitchClasses(rootPc, scaleId) {
  return getScale(scaleId).steps.map((s) => (rootPc + s) % 12);
}

/**
 * Builds the diatonic chord on a scale degree by stacking thirds inside the
 * scale, then naming whatever interval set falls out.
 *
 * @param {number} rootPc key root pitch class
 * @param {string} scaleId
 * @param {number} degree 0-based scale degree
 * @param {boolean} [seventh] stack a fourth note
 */
export function diatonicChord(rootPc, scaleId, degree, seventh = false) {
  const steps = getScale(scaleId).steps;
  const size = steps.length;
  const pick3 = [0, 2, 4].concat(seventh ? [6] : []);
  const semis = pick3.map((offset) => {
    const idx = (degree + offset) % size;
    const octaves = Math.floor((degree + offset) / size);
    return steps[idx] + 12 * octaves;
  });
  const base = semis[0];
  const intervals = semis.map((s) => s - base);
  const chordRootPc = (rootPc + (base % 12) + 12) % 12;
  const type = matchChordType(intervals);
  return makeChord(chordRootPc, type, {
    degree,
    roman: romanFor(degree, type),
  });
}

/** Finds the closest named chord type for a set of intervals from the root. */
export function matchChordType(intervals) {
  const norm = [...new Set(intervals.map((i) => ((i % 12) + 12) % 12))].sort((a, b) => a - b);
  const key = norm.join(',');
  for (const type of CHORD_TYPES) {
    const t = [...new Set(type.intervals.map((i) => i % 12))].sort((a, b) => a - b).join(',');
    if (t === key) return type;
  }
  // Unnamed stack (happens in exotic scales) — describe it by its third/fifth.
  const third = norm.includes(4) ? 'maj' : 'min';
  return TYPE_BY_ID.get(third);
}

function makeChord(rootPc, type, extra = {}) {
  return {
    rootPc,
    typeId: type.id,
    intervals: type.intervals.slice(),
    beats: 4,
    ...extra,
  };
}

/** Human-readable chord symbol, e.g. "Bbmaj7". */
export function chordSymbol(chord, useFlats = false) {
  const type = TYPE_BY_ID.get(chord.typeId);
  return noteName(chord.rootPc, useFlats) + (type ? type.suffix : '');
}

function romanFor(degree, type) {
  const base = ROMAN[degree % 7] ?? ROMAN[0];
  const minorish = ['min', 'min7', 'dim', 'min7b5', 'dim7', 'min6', 'madd9', 'minMaj7'].includes(type.id);
  let numeral = minorish ? base.toLowerCase() : base;
  if (type.id === 'dim' || type.id === 'dim7') numeral += '°';
  else if (type.id === 'min7b5') numeral += 'ø7';
  else if (type.id === 'aug') numeral += '+';
  else if (type.id === 'maj7') numeral += 'maj7';
  else if (type.id === 'dom7') numeral += '7';
  else if (type.id === 'min7') numeral += '7';
  else if (type.id.startsWith('sus')) numeral += type.suffix;
  else if (type.id === 'maj6' || type.id === 'min6') numeral += '6';
  else if (type.id.endsWith('add9')) numeral += 'add9';
  return numeral;
}

// --- Progression generation -------------------------------------------------

// Rough functional pull between scale degrees. Not a rulebook, just a bias:
// tonic wanders, subdominant leans to dominant, dominant wants home.
const MAJOR_TRANSITIONS = [
  /* I   */ [1, 2, 2, 4, 4, 4, 1],
  /* ii  */ [1, 1, 1, 2, 5, 1, 1],
  /* iii */ [2, 1, 1, 4, 2, 3, 1],
  /* IV  */ [3, 2, 1, 1, 5, 1, 1],
  /* V   */ [6, 1, 1, 2, 1, 3, 1],
  /* vi  */ [2, 3, 1, 4, 3, 1, 1],
  /* vii */ [5, 1, 1, 1, 2, 1, 1],
];

const MINOR_TRANSITIONS = [
  /* i    */ [1, 2, 3, 3, 3, 3, 2],
  /* ii°  */ [1, 1, 1, 1, 4, 1, 1],
  /* III  */ [3, 1, 1, 2, 2, 3, 2],
  /* iv   */ [3, 1, 1, 1, 4, 2, 2],
  /* v/V  */ [6, 1, 1, 1, 1, 2, 1],
  /* VI   */ [2, 1, 2, 2, 3, 1, 2],
  /* VII  */ [4, 1, 3, 1, 2, 2, 1],
];

const MINORISH_SCALES = new Set(['minor', 'dorian', 'phrygian', 'harmonicMinor', 'melodicMinor', 'locrian']);

export const PROGRESSION_MODES = [
  { id: 'functional', label: 'Functional', hint: 'Weighted by how chords normally pull towards each other.' },
  { id: 'random', label: 'Pure chance', hint: 'Any diatonic chord, no memory. Burroughs would approve.' },
  { id: 'vamp', label: 'Modal vamp', hint: 'Two or three chords, looped and mutated.' },
  { id: 'cutup', label: 'Cut up my chords', hint: 'Shuffle a progression you paste in.' },
];

/**
 * @param {object} opts
 * @param {() => number} opts.rng
 * @param {number} opts.rootPc
 * @param {string} opts.scaleId
 * @param {number} opts.length number of chords
 * @param {string} [opts.mode] one of PROGRESSION_MODES
 * @param {number} [opts.sevenths] 0..1 chance a chord gets a 7th
 * @param {number} [opts.spice] 0..1 chance of a borrowed / chromatic chord
 * @param {Chord[]} [opts.source] chords to cut up, for mode 'cutup'
 * @returns {Chord[]}
 */
export function generateProgression(opts) {
  const {
    rng,
    rootPc = 0,
    scaleId = 'major',
    length = 4,
    mode = 'functional',
    sevenths = 0.2,
    spice = 0.15,
    source = [],
  } = opts;

  if (mode === 'cutup') return cutUpProgression(source, rng, length);

  const scaleSize = getScale(scaleId).steps.length;
  const degrees = [];

  if (mode === 'vamp') {
    const cell = [];
    const cellSize = randInt(rng, 2, 3);
    for (let i = 0; i < cellSize; i++) {
      cell.push(i === 0 ? 0 : randInt(rng, 1, scaleSize - 1));
    }
    for (let i = 0; i < length; i++) {
      const d = cell[i % cell.length];
      // Occasionally nudge a repeat of the cell somewhere else.
      degrees.push(i >= cell.length && chance(rng, 0.2) ? randInt(rng, 0, scaleSize - 1) : d);
    }
  } else if (mode === 'random') {
    degrees.push(0);
    for (let i = 1; i < length; i++) degrees.push(randInt(rng, 0, scaleSize - 1));
  } else {
    const table = MINORISH_SCALES.has(scaleId) ? MINOR_TRANSITIONS : MAJOR_TRANSITIONS;
    let current = 0;
    degrees.push(current);
    for (let i = 1; i < length; i++) {
      const row = table[current % table.length];
      const entries = row
        .map((weight, degree) => ({ value: degree, weight }))
        .filter((e) => e.value < scaleSize && e.value !== current);
      current = entries.length ? pickWeighted(rng, entries) : randInt(rng, 0, scaleSize - 1);
      degrees.push(current);
    }
  }

  return degrees.map((degree, i) => {
    let chord = diatonicChord(rootPc, scaleId, degree, chance(rng, sevenths));
    if (i > 0 && chance(rng, spice)) chord = spiceChord(chord, rootPc, scaleId, rng);
    return chord;
  });
}

/** Swaps in a borrowed, chromatic or suspended version of a chord. */
function spiceChord(chord, rootPc, scaleId, rng) {
  const move = pick(rng, ['borrow', 'secondary', 'sus', 'shift']);
  const type = TYPE_BY_ID.get(chord.typeId);
  if (move === 'sus') {
    const susType = TYPE_BY_ID.get(chance(rng, 0.5) ? 'sus4' : 'sus2');
    return { ...chord, typeId: susType.id, intervals: susType.intervals.slice(), roman: `${chord.roman}${susType.suffix}`, altered: true };
  }
  if (move === 'borrow') {
    // Flip major <-> minor quality: the modal interchange trick.
    const toMajor = type?.id === 'min' || type?.id === 'min7';
    const flipped = TYPE_BY_ID.get(toMajor ? 'maj' : 'min');
    return {
      ...chord,
      typeId: flipped.id,
      intervals: flipped.intervals.slice(),
      // The numeral has to change case with the quality, or it reads as a lie.
      roman: `${recase(chord.roman, toMajor)}*`,
      altered: true,
    };
  }
  if (move === 'secondary') {
    // V of whatever comes next-ish: a dominant a fifth above this chord.
    const dom = TYPE_BY_ID.get('dom7');
    return {
      ...chord,
      rootPc: (chord.rootPc + 7) % 12,
      typeId: dom.id,
      intervals: dom.intervals.slice(),
      roman: `V7/${chord.roman}`,
      altered: true,
    };
  }
  // Chromatic side-step, a semitone off the diatonic root.
  const dir = chance(rng, 0.5) ? 1 : -1;
  return {
    ...chord,
    rootPc: (chord.rootPc + dir + 12) % 12,
    roman: `${dir > 0 ? '#' : 'b'}${chord.roman}`,
    altered: true,
  };
}

/** Recases the roman-numeral part of a label, dropping any quality suffix. */
function recase(roman, toUpper) {
  const match = /^[#b]?([ivIV]+)/.exec(roman || '');
  if (!match) return roman || '';
  const prefix = roman.startsWith('#') || roman.startsWith('b') ? roman[0] : '';
  return prefix + (toUpper ? match[1].toUpperCase() : match[1].toLowerCase());
}

/** Cuts a given progression into strips and reshuffles them. */
export function cutUpProgression(chords, rng, length) {
  if (!chords.length) return [];
  const strips = [];
  let i = 0;
  while (i < chords.length) {
    const size = randInt(rng, 1, 2);
    strips.push(chords.slice(i, i + size));
    i += size;
  }
  const shuffled = shuffle(rng, strips).flat();
  const out = [];
  while (out.length < length) out.push({ ...shuffled[out.length % shuffled.length] });
  return out.slice(0, length);
}

// --- Voicing ----------------------------------------------------------------

/**
 * Turns chords into MIDI notes, picking the inversion nearest the previous
 * chord so the voices don't leap around.
 *
 * @param {Chord[]} chords
 * @param {{octave?: number, voiceLead?: boolean}} [opts]
 * @returns {number[][]} MIDI note numbers per chord
 */
export function voiceProgression(chords, opts = {}) {
  const { octave = 4, voiceLead = true } = opts;
  const base = 12 * (octave + 1); // MIDI octave numbering: C4 = 60
  let previous = null;
  return chords.map((chord) => {
    const root = base + chord.rootPc;
    let best = chord.intervals.map((i) => root + i);
    if (voiceLead && previous) {
      let bestCost = Infinity;
      for (let inversion = 0; inversion < chord.intervals.length; inversion++) {
        for (const shift of [-12, 0, 12]) {
          const notes = invert(chord.intervals, inversion).map((i) => root + i + shift);
          const cost = voiceCost(previous, notes);
          if (cost < bestCost) {
            bestCost = cost;
            best = notes;
          }
        }
      }
    }
    previous = best;
    return best;
  });
}

function invert(intervals, times) {
  const out = intervals.slice();
  for (let i = 0; i < times; i++) out.push(out.shift() + 12);
  return out.sort((a, b) => a - b);
}

function voiceCost(a, b) {
  const size = Math.min(a.length, b.length);
  let cost = 0;
  for (let i = 0; i < size; i++) cost += Math.abs(a[i] - b[i]);
  // Keep the voicing in a comfortable register.
  const centre = b.reduce((s, n) => s + n, 0) / b.length;
  cost += Math.abs(centre - 62) * 0.5;
  return cost;
}

// --- Parsing ----------------------------------------------------------------

const SUFFIX_LOOKUP = [
  ['maj7', 'maj7'], ['ma7', 'maj7'], ['M7', 'maj7'], ['Δ7', 'maj7'], ['Δ', 'maj7'],
  ['m7b5', 'min7b5'], ['min7b5', 'min7b5'], ['ø7', 'min7b5'], ['ø', 'min7b5'],
  ['dim7', 'dim7'], ['°7', 'dim7'], ['dim', 'dim'], ['°', 'dim'],
  ['mMaj7', 'minMaj7'], ['mM7', 'minMaj7'],
  ['madd9', 'madd9'], ['add9', 'add9'],
  ['sus2', 'sus2'], ['sus4', 'sus4'], ['sus', 'sus4'],
  ['aug', 'aug'], ['+', 'aug'],
  ['min7', 'min7'], ['m7', 'min7'], ['-7', 'min7'],
  ['min6', 'min6'], ['m6', 'min6'],
  ['min', 'min'], ['m', 'min'], ['-', 'min'],
  ['maj6', 'maj6'], ['6', 'maj6'],
  ['7', 'dom7'],
  ['maj', 'maj'], ['M', 'maj'], ['', 'maj'],
];

const PITCH_CLASS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * Parses a chord line like "Am7 | F  Cmaj7 G7" into chord objects.
 * Unparseable tokens are skipped.
 * @returns {Chord[]}
 */
export function parseChords(input) {
  if (!input) return [];
  const tokens = input.split(/[\s|,>/\n]+/).map((t) => t.trim()).filter(Boolean);
  const out = [];
  for (const token of tokens) {
    const match = /^([A-Ga-g])([#b♯♭]?)(.*)$/.exec(token);
    if (!match) continue;
    const [, letter, accidental, rest] = match;
    let pc = PITCH_CLASS[letter.toLowerCase()];
    if (accidental === '#' || accidental === '♯') pc += 1;
    if (accidental === 'b' || accidental === '♭') pc -= 1;
    pc = ((pc % 12) + 12) % 12;

    // Case matters here: "M7" is a major seventh, "m7" is a minor one. Only
    // fall back to a loose match when nothing matches exactly.
    const entry = SUFFIX_LOOKUP.find(([suffix]) => suffix === rest)
      || SUFFIX_LOOKUP.find(([suffix]) => suffix.toLowerCase() === rest.toLowerCase());
    const type = TYPE_BY_ID.get(entry ? entry[1] : 'maj');
    out.push(makeChord(pc, type, { roman: '', degree: null }));
  }
  return out;
}
