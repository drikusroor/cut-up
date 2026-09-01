// Rolling a section again, in whole or in part.
//
// A saved section is a frozen set of *settings* as much as a frozen set of
// notes — the key, the shape of the melody, how dense the drums are, which
// seed everything came off. That means it can be rolled again without being
// rebuilt by hand: keep the settings, change the seeds, and out comes another
// take of the same idea.
//
// Which is where the two halves of the button come from. Pressing the left
// half rolls the lot. Pressing the right half opens the same machinery with
// the aspects laid out, so you can keep the chords you like and roll only the
// tune over them, or keep everything and move the whole thing into another key.

import { makeRng, randomSeed } from '../rng.js';
import {
  diatonicChord, generateProgression, SCALES, voiceProgression,
} from './theory.js';
import { applyMelodyEdits, emptyMelodyEdits, generateMelody } from './melody.js';
import { generateBass } from './bass.js';
import { generateRhythm } from './rhythm.js';
import { meterInfo } from './meter.js';
import {
  BASS_INSTRUMENTS, DRUM_KITS, HARMONY_INSTRUMENTS, LEAD_INSTRUMENTS, resolveInstruments,
} from './instruments.js';
import { clone } from './sections.js';
import { applyVariations, pruneStaleTraits } from './variations.js';

/**
 * What can be rolled again, and what happens to everything else when it is.
 *
 * The order is the order they are generated in, which is also the order they
 * depend on each other: chords under the melody, the melody and the drums
 * under the bass.
 */
export const REGEN_ASPECTS = [
  {
    id: 'chords',
    label: 'Chords',
    hint: 'A new progression, same length, same key unless you change it. '
      + 'A section written without chords stays without them.',
  },
  {
    id: 'melody',
    label: 'Melody',
    hint: 'A new tune over whatever the chords are. Notes you dragged by hand go with it.',
  },
  {
    id: 'bass',
    label: 'Bass',
    hint: 'A new bass line, written against the drums and the tune.',
  },
  {
    id: 'drums',
    label: 'Rhythm',
    hint: 'A new drum pattern, same style and density.',
  },
  {
    id: 'instruments',
    label: 'Instruments',
    hint: 'New voices for the four players. Nothing about the notes changes.',
  },
];

export const ASPECT_IDS = REGEN_ASPECTS.map((aspect) => aspect.id);

/** Everything, which is what the left half of the button asks for. */
export function allAspects() {
  return [...ASPECT_IDS];
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

/** A voice that is not the one it already has, so a reroll is audibly a reroll. */
function otherThan(rng, list, current) {
  const options = list.filter((item) => item.id !== current);
  return pick(rng, options.length ? options : list).id;
}

/**
 * The seeds one regeneration uses.
 *
 * With no seed given, every aspect gets its own fresh roll — which is what
 * pressing the button means. With one given, they are derived from it, so the
 * same seed on the same section is the same take twice: a regeneration you can
 * write down and get back.
 */
function seedsFor(seed) {
  if (!seed) {
    return {
      chords: randomSeed(), melody: randomSeed(), bass: randomSeed(), rhythm: randomSeed(), voices: randomSeed(),
    };
  }
  return {
    chords: `${seed}·chords`,
    melody: `${seed}·mel`,
    bass: `${seed}·bass`,
    rhythm: `${seed}·drums`,
    voices: `${seed}·voices`,
  };
}

/** Chords, melody and bass moved bodily into another key. */
function transposeBy(music, semitones) {
  const shift = ((semitones % 12) + 12) % 12;
  if (!shift) return music;
  const move = (note) => ({ ...note, midi: note.midi + (shift > 6 ? shift - 12 : shift) });
  return {
    ...music,
    chords: (music.chords || []).map((chord) => ({ ...chord, rootPc: (chord.rootPc + shift) % 12 })),
    melodyBase: (music.melodyBase || []).map(move),
    melody: (music.melody || []).map(move),
    bass: (music.bass || []).map(move),
  };
}

/**
 * Rolls a section again.
 *
 * Everything not asked for is left exactly as it was, notes and all — this is
 * the point of the advanced half of the button. What *is* asked for is
 * generated from the section's own settings, so a rerolled chorus is still
 * that chorus's kind of chorus: same length, same density, same shape of tune,
 * different roll of the dice.
 *
 * The section's identity is kept — same id, same name, same role, same place in
 * the running order — because regenerating a section is an edit to it and not a
 * new one appearing next to it.
 *
 * @param {object} section a section from the drawer
 * @param {object} [options]
 * @param {string[]} [options.aspects] which of REGEN_ASPECTS to roll
 * @param {number} [options.rootPc] move it to another key
 * @param {string} [options.scaleId] and another mode, which forces new chords
 * @param {object} [options.meter] count it in another bar
 * @param {object} [options.variations] the composer's own moves, as controls —
 *   see music/variations.js. Switches and dials are set outright; moves are
 *   applied and then whatever they disturbed is rolled again, whether or not
 *   you asked for it, because a busier section with the old tune on it is not
 *   busier.
 * @param {string} [options.seed] roll it reproducibly
 * @returns {object} a new section object — the caller decides where it goes
 */
export function regenerateSection(section, options = {}) {
  const {
    aspects = allAspects(), rootPc, scaleId, meter, seed = '', variations = null,
  } = options;
  const wanted = new Set(aspects);
  const seeds = seedsFor(seed);

  const source = clone(section);

  // The variations go on first, because everything below is generated *from*
  // the settings they change: asking for a section held back and then writing
  // its drums against the old density would be writing the wrong drums.
  const edit = variations
    ? applyVariations(source, variations, { rng: makeRng(`vary:${seeds.voices}`) })
    : { rolls: new Set(), enables: new Set(), regrid: false };
  for (const aspect of edit.rolls) wanted.add(aspect);

  let music = { ...source.music };
  // A section that has no harmony was written that way — the drums-only count-in
  // the composer puts at the top of a song — and rolling it again must not
  // quietly hand it a progression. The same goes for one with no tune. Rolling
  // a section changes what it is made of, never what it is.
  const hasChords = (source.music.chords || []).length > 0;
  const hasMelody = edit.enables.has('melody')
    || (source.music.melodyBase || []).length > 0
    || (source.music.melody || []).length > 0;
  const rhythm = { ...source.rhythm };
  const bar = meter || source.meter || null;
  const grid = meterInfo(bar || { beats: 4, unit: 4 });

  // The key. A different tonic in the same mode can simply be moved into —
  // which is a thing you want, because a chorus a fourth up is the same chorus.
  // A different mode cannot: it is a different set of chords by definition.
  const toRoot = Number.isFinite(rootPc) ? ((rootPc % 12) + 12) % 12 : music.rootPc;
  const toScale = scaleId && SCALES.some((s) => s.id === scaleId) ? scaleId : music.scaleId;
  const modeChanged = toScale !== music.scaleId;
  const keyMoved = toRoot !== music.rootPc;
  if (keyMoved && !modeChanged && !wanted.has('chords')) {
    music = transposeBy(music, toRoot - music.rootPc);
  }
  // Nothing can be moved into another mode; it has to be written there.
  if (modeChanged) wanted.add('chords');
  music.rootPc = toRoot;
  music.scaleId = toScale;
  // A new bar, or a variation that changed how long a chord is held, means the
  // grid under the whole section has moved.
  if (bar || edit.regrid) {
    music.stepsPerChord = Math.max(1, Math.round(grid.stepsPerBar * (music.barsPerChord || 1)));
  }

  // --- chords ---------------------------------------------------------------

  if (wanted.has('chords') && hasChords) {
    music.chordSeed = seeds.chords;
    const fresh = generateProgression({
      rng: makeRng(`chords:${seeds.chords}`),
      rootPc: music.rootPc,
      scaleId: music.scaleId,
      length: music.length,
      mode: music.mode === 'cutup' ? 'functional' : music.mode,
      sevenths: music.sevenths,
      spice: music.spice,
    });
    // A coda that was written to land on the tonic goes on landing on it.
    const endsHome = source.kind === 'outro' && (source.music.chords || []).length;
    music.chords = fresh;
    if (endsHome && music.chords.length) {
      music.chords[music.chords.length - 1] = diatonicChord(music.rootPc, music.scaleId, 0, false);
    }
    music.locked = [];
  }
  music.voicings = music.chords?.length ? voiceProgression(music.chords, { octave: 3 }) : [];

  // --- drums ----------------------------------------------------------------

  if (wanted.has('drums')) {
    rhythm.seed = seeds.rhythm;
    rhythm.steps = grid.stepsPerBar;
    rhythm.pattern = generateRhythm({
      rng: makeRng(`rhythm:${seeds.rhythm}`),
      meter: bar || undefined,
      steps: grid.stepsPerBar,
      bars: rhythm.bars,
      style: rhythm.style,
      density: rhythm.density,
      variation: rhythm.variation,
      trackIds: rhythm.trackIds,
    });
  }

  // --- melody ---------------------------------------------------------------

  const totalSteps = Math.max(
    grid.stepsPerBar,
    (music.chords?.length || 0) * (music.stepsPerChord || grid.stepsPerBar),
  );

  if (wanted.has('melody') && hasMelody && music.chords?.length) {
    music.melodySeed = seeds.melody;
    music.melodyBase = generateMelody({
      rng: makeRng(`melody:${seeds.melody}`),
      chords: music.chords,
      rootPc: music.rootPc,
      scaleId: music.scaleId,
      stepsPerChord: music.stepsPerChord,
      stepsPerBeat: grid.pulse,
      density: music.density,
      chordTones: music.chordTones,
      restiness: music.restiness,
      shape: music.melodyShape,
      range: [music.rangeLow, music.rangeHigh],
    });
    // Deltas aimed at notes that have gone would land on strangers, so a new
    // line arrives without the old hand edits — exactly as it does on the
    // Chords tab.
    music.melodyEdits = emptyMelodyEdits();
  }
  music.melody = applyMelodyEdits(music.melodyBase || [], music.melodyEdits, { totalSteps });

  // --- bass -----------------------------------------------------------------

  if (wanted.has('bass') && music.bassOn !== false && music.chords?.length) {
    music.bassSeed = seeds.bass;
    music.bass = generateBass({
      rng: makeRng(`bass:${seeds.bass}`),
      chords: music.chords,
      rootPc: music.rootPc,
      scaleId: music.scaleId,
      stepsPerChord: music.stepsPerChord,
      stepsPerBeat: grid.pulse,
      style: music.bassStyle,
      density: music.bassDensity,
      motion: music.bassMotion,
      counter: music.bassCounter,
      octave: music.bassOctave,
      rhythm: rhythm.pattern,
      melody: music.melody,
    });
  }

  // --- instruments ----------------------------------------------------------

  if (wanted.has('instruments')) {
    const rng = makeRng(`voices:${seeds.voices}`);
    // What it sounds like *now*, which is what the new voices have to differ
    // from — a section left on "from the seed" has voices even though it has
    // not chosen any.
    const current = resolveInstruments(source.music, source.rhythm);
    music.leadInstrument = otherThan(rng, LEAD_INSTRUMENTS, current.lead);
    music.harmonyInstrument = otherThan(rng, HARMONY_INSTRUMENTS, current.harmony);
    music.bassInstrument = otherThan(rng, BASS_INSTRUMENTS, current.bass);
    rhythm.kit = otherThan(rng, DRUM_KITS, current.kit);
  }

  const rolled = {
    ...source,
    music,
    rhythm,
    ...(bar ? { meter: clone(bar) } : {}),
    savedAt: Date.now(),
  };

  // Now that the parts have actually been written, anything the section still
  // claims about what it is missing can be checked against what it has. This
  // has to happen here rather than while the variations were applied: a section
  // told to have a tune has not got one yet at that point.
  const traits = pruneStaleTraits(rolled);
  if (traits.length) rolled.traits = traits;
  else delete rolled.traits;

  return rolled;
}

/** "chords, melody and bass" — what a regeneration is about to touch. */
export function describeAspects(aspects = []) {
  const labels = REGEN_ASPECTS.filter((a) => aspects.includes(a.id)).map((a) => a.label.toLowerCase());
  if (!labels.length) return 'nothing';
  if (labels.length === REGEN_ASPECTS.length) return 'everything';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
