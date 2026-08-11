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

/**
 * Writes a song.
 *
 * @param {object} options
 * @param {object} [options.settings] see defaultComposeSettings
 * @param {number} [options.tempo] what the transport is set to now
 * @param {{beats:number, unit:number}} [options.meter]
 * @param {number} [options.rootPc] the key to start from
 * @param {string} [options.scaleId]
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

  // 1. the letters
  const palette = pickPalette(rng);
  const home = homeSpec({
    rng, rootPc, scaleId, meter, bars: bodyBars, palette,
  });
  const letterSpecs = [home];
  for (let letter = 1; letter < form.letters; letter++) {
    letterSpecs.push(contrastSpec(home, {
      rng,
      settings,
      contrast: settings.contrast,
      home,
      kind: roleOf(shape, letter),
      index: letter,
    }));
  }
  letterSpecs.forEach((spec, index) => {
    spec.name = String.fromCharCode(65 + index);
    spec.seedKey = spec.name;
  });

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
