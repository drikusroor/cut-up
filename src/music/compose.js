// The composer: the machine that writes a whole song rather than a loop.
//
// Everything else in this app makes one idea at a time — a progression, a line,
// a bar of drums. A song is not more of that; it is *contrast and return*. A
// verse sets something up, the next part goes somewhere else, and then the
// first thing comes back and means more than it did. The Beatles did it with a
// middle eight that changes key, or drops to the relative minor, or arrives in
// a different time signature, or is simply louder and busier than the verse
// around it. Mozart did the same trick with a rondo: A, then somewhere else,
// then A again, and the A you hear the third time is not quite the A you heard
// the first.
//
// So this module does three things:
//
//   1. picks a *shape* — AABA, ABABCB, ABACA — and works out how long each
//      part has to be for the whole thing to last as long as you asked;
//   2. writes each letter as a section, with every letter after the first
//      pulled deliberately away from the home one: another key, another mode,
//      another kit, quieter, busier, in three instead of four, a shade faster;
//   3. decorates the repeats — because a chorus that comes back a semitone
//      higher, or with the drums dropped out, is the oldest trick there is —
//      and puts an intro on the front and a coda on the end.
//
// What comes out is an ordinary drawer of sections and an ordinary running
// order. Everything is editable afterwards, every section keeps its seeds, and
// the same composition seed always writes the same song back.

import {
  chance, makeRng, pick, pickWeighted, randInt, randomSeed, shuffle,
} from '../rng.js';
import {
  diatonicChord, generateProgression, getScale, keyLabel, voiceProgression,
} from './theory.js';
import { applyMelodyEdits, emptyMelodyEdits, generateMelody } from './melody.js';
import { generateBass } from './bass.js';
import { generateRhythm, randomKitPieces } from './rhythm.js';
import { DEFAULT_METER, meterInfo, normalizeMeter } from './meter.js';
import {
  BASS_INSTRUMENTS, DRUM_KITS, HARMONY_INSTRUMENTS, LEAD_INSTRUMENTS,
} from './instruments.js';
import { makeSection } from './sections.js';

/** Scales that behave like a minor: the ones a relative major is measured from. */
const MINORISH = new Set(['minor', 'dorian', 'phrygian', 'harmonicMinor', 'melodicMinor', 'locrian', 'minorPentatonic', 'blues']);

/** How many distinct letters a song may be built from. */
export const LETTER_RANGE = [2, 6];

/** How long a song may be asked to last, in minutes. */
export const MINUTES_RANGE = [0.5, 12];

/**
 * The shapes. Each is a list of letter indices, so `[0, 0, 1, 0]` is AABA and
 * `[0, 1, 0, 1, 2, 1]` is verse, chorus, verse, chorus, middle eight, chorus.
 * They are grouped by how many distinct letters they need, because that is the
 * thing you actually choose: two ideas, three ideas, six.
 */
export const FORMS = [
  { id: 'aaba', label: 'AABA — the standard', letters: 2, shape: [0, 0, 1, 0], weight: 3 },
  { id: 'abab', label: 'ABAB — verse, chorus, verse, chorus', letters: 2, shape: [0, 1, 0, 1], weight: 3 },
  { id: 'ababb', label: 'ABABB — and the chorus twice at the end', letters: 2, shape: [0, 1, 0, 1, 1], weight: 2 },
  { id: 'aabba', label: 'AABBA — leaning on both', letters: 2, shape: [0, 0, 1, 1, 0], weight: 1 },
  { id: 'ab', label: 'AB — one of each', letters: 2, shape: [0, 1], weight: 1 },

  { id: 'ababcb', label: 'ABABCB — verse, chorus, middle eight', letters: 3, shape: [0, 1, 0, 1, 2, 1], weight: 4 },
  { id: 'abaca', label: 'ABACA — rondo', letters: 3, shape: [0, 1, 0, 2, 0], weight: 3 },
  { id: 'abacab', label: 'ABACAB — rondo with the second idea back', letters: 3, shape: [0, 1, 0, 2, 0, 1], weight: 2 },
  { id: 'aabca', label: 'AABCA — the long way round', letters: 3, shape: [0, 0, 1, 2, 0], weight: 1 },
  { id: 'abcabc', label: 'ABCABC — the whole cycle twice', letters: 3, shape: [0, 1, 2, 0, 1, 2], weight: 1 },

  { id: 'ababcdb', label: 'ABABCDB — with a middle eight and a solo', letters: 4, shape: [0, 1, 0, 1, 2, 3, 1], weight: 3 },
  { id: 'abcadb', label: 'ABCADB — four ideas, one return', letters: 4, shape: [0, 1, 2, 0, 3, 1], weight: 2 },
  { id: 'abacada', label: 'ABACADA — full rondo', letters: 4, shape: [0, 1, 0, 2, 0, 3, 0], weight: 2 },

  { id: 'abcabdeb', label: 'ABCABDEB — a long one', letters: 5, shape: [0, 1, 2, 0, 1, 3, 4, 1], weight: 2 },
  { id: 'abcdea', label: 'ABCDEA — through-composed, then home', letters: 5, shape: [0, 1, 2, 3, 4, 0], weight: 1 },

  { id: 'abcdaefb', label: 'ABCDAEFB — a suite', letters: 6, shape: [0, 1, 2, 3, 0, 4, 5, 1], weight: 2 },
  { id: 'abcdef', label: 'ABCDEF — through-composed, no returns', letters: 6, shape: [0, 1, 2, 3, 4, 5], weight: 1 },
];

/** The forms that can be built from a given number of letters. */
export function formsFor(letters) {
  return FORMS.filter((form) => form.letters === letters);
}

export function defaultComposeSettings() {
  return {
    seed: '',
    // 0 is "let the seed decide", which stays inside two to four.
    letters: 0,
    form: 'auto',
    minutes: 2.5,
    intro: true,
    outro: true,
    fade: true,
    // How far the other letters travel from the home one, and how much a
    // repeat is altered when it comes back.
    contrast: 0.6,
    variation: 0.55,
    // The three big contrasts, each of which can be switched off: modulation,
    // a section counted in another bar, a section taken at another tempo.
    modulate: true,
    meterShifts: true,
    tempoShifts: true,
    // Let the composer choose a tempo to suit the song, rather than keeping
    // whatever the transport is set to.
    pickTempo: true,
  };
}

/** Clamps whatever came out of a control, or an older saved state. */
export function normalizeComposeSettings(settings = {}) {
  const base = defaultComposeSettings();
  const num = (value, fallback, [min, max]) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
  };
  const flag = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
  const letters = Math.round(num(settings.letters, 0, [0, LETTER_RANGE[1]]));
  return {
    seed: typeof settings.seed === 'string' ? settings.seed : base.seed,
    letters: letters === 0 ? 0 : Math.max(LETTER_RANGE[0], letters),
    form: typeof settings.form === 'string' ? settings.form : base.form,
    minutes: num(settings.minutes, base.minutes, MINUTES_RANGE),
    intro: flag(settings.intro, base.intro),
    outro: flag(settings.outro, base.outro),
    fade: flag(settings.fade, base.fade),
    contrast: num(settings.contrast, base.contrast, [0, 1]),
    variation: num(settings.variation, base.variation, [0, 1]),
    modulate: flag(settings.modulate, base.modulate),
    meterShifts: flag(settings.meterShifts, base.meterShifts),
    tempoShifts: flag(settings.tempoShifts, base.tempoShifts),
    pickTempo: flag(settings.pickTempo, base.pickTempo),
  };
}

// --- the letters ------------------------------------------------------------

/** A tempo that suits a song rather than a metronome. */
function pickTempo(rng) {
  return pickWeighted(rng, [
    { value: randInt(rng, 62, 76), weight: 2 }, // a ballad
    { value: randInt(rng, 84, 100), weight: 4 }, // the middle of everything
    { value: randInt(rng, 104, 124), weight: 4 }, // up
    { value: randInt(rng, 128, 152), weight: 2 }, // fast
  ]);
}

/** The four voices a section is played with. */
function pickPalette(rng, avoid = {}) {
  const away = (list, current) => {
    const options = list.filter((item) => item.id !== current);
    return pick(rng, options.length ? options : list).id;
  };
  return {
    lead: away(LEAD_INSTRUMENTS, avoid.lead),
    harmony: away(HARMONY_INSTRUMENTS, avoid.harmony),
    bass: away(BASS_INSTRUMENTS, avoid.bass),
    kit: away(DRUM_KITS, avoid.kit),
  };
}

/**
 * How the chords of a section are cut up into bars: eight bars can be eight
 * chords of one bar or four of two, and which one it is changes the harmonic
 * rhythm — how fast the ground moves under the tune — more than anything else
 * in here.
 */
function shapeChords(bars, rng) {
  const options = [
    { barsPerChord: 1, length: bars, weight: 4 },
    { barsPerChord: 2, length: bars / 2, weight: 3 },
    { barsPerChord: 0.5, length: bars * 2, weight: 1 },
  ].filter((option) => Number.isInteger(option.length) && option.length >= 2 && option.length <= 12);
  if (!options.length) return { barsPerChord: 1, length: Math.min(12, Math.max(2, Math.round(bars))) };
  return pickWeighted(rng, options.map((option) => ({ value: option, weight: option.weight })));
}

/** How long the drum pattern is: a divisor of the section, so it lines up. */
function rhythmBarsFor(bars) {
  for (const candidate of [4, 2]) if (bars % candidate === 0 && bars > candidate) return candidate;
  return 1;
}

/** How long one chord is held, in steps, once the bar has had its say. */
function specStepsPerChord(spec) {
  return Math.max(1, Math.round(meterInfo(spec.meter).stepsPerBar * spec.barsPerChord));
}

/**
 * How long that section's drum pattern is, in bars. It has to divide into the
 * section, or the drums would drag it out past its last chord.
 */
function specRhythmBars(spec) {
  const bars = Math.max(1, Math.round(spec.length * spec.barsPerChord));
  // A section that is only drums — the count-in intro — is its pattern, and a
  // pattern is at most four bars.
  if (spec.chordsOn === false) return Math.min(4, bars);
  const whole = Math.floor((spec.length * specStepsPerChord(spec)) / meterInfo(spec.meter).stepsPerBar);
  return Math.min(4, rhythmBarsFor(Math.max(1, whole)));
}

/** The home section — the one every other letter is a departure from. */
function homeSpec({ rng, rootPc, scaleId, meter, bars, palette }) {
  const { barsPerChord, length } = shapeChords(bars, rng);
  return {
    kind: 'main',
    rootPc,
    scaleId,
    meter,
    mode: pickWeighted(rng, [
      { value: 'functional', weight: 6 },
      { value: 'vamp', weight: 2 },
      { value: 'random', weight: 0.5 },
    ]),
    length,
    barsPerChord,
    sevenths: 0.1 + rng() * 0.3,
    spice: 0.05 + rng() * 0.2,
    melodyShape: pick(rng, ['wander', 'wander', 'arch', 'descend']),
    density: 0.35 + rng() * 0.2,
    chordTones: 0.5 + rng() * 0.3,
    restiness: 0.15 + rng() * 0.2,
    rangeLow: 60,
    rangeHigh: 81,
    bassOn: true,
    bassStyle: pick(rng, ['roots', 'lock', 'walk', 'pump', 'counter']),
    bassDensity: 0.4 + rng() * 0.25,
    bassMotion: 0.3 + rng() * 0.4,
    bassCounter: 0.4 + rng() * 0.3,
    bassOctave: 2,
    drumsOn: true,
    rhythmStyle: pickWeighted(rng, [
      { value: 'backbeat', weight: 4 },
      { value: 'euclid', weight: 3 },
      { value: 'polyrhythm', weight: 1 },
      { value: 'cutup', weight: 1 },
    ]),
    rhythmDensity: 0.4 + rng() * 0.25,
    rhythmVariation: 0.15 + rng() * 0.25,
    trackIds: randomKitPieces(rng),
    palette,
    dynamics: 1,
    tempoScale: 1,
    chordsOn: true,
    melodyOn: true,
    traits: [],
  };
}

/**
 * The moves a section can make away from the home one. Each is a small edit
 * plus the words for what it did, because a section that has gone somewhere
 * ought to be able to say where.
 *
 * `strong` marks the ones that genuinely change the ground rather than the
 * decoration — a middle eight is required to make at least one of them.
 */
const MOVES = [
  {
    id: 'relative',
    weight: 4,
    strong: true,
    needs: (ctx) => ctx.settings.modulate,
    apply(spec, { rng }) {
      const toMajor = MINORISH.has(spec.scaleId);
      spec.rootPc = (spec.rootPc + (toMajor ? 3 : 9)) % 12;
      spec.scaleId = toMajor ? 'major' : 'minor';
      spec.traits.push(`the relative ${toMajor ? 'major' : 'minor'}`);
      // A key change is worth hearing, so the melody moves with it.
      spec.melodyShape = pick(rng, ['arch', 'descend', 'wander']);
    },
  },
  {
    id: 'parallel',
    weight: 3,
    strong: true,
    needs: (ctx) => ctx.settings.modulate,
    apply(spec) {
      const toMajor = MINORISH.has(spec.scaleId);
      spec.scaleId = toMajor ? 'major' : 'minor';
      spec.traits.push(`the parallel ${toMajor ? 'major' : 'minor'}`);
    },
  },
  {
    id: 'mediant',
    weight: 2,
    strong: true,
    needs: (ctx) => ctx.settings.modulate,
    apply(spec, { rng }) {
      // Up to the flat sixth or the flat third: the borrowed, cinematic one.
      const up = chance(rng, 0.5) ? 8 : 3;
      spec.rootPc = (spec.rootPc + up) % 12;
      spec.scaleId = 'major';
      spec.traits.push(`up to the flat ${up === 8 ? 'sixth' : 'third'}`);
    },
  },
  {
    id: 'plagal',
    weight: 3,
    strong: true,
    needs: (ctx) => ctx.settings.modulate,
    apply(spec, { rng }) {
      const up = chance(rng, 0.55) ? 5 : 7;
      spec.rootPc = (spec.rootPc + up) % 12;
      spec.traits.push(`up a ${up === 5 ? 'fourth' : 'fifth'}`);
    },
  },
  {
    id: 'mode',
    weight: 3,
    strong: true,
    apply(spec, { rng }) {
      const next = MINORISH.has(spec.scaleId)
        ? pick(rng, ['dorian', 'phrygian', 'harmonicMinor'])
        : pick(rng, ['lydian', 'mixolydian', 'dorian']);
      if (next === spec.scaleId) return;
      spec.scaleId = next;
      spec.traits.push(getScale(next).label.replace(/ \(.*\)$/, ''));
    },
  },
  {
    id: 'vamp',
    weight: 2,
    strong: true,
    apply(spec) {
      spec.mode = 'vamp';
      spec.spice = Math.max(spec.spice, 0.25);
      spec.traits.push('a modal vamp');
    },
  },
  {
    id: 'meter',
    weight: 2,
    strong: true,
    needs: (ctx) => ctx.settings.meterShifts && ctx.contrast > 0.35,
    apply(spec, { rng, home }) {
      const options = [
        { beats: 3, unit: 4 }, { beats: 6, unit: 8 }, { beats: 5, unit: 4 }, { beats: 7, unit: 8 },
      ].filter((meter) => meter.beats !== home.meter.beats || meter.unit !== home.meter.unit);
      spec.meter = pickWeighted(rng, options.map((meter, index) => ({
        value: meter, weight: index < 2 ? 3 : 1,
      })));
      // A different bar is a different length of section unless the chords are
      // re-cut onto it, so the count is kept and the bars fall where they fall.
      spec.traits.push(`counted in ${spec.meter.beats}/${spec.meter.unit}`);
    },
  },
  {
    id: 'timbre',
    weight: 5,
    apply(spec, { rng, home }) {
      spec.palette = pickPalette(rng, home.palette);
      spec.traits.push('another set of voices');
    },
  },
  {
    id: 'kit',
    weight: 4,
    apply(spec, { rng, home }) {
      spec.trackIds = randomKitPieces(rng);
      spec.palette = { ...spec.palette, kit: pickPalette(rng, home.palette).kit };
      spec.rhythmStyle = pick(rng, ['euclid', 'backbeat', 'polyrhythm', 'cutup', 'chance']);
      spec.traits.push('a different kit');
    },
  },
  {
    id: 'quieter',
    weight: 3,
    apply(spec, { rng }) {
      spec.dynamics = 0.62 + rng() * 0.12;
      spec.rhythmDensity = Math.max(0.15, spec.rhythmDensity - 0.2);
      spec.density = Math.max(0.2, spec.density - 0.12);
      spec.bassStyle = 'roots';
      spec.traits.push('held back');
    },
  },
  {
    id: 'louder',
    weight: 3,
    apply(spec, { rng }) {
      spec.dynamics = 1.12 + rng() * 0.12;
      spec.rhythmDensity = Math.min(0.95, spec.rhythmDensity + 0.2);
      spec.bassStyle = pick(rng, ['pump', 'lock']);
      spec.traits.push('flat out');
    },
  },
  {
    id: 'busier',
    weight: 3,
    apply(spec, { rng }) {
      spec.density = Math.min(0.9, spec.density + 0.25);
      spec.restiness = Math.max(0.05, spec.restiness - 0.1);
      spec.sevenths = Math.min(1, spec.sevenths + 0.25);
      spec.spice = Math.min(1, spec.spice + 0.2);
      spec.melodyShape = pick(rng, ['leaps', 'arch']);
      spec.traits.push('busier, and more chromatic');
    },
  },
  {
    id: 'sparser',
    weight: 2,
    apply(spec) {
      spec.density = Math.max(0.15, spec.density - 0.18);
      spec.restiness = Math.min(0.7, spec.restiness + 0.2);
      spec.traits.push('more air in it');
    },
  },
  {
    id: 'harmonicRhythm',
    weight: 3,
    apply(spec, { rng }) {
      const faster = chance(rng, 0.5) && spec.barsPerChord > 0.5;
      const bars = spec.length * spec.barsPerChord;
      spec.barsPerChord = faster ? spec.barsPerChord / 2 : spec.barsPerChord * 2;
      spec.length = Math.max(2, Math.round(bars / spec.barsPerChord));
      spec.traits.push(faster ? 'the chords move twice as fast' : 'the chords are held twice as long');
    },
  },
  {
    id: 'register',
    weight: 2,
    apply(spec, { rng }) {
      const up = chance(rng, 0.6);
      spec.rangeLow += up ? 7 : -5;
      spec.rangeHigh += up ? 7 : -5;
      spec.traits.push(up ? 'the tune sits higher' : 'the tune sits lower');
    },
  },
  {
    id: 'tempo',
    weight: 2,
    needs: (ctx) => ctx.settings.tempoShifts,
    apply(spec, { rng }) {
      const up = chance(rng, 0.55);
      spec.tempoScale = up ? 1.05 + rng() * 0.08 : 0.88 + rng() * 0.06;
      spec.traits.push(up ? 'pushed a shade faster' : 'pulled back a shade');
    },
  },
  {
    id: 'breakdown',
    weight: 2,
    apply(spec, { rng }) {
      if (chance(rng, 0.6)) {
        spec.drumsOn = false;
        spec.traits.push('no drums');
      } else {
        spec.bassOn = false;
        spec.traits.push('no bass');
      }
      spec.dynamics = Math.min(spec.dynamics, 0.8);
    },
  },
  {
    id: 'shorter',
    weight: 2,
    apply(spec) {
      const bars = spec.length * spec.barsPerChord;
      if (bars <= 4) return;
      spec.length = Math.max(2, Math.round(spec.length / 2));
      spec.traits.push('half the length');
    },
  },
];

/**
 * Pulls a letter away from the home section. A middle eight is pulled harder
 * and is guaranteed at least one move that changes the ground under it, which
 * is the difference between a section that contrasts and one that is merely
 * decorated differently.
 */
function contrastSpec(home, ctx) {
  const {
    rng, contrast, kind, index,
  } = ctx;
  const spec = {
    ...home, traits: [], palette: { ...home.palette }, trackIds: [...home.trackIds], kind,
  };

  const available = MOVES.filter((move) => !move.needs || move.needs(ctx));
  const strong = available.filter((move) => move.strong);
  const chosen = [];

  // The bridge always goes somewhere; a second verse-ish letter only sometimes
  // has to, and how often is the contrast dial.
  if (kind === 'bridge' || chance(rng, 0.35 + contrast * 0.5)) {
    chosen.push(pickWeighted(rng, strong.map((move) => ({ value: move, weight: move.weight }))));
  }

  const extra = (kind === 'bridge' ? 1 : 0) + Math.round(contrast * 2) + (index > 2 ? 1 : 0);
  const pool = shuffle(rng, available.filter((move) => !chosen.includes(move)));
  for (const move of pool) {
    if (chosen.length >= 1 + extra) break;
    // Two moves that fight over the same knob make mush of both.
    if (chosen.some((other) => conflicts(other.id, move.id))) continue;
    chosen.push(move);
  }

  for (const move of chosen) move.apply(spec, ctx);

  // Whatever happened, the letter has to be recognisably not the home one.
  if (!spec.traits.length) {
    spec.palette = pickPalette(rng, home.palette);
    spec.melodyShape = pick(rng, ['leaps', 'arch', 'descend']);
    spec.traits.push('another set of voices');
  }
  // A middle eight that arrives in the same colours as the verse is only a
  // change of chords. Timbre is the contrast people hear first, so if nothing
  // else moved it, it moves here.
  if (kind === 'bridge' && spec.palette.harmony === home.palette.harmony) {
    const fresh = pickPalette(rng, home.palette);
    spec.palette = { ...spec.palette, harmony: fresh.harmony, lead: fresh.lead };
    spec.traits.push('another colour underneath');
  }
  return spec;
}

/** Pairs of moves that would only cancel each other out. */
const CONFLICTS = [
  ['quieter', 'louder'], ['busier', 'sparser'], ['quieter', 'busier'], ['louder', 'sparser'],
  ['timbre', 'kit'], ['relative', 'parallel'], ['relative', 'mediant'], ['relative', 'plagal'],
  ['parallel', 'mediant'], ['parallel', 'plagal'], ['mediant', 'plagal'], ['mode', 'relative'],
  ['mode', 'parallel'], ['vamp', 'busier'], ['breakdown', 'louder'], ['shorter', 'harmonicRhythm'],
];

function conflicts(a, b) {
  return CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// --- the repeats ------------------------------------------------------------

/**
 * What happens to a section the second or third time you hear it. Mozart never
 * repeated a theme without changing something about it, and neither did anyone
 * who came after.
 */
const VARIANTS = [
  {
    id: 'reroll',
    weight: 4,
    label: 'a new tune over the same chords',
    apply(spec) {
      spec.rerollMelody = true;
    },
  },
  {
    id: 'lift',
    weight: 3,
    label: 'up a semitone',
    needs: (settings) => settings.modulate,
    apply(spec, rng) {
      const up = chance(rng, 0.7) ? 1 : 2;
      spec.rootPc = (spec.rootPc + up) % 12;
      spec.rerollMelody = true;
      spec.label = up === 1 ? 'up a semitone' : 'up a tone';
    },
  },
  {
    id: 'louder',
    weight: 3,
    label: 'harder, with more kit',
    apply(spec, rng) {
      spec.dynamics = Math.min(1.35, spec.dynamics * (1.12 + rng() * 0.1));
      spec.rhythmDensity = Math.min(0.95, spec.rhythmDensity + 0.18);
      spec.trackIds = [...new Set([...spec.trackIds, 'crash', 'tamb'])];
    },
  },
  {
    id: 'stripped',
    weight: 3,
    label: 'stripped back',
    apply(spec) {
      spec.dynamics = Math.min(spec.dynamics, 0.7);
      spec.drumsOn = false;
      spec.bassStyle = 'roots';
    },
  },
  {
    id: 'octave',
    weight: 2,
    label: 'the tune an octave up',
    apply(spec) {
      spec.rangeLow += 12;
      spec.rangeHigh += 12;
      spec.rerollMelody = true;
    },
  },
  {
    id: 'recolour',
    weight: 2,
    label: 'new voices',
    apply(spec, rng) {
      spec.palette = pickPalette(rng, spec.palette);
    },
  },
];

// --- the bookends -----------------------------------------------------------

/**
 * The intro. It is not a section in its own right so much as a way in: the
 * chords of something you are about to hear, with most of it taken away.
 */
function introSpec(source, { rng, bars }) {
  const spec = {
    ...source, traits: [], palette: { ...source.palette }, trackIds: [...source.trackIds], kind: 'intro',
  };
  // It is made *out of* a section but it is not a variant of one, so it does
  // not take a letter and a prime when the names are handed out.
  delete spec.variantOf;
  delete spec.renamed;
  spec.length = Math.max(2, Math.round(bars / Math.max(0.5, spec.barsPerChord)));
  spec.dynamics = 0.7 + rng() * 0.15;
  spec.tempoScale = 1;

  const kind = pickWeighted(rng, [
    { value: 'chords', weight: 4 },
    { value: 'tune', weight: 3 },
    { value: 'groove', weight: 2 },
    { value: 'full', weight: 2 },
  ]);
  if (kind === 'chords') {
    spec.melodyOn = false;
    spec.bassStyle = 'roots';
    spec.rhythmDensity = Math.max(0.15, spec.rhythmDensity - 0.25);
    spec.traits.push('chords on their own');
  } else if (kind === 'tune') {
    spec.drumsOn = false;
    spec.bassOn = false;
    spec.density = Math.min(0.8, spec.density + 0.1);
    spec.traits.push('just the tune, no band');
  } else if (kind === 'groove') {
    // Drums and nothing else: the count-in that turns into the song. It is the
    // one section made of nothing but its pattern, so the drums have to be on
    // whatever the section it came from was doing.
    spec.chordsOn = false;
    spec.melodyOn = false;
    spec.bassOn = false;
    spec.drumsOn = true;
    spec.traits.push('drums alone');
  } else {
    spec.melodyOn = false;
    spec.traits.push('the band, before the tune arrives');
  }
  return spec;
}

/**
 * The coda. Four ways out: fade on the last idea, a short tag, a ritardando —
 * which here is simply the same music taken slower — or one last hit.
 */
function outroSpec(source, { rng, settings, bars }) {
  const spec = {
    ...source, traits: [], palette: { ...source.palette }, trackIds: [...source.trackIds], kind: 'outro',
  };
  delete spec.variantOf;
  delete spec.renamed;
  spec.tempoScale = 1;
  spec.endOnTonic = true;

  const kind = pickWeighted(rng, [
    { value: 'fade', weight: settings.fade ? 5 : 0 },
    { value: 'tag', weight: 3 },
    // A coda that slows to a stop is a tempo change like any other, so it goes
    // when the tempo is asked to stay put.
    { value: 'ritard', weight: settings.tempoShifts ? 2 : 0 },
    { value: 'stab', weight: 2 },
  ]);

  if (kind === 'fade') {
    spec.length = Math.max(2, Math.round(bars / Math.max(0.5, spec.barsPerChord)));
    spec.fade = true;
    spec.traits.push('fades out');
  } else if (kind === 'tag') {
    spec.length = Math.max(2, Math.round(spec.length / 2));
    spec.density = Math.max(0.2, spec.density - 0.1);
    spec.traits.push('a tag on the end');
  } else if (kind === 'ritard') {
    spec.tempoScale = 0.86;
    spec.length = Math.max(2, Math.round(spec.length / 2));
    spec.dynamics = 0.85;
    spec.drumsOn = chance(rng, 0.4);
    spec.traits.push('slows to a stop');
  } else {
    // Two bars, whatever the section it came from was holding its chords for.
    spec.length = 2;
    spec.barsPerChord = 1;
    spec.melodyOn = chance(rng, 0.5);
    spec.dynamics = 1.1;
    spec.trackIds = [...new Set([...spec.trackIds, 'crash'])];
    spec.traits.push('one last chord');
  }
  return spec;
}

// --- putting it together ----------------------------------------------------

/**
 * How long a section runs, once, in steps — which has to be exactly what
 * naturalSteps() will say about it later, or the length the composer aims for
 * is not the length that comes out.
 */
function specSteps(spec) {
  const bar = meterInfo(spec.meter).stepsPerBar;
  if (spec.chordsOn === false) return bar * specRhythmBars(spec);
  return Math.max(bar, spec.length * specStepsPerChord(spec));
}

/** The letter a body section is called, and the primes its variants take. */
const PRIMES = ['′', '″', '‴'];

/** A′, A″, A‴, then A4 — a name for the nth time a letter comes back changed. */
function variantName(base, nth) {
  return `${base}${PRIMES[nth - 1] || nth}`;
}

function chooseForm(rng, settings) {
  const named = FORMS.find((form) => form.id === settings.form);
  if (named) return named;
  const letters = settings.letters || pickWeighted(rng, [
    { value: 2, weight: 3 }, { value: 3, weight: 4 }, { value: 4, weight: 2 },
  ]);
  const options = formsFor(letters);
  if (!options.length) return FORMS[0];
  return pickWeighted(rng, options.map((form) => ({ value: form, weight: form.weight })));
}

/** Which letters are middle eights: the ones that turn up once, late, in a long shape. */
function roleOf(shape, letter) {
  if (letter === 0) return 'main';
  const count = shape.filter((index) => index === letter).length;
  return count === 1 && shape.length >= 4 ? 'bridge' : 'main';
}

/** The letter that carries the song — the one that comes round most often. */
function hookLetter(shape) {
  const counts = new Map();
  for (const letter of shape) counts.set(letter, (counts.get(letter) || 0) + 1);
  let best = shape[0];
  for (const [letter, count] of counts) {
    // Ties go to the later letter, because the chorus is usually the second idea.
    if (count > (counts.get(best) || 0) || (count === counts.get(best) && letter > best)) best = letter;
  }
  return best;
}

// --- writing the letters ----------------------------------------------------

/**
 * The way it has always worked: roll a home section, roll a departure from it
 * for every other letter, and live with what the dice said.
 */
function plainLetters({
  rng, settings, shape, form, meter, rootPc, scaleId, bars,
}) {
  const palette = pickPalette(rng);
  const home = homeSpec({
    rng, rootPc, scaleId, meter, bars, palette,
  });
  const specs = [home];
  for (let letter = 1; letter < form.letters; letter++) {
    specs.push(contrastSpec(home, {
      rng,
      settings,
      contrast: settings.contrast,
      home,
      kind: roleOf(shape, letter),
      index: letter,
    }));
  }
  specs.forEach((spec, index) => {
    spec.name = String.fromCharCode(65 + index);
    spec.seedKey = spec.name;
  });
  return specs;
}

/**
 * How many candidates each letter is auditioned from, and how hard the model's
 * opinion is allowed to push. Both come off the same dial: a model you trust
 * completely gets to hear eight and insist on its favourite, one that has
 * barely beaten a coin gets to hear three and only nudge.
 */
function auditionSize(weight) {
  return Math.max(2, Math.round(2 + weight * 6));
}

/**
 * Whether there is anything worth listening to, and how much.
 *
 * A model reports its own held-out accuracy and gates itself to zero when it
 * has not beaten chance, so "is there a model" and "is the model any good" are
 * the same question and it is asked here, once. Everything downstream can then
 * assume that a non-null `ears` has actually earned the right to an opinion.
 */
function tasteFor(options) {
  const model = options?.taste;
  if (!model || typeof model.scoreSection !== 'function') return null;
  const dial = Number.isFinite(options.tasteStrength) ? Math.min(1, Math.max(0, options.tasteStrength)) : 1;
  const confidence = Number.isFinite(model.confidence) ? model.confidence : 0;
  const weight = dial * confidence;
  if (weight <= 0.001) return null;
  return { model, weight, size: auditionSize(weight) };
}

/**
 * Best of N, against the ears you trained.
 *
 * Not "pick the highest", quite. The model is right more often than not, which
 * is a long way from being right, and a composer that always takes its top
 * choice inherits every one of its blind spots and stops surprising you — which
 * for a machine whose entire purpose is to surprise you is a poor trade. So the
 * winner is drawn rather than declared, with the odds stacked by how much the
 * model has earned.
 *
 * The odds are stacked by *rank*, not by score, and that distinction matters
 * more than it looks. A sigmoid squashes: eight candidates that a listener
 * would sort confidently might come back as 0.36 through 0.70, and how tight
 * that band is depends on nothing more principled than how the last training
 * run happened to land. Selecting on the raw gaps would therefore make the
 * composer's decisiveness an accident of calibration — the same model, refitted
 * on the same opinions, choosing differently because its outputs bunched up.
 * Ranking throws the widths away and keeps the only thing actually being
 * claimed: this one, then this one, then this one.
 *
 * @param {object[]} candidates specs, already named and seeded
 * @param {(spec: object) => number} score 0..1, higher is better
 */
function audition(candidates, score, { rng, weight }) {
  if (candidates.length < 2) return candidates[0];
  const scored = candidates
    .map((spec) => ({ spec, score: score(spec) }))
    .sort((a, b) => b.score - a.score);
  // At full confidence the favourite is about three times as likely as the
  // runner-up and the also-rans are all but out; at a third of it the field is
  // barely tilted. Either way the last place keeps a pulse, because a model
  // that is right 70% of the time is wrong 30% of the time.
  const selectivity = 1.2 * Math.max(0.1, weight);
  const chosen = pickWeighted(rng, scored.map((entry, rank) => ({
    value: entry.spec,
    weight: Math.exp(-rank * selectivity),
  })));
  const entry = scored.find((item) => item.spec === chosen);
  chosen.tasteScore = round(entry.score);
  chosen.tasteRank = scored.indexOf(entry) + 1;
  chosen.auditioned = candidates.length;
  return chosen;
}

/**
 * The same letters, chosen rather than accepted.
 *
 * Each candidate gets its own seed key, so the audition is over real music and
 * not merely over settings: two candidates for A are two different tunes over
 * two different progressions, not one tune described twice. Whichever wins
 * keeps its key, and everything downstream — the variants, the intro, the coda
 * — is built off the section that actually won.
 */
function auditionLetters({
  rng, seed, settings, shape, form, meter, rootPc, scaleId, bars, ears,
}) {
  const { model, weight, size } = ears;
  // Rendering a candidate is the only way to score it — the features are
  // measured off the notes, not off the dials that produced them.
  const render = (spec) => renderSection(spec, { seed });

  const homeCandidates = [];
  for (let i = 0; i < size; i++) {
    const spec = homeSpec({
      rng, rootPc, scaleId, meter, bars, palette: pickPalette(rng),
    });
    spec.name = 'A';
    // A tilde key is still a key: whichever candidate wins keeps it, and the
    // section rendered later off that key is note-for-note the one that was
    // auditioned.
    spec.seedKey = i === 0 ? 'A' : `A~${i}`;
    homeCandidates.push(spec);
  }
  const home = audition(homeCandidates, (spec) => model.scoreSection(render(spec)).overall, { rng, weight });

  const specs = [home];
  const homeSection = render(home);

  for (let letter = 1; letter < form.letters; letter++) {
    const name = String.fromCharCode(65 + letter);
    const kind = roleOf(shape, letter);
    const candidates = [];
    for (let i = 0; i < size; i++) {
      const spec = contrastSpec(home, {
        rng, settings, contrast: settings.contrast, home, kind, index: letter,
      });
      spec.name = name;
      spec.seedKey = i === 0 ? name : `${name}~${i}`;
      candidates.push(spec);
    }
    // A second letter is judged on two things at once, and it has to pass both:
    // whether it is any good, and whether it belongs in the same song as the
    // one before it. A gorgeous idea in the wrong key is still the wrong key.
    specs.push(audition(candidates, (spec) => {
      const section = render(spec);
      return model.scoreSection(section).overall * 0.55
        + model.scorePair(homeSection, section) * 0.45;
    }, { rng, weight }));
  }

  return specs;
}

/**
 * Writes a song.
 *
 * @param {object} options
 * @param {object} [options.settings] see defaultComposeSettings
 * @param {number} [options.tempo] what the transport is set to now
 * @param {{beats:number, unit:number}} [options.meter]
 * @param {number} [options.rootPc] the key to start from
 * @param {string} [options.scaleId]
 * @param {{scoreSection:Function, scorePair:Function, confidence:number}} [options.taste]
 *   a trained model — see ml/model.js. Given one, every letter is auditioned
 *   rather than simply rolled. Without one the composer behaves exactly as it
 *   did before there was a model at all, down to the seed.
 * @param {number} [options.tasteStrength] 0..1, how much say it gets
 * @returns {{seed:string, sections:object[], arrangement:object[], tempo:number,
 *   meter:object, form:object, seconds:number, steps:number, summary:string}}
 */
export function composeSong(options = {}) {
  const settings = normalizeComposeSettings(options.settings);
  const seed = String(settings.seed || options.seed || randomSeed());
  const rng = makeRng(`compose:${seed}`);

  const meter = normalizeMeter(options.meter || DEFAULT_METER);
  const tempo = settings.pickTempo
    ? pickTempo(rng)
    : Math.min(220, Math.max(40, Math.round(Number(options.tempo) || 96)));
  const rootPc = Number.isFinite(options.rootPc) ? ((options.rootPc % 12) + 12) % 12 : randInt(rng, 0, 11);
  const scaleId = getScale(options.scaleId || 'major').id;

  const form = chooseForm(rng, settings);
  const shape = form.shape;

  // How long each part has to be for the whole thing to come out the length you
  // asked for. Work in bars: it is the only unit that survives a tempo change.
  const secondsPerStep = 60 / tempo / 4;
  const secondsPerBar = meterInfo(meter).stepsPerBar * secondsPerStep;
  const targetSeconds = settings.minutes * 60;
  const bookends = (settings.intro ? 1 : 0) + (settings.outro ? 1 : 0);
  const wantBars = targetSeconds / secondsPerBar;
  const per = wantBars / Math.max(1, shape.length + bookends);
  const bodyBars = [2, 4, 8, 12, 16].reduce(
    (best, option) => (Math.abs(option - per) < Math.abs(best - per) ? option : best),
    8,
  );
  // A shape that cannot fill the time even at sixteen bars a section goes round
  // again — a second pass of the whole form, which is what a long song is,
  // rather than one section played eight times over.
  const cycles = per > bodyBars * 1.4
    ? Math.min(3, Math.max(1, Math.round(per / bodyBars)))
    : 1;

  // 1. the letters — either straight off the dice, or the best of a handful as
  //    judged by a model that has been told what you like.
  const ears = tasteFor(options);
  const letterSpecs = ears
    ? auditionLetters({
      rng, seed, settings, shape, form, meter, rootPc, scaleId, bars: bodyBars, ears,
    })
    : plainLetters({
      rng, settings, shape, form, meter, rootPc, scaleId, bars: bodyBars,
    });
  const home = letterSpecs[0];

  // 2. the running order, before anything is repeated or decorated
  const specs = [...letterSpecs];
  // A block knows which letter it is an appearance of, which is how the length
  // fitter knows to lean on the chorus rather than on the middle eight.
  const body = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (const letter of shape) body.push({ spec: letter, letter, repeats: 1 });
  }

  // 3. make the body last as long as it was asked to, minus what the bookends
  //    will take. Length is settled before anything is decorated, so a block
  //    the fitter throws away never becomes a section you can see and cannot
  //    hear.
  const bookendBars = bookends * Math.max(2, bodyBars / 2);
  let blocks = fitDuration(body, {
    specs,
    rng,
    targetSeconds: Math.max(secondsPerBar * 2, targetSeconds - bookendBars * secondsPerBar),
    secondsPerStep,
    hook: hookLetter(shape),
  });

  // 4. the repeats that come back changed
  const seen = new Map();
  const primes = new Map();
  let variants = 0;
  const maxVariants = Math.round(settings.variation * (2 + blocks.length / 3));
  const order = blocks.map((block) => block.letter);
  blocks.forEach((block, index) => {
    const letter = block.letter;
    const times = (seen.get(letter) || 0) + 1;
    seen.set(letter, times);
    if (times === 1 || variants >= maxVariants) return;
    if (!chance(rng, settings.variation)) return;
    const source = letterSpecs[letter];
    const last = !order.slice(index + 1).includes(letter);
    const pool = VARIANTS.filter((variant) => !variant.needs || variant.needs(settings));
    // The key lift belongs to the last time round, and nowhere else.
    const usable = last ? pool : pool.filter((variant) => variant.id !== 'lift');
    const variant = pickWeighted(rng, usable.map((item) => ({ value: item, weight: item.weight })));
    // A′ and then A″: the primes count per letter, so the shelf reads in order.
    const prime = (primes.get(letter) || 0) + 1;
    primes.set(letter, prime);
    const spec = {
      ...source,
      traits: [],
      palette: { ...source.palette },
      trackIds: [...source.trackIds],
      name: variantName(source.name, prime),
    };
    spec.label = variant.label;
    spec.variantOf = source;
    variant.apply(spec, rng);
    spec.traits.push(`${source.name}, ${spec.label}`);
    // A variant is the *same section* come back changed, so it keeps the chord
    // seed — a key lift is that progression transposed, not another one. Only
    // a variant that says it is a new tune gets a new melody seed.
    spec.seedKey = source.seedKey;
    spec.melodyKey = spec.rerollMelody ? `${source.seedKey}${prime}` : source.seedKey;
    specs.push(spec);
    block.spec = specs.length - 1;
    variants += 1;
  });

  // 5. the bookends, which are made of whatever ended up next to them: the
  //    intro out of the first idea, the coda out of the last thing you hear —
  //    so a song whose last chorus went up a semitone fades out up there too.
  const hook = hookLetter(shape);
  if (settings.intro && blocks.length) {
    const source = letterSpecs[chance(rng, 0.6) ? 0 : hook];
    // An intro is the opening of something you are about to hear, so it keeps
    // that section's seeds: the same chords, fewer of them.
    const spec = introSpec(source, { rng, bars: Math.max(2, bodyBars / 2) });
    spec.name = 'Intro';
    specs.push(spec);
    blocks.unshift({ spec: specs.length - 1, letter: null, repeats: 1 });
  }
  if (settings.outro && blocks.length) {
    const source = specs[blocks.at(-1).spec];
    const spec = outroSpec(source, { rng, settings, bars: Math.max(2, bodyBars / 2) });
    spec.name = 'Outro';
    specs.push(spec);
    blocks.push({ spec: specs.length - 1, letter: null, repeats: spec.fade ? 2 : 1 });
  }

  // 6. one more pass at the length, now that the bookends are on and their real
  //    cost is known rather than guessed at.
  blocks = fitDuration(blocks, {
    specs, rng, targetSeconds, secondsPerStep, hook,
  });

  // The primes are numbered against the running order that survived, so the
  // shelf reads A, A′, A″ rather than skipping one that was trimmed away.
  const named = new Map();
  for (const block of blocks) {
    const spec = specs[block.spec];
    if (!spec.variantOf || spec.renamed) continue;
    const count = (named.get(spec.variantOf.name) || 0) + 1;
    named.set(spec.variantOf.name, count);
    spec.name = variantName(spec.variantOf.name, count);
    spec.renamed = true;
  }

  // 6. write it, in the order it is heard: the shelf should read intro first
  //    and coda last, however the specs happened to be built.
  const heard = [];
  for (const block of blocks) if (!heard.includes(block.spec)) heard.push(block.spec);
  const sections = [];
  const byspec = new Map();
  for (const index of heard) {
    byspec.set(index, sections.length);
    sections.push(renderSection(specs[index], { seed }));
  }
  const arrangement = blocks.map((block) => {
    const entry = { sectionId: sections[byspec.get(block.spec)].id, repeats: block.repeats };
    if (specs[block.spec].fade) entry.fade = true;
    return entry;
  });

  const steps = blocks.reduce(
    (total, block) => total + specSteps(specs[block.spec]) * block.repeats,
    0,
  );
  const seconds = blocks.reduce(
    (total, block) => total
      + (specSteps(specs[block.spec]) * block.repeats * secondsPerStep) / (specs[block.spec].tempoScale || 1),
    0,
  );

  return {
    seed,
    settings,
    sections,
    arrangement,
    tempo,
    meter,
    form,
    letters: form.letters,
    steps,
    seconds,
    // What the model had to do with it, if anything — so the Song tab can say
    // so out loud rather than leaving you to wonder whether the Train tab is
    // doing anything at all.
    taste: ears ? {
      weight: round(ears.weight),
      auditioned: ears.size,
      scores: letterSpecs
        .filter((spec) => Number.isFinite(spec.tasteScore))
        .map((spec) => ({ name: spec.name, score: spec.tasteScore, rank: spec.tasteRank })),
    } : null,
    summary: blocks.map((block) => {
      const name = specs[block.spec].name;
      return block.repeats > 1 ? `${name}×${block.repeats}` : name;
    }).join(' '),
    key: keyLabel(rootPc, scaleId),
  };
}

/**
 * Repeats and trims until the song is about as long as it was asked to be.
 * Repeats first, because playing the chorus twice is what a band does; dropping
 * whole blocks only when there is no other way down.
 */
function fitDuration(blocks, {
  specs, rng, targetSeconds, secondsPerStep, hook,
}) {
  const out = blocks.map((block) => ({ ...block }));
  const seconds = () => out.reduce(
    (total, block) => total
      + (specSteps(specs[block.spec]) * block.repeats * secondsPerStep) / (specs[block.spec].tempoScale || 1),
    0,
  );
  const body = () => out.filter((block) => block.letter !== null);

  let guard = 0;
  // Too short: lean on the hook, then on whatever is shortest.
  while (seconds() < targetSeconds * 0.9 && guard++ < 40) {
    const candidates = body();
    if (!candidates.length) break;
    const hooks = candidates.filter((block) => block.letter === hook);
    const from = (hooks.length && chance(rng, 0.6) ? hooks : candidates);
    // The one that has been leaned on least, so the extra passes spread out.
    const target = from.reduce((best, block) => (block.repeats < best.repeats ? block : best));
    if (target.repeats >= 8) break;
    target.repeats += 1;
  }

  // Too long: take repeats back off, then drop blocks whose letter is heard
  // elsewhere anyway. Never drop the last of anything.
  guard = 0;
  while (seconds() > targetSeconds * 1.12 && guard++ < 60) {
    const repeated = out.filter((block) => block.repeats > 1);
    if (repeated.length) {
      repeated.reduce((best, block) => (block.repeats > best.repeats ? block : best)).repeats -= 1;
      continue;
    }
    const candidates = body();
    // A letter that is heard elsewhere can lose an appearance; otherwise only
    // trim while there is more than one idea left standing.
    const droppable = candidates.filter((block) => (
      candidates.filter((other) => other.letter === block.letter).length > 1
      || candidates.length > 2
    ));
    if (!droppable.length) break;
    out.splice(out.indexOf(pick(rng, droppable)), 1);
  }

  return out;
}

/**
 * Turns a spec into a real section: the same generators the Chords and Rhythm
 * tabs run, called in the same order, off seeds derived from the composition's
 * one seed. That is what makes a composed section an ordinary section — you can
 * open it, roll its melody, drag its notes, and it behaves like anything else
 * you saved by hand.
 */
function renderSection(spec, { seed }) {
  const grid = meterInfo(spec.meter);
  const stepsPerChord = specStepsPerChord(spec);
  const melodyKey = spec.melodyKey || spec.seedKey;
  const chordSeed = `${seed}·${spec.seedKey}`;
  const melodySeed = `${seed}·${melodyKey}·mel`;
  const bassSeed = `${seed}·${melodyKey}·bass`;
  const rhythmSeed = `${seed}·${spec.seedKey}·drums`;

  const chords = spec.chordsOn === false ? [] : generateProgression({
    rng: makeRng(`chords:${chordSeed}`),
    rootPc: spec.rootPc,
    scaleId: spec.scaleId,
    length: spec.length,
    mode: spec.mode,
    sevenths: spec.sevenths,
    spice: spec.spice,
  });

  // A coda that does not land on the tonic is not a coda, it is a fade on a
  // question, so the last chord of one is put back where it belongs.
  if (spec.endOnTonic && chords.length) {
    chords[chords.length - 1] = diatonicChord(spec.rootPc, spec.scaleId, 0, false);
  }

  const voicings = chords.length ? voiceProgression(chords, { octave: 3 }) : [];

  const rhythmBars = specRhythmBars(spec);
  const pattern = generateRhythm({
    rng: makeRng(`rhythm:${rhythmSeed}`),
    meter: spec.meter,
    steps: grid.stepsPerBar,
    bars: rhythmBars,
    style: spec.rhythmStyle,
    density: spec.rhythmDensity,
    variation: spec.rhythmVariation,
    trackIds: spec.drumsOn === false ? [] : spec.trackIds,
  });

  const melodyBase = (spec.melodyOn === false || !chords.length) ? [] : generateMelody({
    rng: makeRng(`melody:${melodySeed}`),
    chords,
    rootPc: spec.rootPc,
    scaleId: spec.scaleId,
    stepsPerChord,
    stepsPerBeat: grid.pulse,
    density: spec.density,
    chordTones: spec.chordTones,
    restiness: spec.restiness,
    shape: spec.melodyShape,
    range: [spec.rangeLow, spec.rangeHigh],
  });
  const melodyEdits = emptyMelodyEdits();
  const melody = applyMelodyEdits(melodyBase, melodyEdits, {
    totalSteps: Math.max(grid.stepsPerBar, chords.length * stepsPerChord),
  });

  const bass = (spec.bassOn === false || !chords.length) ? [] : generateBass({
    rng: makeRng(`bass:${bassSeed}`),
    chords,
    rootPc: spec.rootPc,
    scaleId: spec.scaleId,
    stepsPerChord,
    stepsPerBeat: grid.pulse,
    style: spec.bassStyle,
    density: spec.bassDensity,
    motion: spec.bassMotion,
    counter: spec.bassCounter,
    octave: spec.bassOctave,
    rhythm: pattern,
    melody,
  });

  const music = {
    rootPc: spec.rootPc,
    scaleId: spec.scaleId,
    mode: spec.mode,
    length: spec.length,
    sevenths: round(spec.sevenths),
    spice: round(spec.spice),
    barsPerChord: spec.barsPerChord,
    stepsPerChord,
    ownChords: '',
    chords,
    voicings,
    locked: [],
    chordSeed,
    melodySeed,
    melodyBase,
    melodyEdits,
    melody,
    melodyShape: spec.melodyShape,
    density: round(spec.density),
    chordTones: round(spec.chordTones),
    restiness: round(spec.restiness),
    rangeLow: spec.rangeLow,
    rangeHigh: spec.rangeHigh,
    bassOn: spec.bassOn !== false && chords.length > 0,
    bassStyle: spec.bassStyle,
    bassSeed,
    bass,
    bassDensity: round(spec.bassDensity),
    bassMotion: round(spec.bassMotion),
    bassCounter: round(spec.bassCounter),
    bassOctave: spec.bassOctave,
    // Composed sections are voiced on purpose rather than by the seed: a song
    // whose every section arrives in a different random colour is a shuffle,
    // not an arrangement. Contrast in timbre is a decision here, like the key.
    leadInstrument: spec.palette.lead,
    harmonyInstrument: spec.palette.harmony,
    bassInstrument: spec.palette.bass,
  };

  const rhythm = {
    style: spec.rhythmStyle,
    steps: grid.stepsPerBar,
    bars: rhythmBars,
    density: round(spec.rhythmDensity),
    variation: round(spec.rhythmVariation),
    trackIds: spec.drumsOn === false ? [] : [...spec.trackIds],
    kit: spec.palette.kit,
    seed: rhythmSeed,
    pattern,
  };

  return makeSection({
    name: spec.name,
    kind: spec.kind,
    music,
    rhythm,
    meter: spec.meter,
    // Two places is plenty for how hard a section is played, and it keeps the
    // number readable in storage and on the card.
    dynamics: round(spec.dynamics),
    tempoScale: round(spec.tempoScale),
    traits: spec.traits,
  });
}

/** Sliders are stored to two places; a long float in a control reads as noise. */
function round(value) {
  return Math.round(value * 100) / 100;
}

// --- dealing a hand ---------------------------------------------------------

/**
 * Bumped whenever the code below would deal a different hand from the same
 * seed. Judgements carry it, and the trainer refuses to re-deal a round whose
 * dealer no longer exists — because scoring your opinion of one piece of music
 * against a different piece of music is worse than having no opinion at all.
 */
export const DEAL_VERSION = 1;

/** The bars the trainer deals in. Mostly four-square, sometimes not. */
const DEAL_METERS = [
  { value: { beats: 4, unit: 4 }, weight: 8 },
  { value: { beats: 3, unit: 4 }, weight: 2 },
  { value: { beats: 6, unit: 8 }, weight: 2 },
  { value: { beats: 5, unit: 4 }, weight: 1 },
  { value: { beats: 7, unit: 8 }, weight: 1 },
];

/**
 * How the second card relates to the first — which is the thing being judged as
 * much as the music is.
 *
 * A hand of two ideas that came from the same home section is the ordinary case
 * and the one the composer will be asked about most. A variant is the same idea
 * come back changed. A stranger is a section written from scratch in its own
 * key with its own colours, which is what a bad edit sounds like, and the model
 * needs to have heard some of those to know the difference.
 */
const RELATIONS = [
  { value: 'contrast', weight: 6 },
  { value: 'bridge', weight: 3 },
  { value: 'variant', weight: 3 },
  { value: 'stranger', weight: 2 },
];

/**
 * Deals a hand of sections to be judged.
 *
 * Everything here goes through the same generators, in the same order, off the
 * same kind of seeds as `composeSong` — which is not tidiness, it is the whole
 * point. A model trained on music from a different distribution than the one it
 * will be asked to score is a model that has learned to answer a question
 * nobody is going to ask it. So the trainer deals out of the composer's own
 * deck, with the dials thrown wide open so a session covers the range rather
 * than the middle of it.
 *
 * Pure and deterministic: the same seed deals the same hand for ever, which is
 * why a judgement only has to store twelve characters to be able to point at
 * the exact bars you were listening to when you made it.
 *
 * @param {object} options
 * @param {string} options.seed
 * @param {number} [options.cards] two or three
 * @returns {{seed:string, dealer:number, tempo:number, meter:object, contrast:number,
 *   cards:Array<{name:string, relation:string, section:object, traits:string[]}>}}
 */
export function dealRound({ seed = randomSeed(), cards = 2 } = {}) {
  const key = String(seed);
  const rng = makeRng(`deal:${key}`);
  const count = Math.min(3, Math.max(2, Math.round(cards)));

  const meter = pickWeighted(rng, DEAL_METERS);
  const tempo = pickTempo(rng);
  const rootPc = randInt(rng, 0, 11);
  const scaleId = pickWeighted(rng, [
    { value: 'major', weight: 4 }, { value: 'minor', weight: 4 },
    { value: 'dorian', weight: 1 }, { value: 'mixolydian', weight: 1 },
  ]);
  const bars = pickWeighted(rng, [{ value: 8, weight: 5 }, { value: 4, weight: 3 }, { value: 12, weight: 1 }]);

  // The dials are rolled per hand rather than held at the default, so a
  // session of judgements covers "these two are nearly the same" and "these two
  // have nothing to do with each other" and everything between.
  const contrast = rng();
  const settings = {
    ...defaultComposeSettings(), contrast, modulate: true, meterShifts: true, tempoShifts: true,
  };

  const home = homeSpec({
    rng, rootPc, scaleId, meter, bars, palette: pickPalette(rng),
  });
  home.name = 'A';
  home.seedKey = 'A';

  const specs = [home];
  const relations = ['home'];

  for (let index = 1; index < count; index++) {
    const relation = pickWeighted(rng, RELATIONS);
    const name = String.fromCharCode(65 + index);
    let spec;

    if (relation === 'variant') {
      // The same section, come back changed — an A′, judged as a card of its own.
      const pool = VARIANTS.filter((variant) => !variant.needs || variant.needs(settings));
      const variant = pickWeighted(rng, pool.map((item) => ({ value: item, weight: item.weight })));
      spec = {
        ...home, traits: [], palette: { ...home.palette }, trackIds: [...home.trackIds],
      };
      variant.apply(spec, rng);
      spec.traits.push(`A, ${spec.label || variant.label}`);
      spec.name = variantName('A', index);
      spec.seedKey = 'A';
      spec.melodyKey = spec.rerollMelody ? `A${index}` : 'A';
    } else if (relation === 'stranger') {
      // Not a departure from anything: its own key, its own colours, its own
      // idea. Sometimes that is exactly the shock a song wants and sometimes it
      // is two songs stapled together, and only you can say which.
      spec = homeSpec({
        rng,
        rootPc: randInt(rng, 0, 11),
        scaleId: pickWeighted(rng, [
          { value: 'major', weight: 3 }, { value: 'minor', weight: 3 },
          { value: 'lydian', weight: 1 }, { value: 'phrygian', weight: 1 },
        ]),
        meter: chance(rng, 0.75) ? meter : pickWeighted(rng, DEAL_METERS),
        bars: pickWeighted(rng, [{ value: bars, weight: 3 }, { value: 4, weight: 1 }, { value: 8, weight: 1 }]),
        palette: pickPalette(rng),
      });
      spec.traits = ['written on its own, not against A'];
      spec.name = name;
      spec.seedKey = name;
    } else {
      spec = contrastSpec(home, {
        rng,
        settings,
        contrast,
        home,
        kind: relation === 'bridge' ? 'bridge' : 'main',
        index,
      });
      spec.name = name;
      spec.seedKey = name;
    }

    specs.push(spec);
    relations.push(relation);
  }

  return {
    seed: key,
    dealer: DEAL_VERSION,
    tempo,
    meter,
    contrast: round(contrast),
    key: keyLabel(rootPc, scaleId),
    cards: specs.map((spec, index) => ({
      name: spec.name,
      relation: relations[index],
      // A card is an ordinary section, so it plays, exports and can be dragged
      // into a song exactly like anything else you saved by hand.
      section: renderSection(spec, { seed: `deal:${key}` }),
      traits: [...(spec.traits || [])],
    })),
  };
}
