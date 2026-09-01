// The moves, taken off the composer and put in your hands.
//
// When the composer writes a song it does not write five sections; it writes
// one and then *pulls the others away from it* — into the parallel major, with
// no bass, with the tune sitting higher, in another colour, played at 80%. Each
// of those is a small, named edit to a section's settings, and the card on the
// Song tab prints the ones it made so a section can say where it went.
//
// Until now that list was read-only: the dice made those decisions and you
// lived with them. This file is the same list of moves, extracted so that the
// regenerate dialog can offer them as controls — tick "no bass" and the bass
// goes, untick it and it comes back, drag the dynamics dial and the section is
// played harder. The composer's own MOVES and VARIANTS in compose.js still work
// on *specs* — settings on their way to becoming music — because that is what
// the composer has at that moment. These work on a finished section, which is
// what you have at the moment you want to change your mind.
//
// Three kinds of thing live here, and the difference is whether the section can
// be asked what it is currently doing:
//
//   switch   a state you can read off the music and set either way — no bass,
//            no drums, no tune. The card derives its own words for these, so
//            they can never go stale.
//   dial     a number you can read and move — how hard it is played, how fast.
//   move     a one-way push with no obvious inverse — busier, up an octave,
//            another colour underneath. Applying one leaves a trait behind
//            saying what it did.
//
// A move mostly cannot do its own work: making a section busier means writing a
// busier melody, which is the melody generator's job. So a move says which
// aspects have to be rolled afterwards, and regenerateSection rolls them.

import { pick } from '../rng.js';
import {
  BASS_INSTRUMENTS, DRUM_KITS, HARMONY_INSTRUMENTS, LEAD_INSTRUMENTS, resolveInstruments,
} from './instruments.js';

/** Scales that behave like a minor — the ones a relative major is measured from. */
const MINORISH = new Set(['minor', 'dorian', 'phrygian', 'harmonicMinor', 'melodicMinor', 'locrian', 'minorPentatonic', 'blues']);

/** The drums a section gets back when you switch them on again. */
const PLAIN_KIT = ['kick', 'snare', 'hat'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round2 = (value) => Math.round(value * 100) / 100;

/** A voice that is not the one it has, so a change of colour is audible. */
function otherThan(rng, list, current) {
  const options = list.filter((item) => item.id !== current);
  return pick(rng, options.length ? options : list).id;
}

// --- moving the key ---------------------------------------------------------

/**
 * The key changes the composer makes, as functions of the key you are in.
 *
 * These are not variations — they are shortcuts for the two key controls in the
 * dialog, because "the relative minor of A♭ major" is a thing you want and not
 * a thing you should have to work out. Each answers with a key; what the dialog
 * does with it is the dialog's business.
 */
export const KEY_MOVES = [
  {
    id: 'relative',
    label: 'The relative',
    hint: 'Minor to its major a third up, or back the other way. The same notes, a different home.',
    move: ({ rootPc, scaleId }) => {
      const toMajor = MINORISH.has(scaleId);
      return { rootPc: (rootPc + (toMajor ? 3 : 9)) % 12, scaleId: toMajor ? 'major' : 'minor' };
    },
  },
  {
    id: 'parallel',
    label: 'The parallel',
    hint: 'Same tonic, other mode — the oldest way to make a chorus mean something else.',
    move: ({ rootPc, scaleId }) => ({
      rootPc, scaleId: MINORISH.has(scaleId) ? 'major' : 'minor',
    }),
  },
  {
    id: 'fourth',
    label: 'Up a fourth',
    hint: 'The plagal move. Everything sounds like it has arrived somewhere.',
    move: ({ rootPc, scaleId }) => ({ rootPc: (rootPc + 5) % 12, scaleId }),
  },
  {
    id: 'fifth',
    label: 'Up a fifth',
    hint: 'The other way round the circle — brighter, and it pulls back home on its own.',
    move: ({ rootPc, scaleId }) => ({ rootPc: (rootPc + 7) % 12, scaleId }),
  },
  {
    id: 'semitone',
    label: 'Up a semitone',
    hint: 'The last-chorus key change. Cheap, effective, and everybody does it.',
    move: ({ rootPc, scaleId }) => ({ rootPc: (rootPc + 1) % 12, scaleId }),
  },
  {
    id: 'flatSixth',
    label: 'Up to the flat sixth',
    hint: 'The borrowed, cinematic one — a major chord a minor sixth above where you were.',
    move: ({ rootPc }) => ({ rootPc: (rootPc + 8) % 12, scaleId: 'major' }),
  },
];

export function keyMove(id, key) {
  const found = KEY_MOVES.find((entry) => entry.id === id);
  if (!found) return { ...key };
  const next = found.move(key);
  return { rootPc: ((next.rootPc % 12) + 12) % 12, scaleId: next.scaleId };
}

// --- the catalogue ----------------------------------------------------------

/** The headings the dialog groups the list under. */
export const VARIATION_GROUPS = [
  { id: 'parts', label: 'What plays' },
  { id: 'sound', label: 'What it sounds like' },
  { id: 'shape', label: 'How it is built' },
  { id: 'feel', label: 'How it is played' },
];

/**
 * Every move you can make on a section, and what it costs.
 *
 * `rolls` is the aspects that have to be generated again for the change to
 * mean anything — asking for a busier section without writing a new melody
 * changes a number and nothing you can hear.
 *
 * `enables` says the section is to have a part it currently does not, which is
 * the one thing a regeneration will not do on its own: a section saved without
 * a tune was written that way on purpose, and only an explicit ask puts one in.
 */
export const VARIATIONS = [
  // --- what plays -----------------------------------------------------------
  {
    id: 'noBass',
    kind: 'switch',
    group: 'parts',
    label: 'No bass',
    trait: 'no bass',
    hint: 'Takes the bottom out. A breakdown, or a verse that leaves room for one.',
    read: (section) => section.music?.bassOn === false,
    set(section, on) {
      if (on) {
        section.music.bassOn = false;
        section.music.bass = [];
        return {};
      }
      section.music.bassOn = true;
      return { rolls: ['bass'] };
    },
  },
  {
    id: 'noDrums',
    kind: 'switch',
    group: 'parts',
    label: 'No drums',
    trait: 'no drums',
    hint: 'The band drops out and leaves the harmony standing there.',
    read: (section) => !(section.rhythm?.trackIds || []).length,
    set(section, on) {
      section.rhythm.trackIds = on ? [] : [...PLAIN_KIT];
      return { rolls: ['drums'] };
    },
  },
  {
    id: 'noTune',
    kind: 'switch',
    group: 'parts',
    label: 'No tune',
    trait: 'no tune',
    hint: 'Chords, bass and drums with nothing on top — an intro, or a space for a solo.',
    read: (section) => !(section.music?.melodyBase || []).length
      && !(section.music?.melody || []).length,
    set(section, on) {
      if (on) {
        section.music.melodyBase = [];
        section.music.melody = [];
        return {};
      }
      return { rolls: ['melody'], enables: ['melody'] };
    },
  },

  // --- what it sounds like --------------------------------------------------
  {
    id: 'voices',
    kind: 'move',
    group: 'sound',
    label: 'Another set of voices',
    trait: 'another set of voices',
    hint: 'All four players swapped for different ones. Not a note changes.',
    rolls: ['instruments'],
  },
  {
    id: 'colour',
    kind: 'move',
    group: 'sound',
    label: 'Another colour underneath',
    trait: 'another colour underneath',
    hint: 'New harmony and lead, same bass and the same kit — the middle-eight move.',
    apply(section, { rng }) {
      const current = resolveInstruments(section.music, section.rhythm);
      section.music.harmonyInstrument = otherThan(rng, HARMONY_INSTRUMENTS, current.harmony);
      section.music.leadInstrument = otherThan(rng, LEAD_INSTRUMENTS, current.lead);
    },
  },
  {
    id: 'kit',
    kind: 'move',
    group: 'sound',
    label: 'A different kit',
    trait: 'a different kit',
    hint: 'Other drums, other pieces, another way of laying out the bar.',
    rolls: ['drums'],
    apply(section, { rng }) {
      const current = resolveInstruments(section.music, section.rhythm);
      section.rhythm.kit = otherThan(rng, DRUM_KITS, current.kit);
      section.rhythm.style = pick(rng, ['euclid', 'backbeat', 'polyrhythm', 'cutup', 'chance']);
      // A kit with no pieces in it is silence however good the kit is.
      if (!(section.rhythm.trackIds || []).length) section.rhythm.trackIds = [...PLAIN_KIT];
    },
  },
  {
    id: 'bassVoice',
    kind: 'move',
    group: 'sound',
    label: 'Another bass',
    trait: 'another bass',
    hint: 'A different instrument on the bottom line, playing the same notes.',
    needs: (section) => section.music?.bassOn !== false,
    apply(section, { rng }) {
      const current = resolveInstruments(section.music, section.rhythm);
      section.music.bassInstrument = otherThan(rng, BASS_INSTRUMENTS, current.bass);
    },
  },

  // --- how it is built ------------------------------------------------------
  {
    id: 'faster',
    kind: 'move',
    group: 'shape',
    label: 'The chords move twice as fast',
    trait: 'the chords move twice as fast',
    hint: 'Same number of bars, twice as many changes in them.',
    needs: (section) => (section.music?.chords || []).length > 0
      && (section.music?.barsPerChord || 1) > 0.5,
    rolls: ['chords', 'melody', 'bass'],
    apply(section) {
      section.music.barsPerChord = (section.music.barsPerChord || 1) / 2;
      section.music.length = Math.min(12, Math.max(2, Math.round((section.music.length || 4) * 2)));
      return { regrid: true };
    },
  },
  {
    id: 'slower',
    kind: 'move',
    group: 'shape',
    label: 'The chords are held twice as long',
    trait: 'the chords are held twice as long',
    hint: 'Same number of bars, half as many changes — the ground stops moving.',
    needs: (section) => (section.music?.chords || []).length > 1,
    rolls: ['chords', 'melody', 'bass'],
    apply(section) {
      section.music.barsPerChord = (section.music.barsPerChord || 1) * 2;
      section.music.length = Math.max(2, Math.round((section.music.length || 4) / 2));
      return { regrid: true };
    },
  },
  {
    id: 'halve',
    kind: 'move',
    group: 'shape',
    label: 'Half the length',
    trait: 'half the length',
    hint: 'The first half of the progression, and a tune re-cut to fit it.',
    needs: (section) => (section.music?.chords || []).length >= 4,
    rolls: ['melody', 'bass'],
    apply(section) {
      const length = Math.max(2, Math.round((section.music.chords || []).length / 2));
      section.music.chords = section.music.chords.slice(0, length);
      section.music.length = length;
      section.music.locked = [];
    },
  },
  {
    id: 'double',
    kind: 'move',
    group: 'shape',
    label: 'Twice the length',
    trait: 'twice the length',
    hint: 'The progression round again, with a tune written across both times.',
    needs: (section) => {
      const length = (section.music?.chords || []).length;
      return length > 0 && length * 2 <= 24;
    },
    rolls: ['melody', 'bass'],
    apply(section) {
      section.music.chords = [...section.music.chords, ...section.music.chords];
      section.music.length = section.music.chords.length;
      section.music.locked = [];
    },
  },
  {
    id: 'vamp',
    kind: 'move',
    group: 'shape',
    label: 'A modal vamp',
    trait: 'a modal vamp',
    hint: 'Two or three chords going round instead of a progression going somewhere.',
    needs: (section) => (section.music?.chords || []).length > 0,
    rolls: ['chords', 'melody', 'bass'],
    apply(section) {
      section.music.mode = 'vamp';
      section.music.spice = Math.max(section.music.spice || 0, 0.25);
    },
  },

  // --- how it is played -----------------------------------------------------
  {
    id: 'busier',
    kind: 'move',
    group: 'feel',
    label: 'Busier, and more chromatic',
    trait: 'busier, and more chromatic',
    hint: 'More notes, fewer rests, more sevenths and more colour in the changes.',
    rolls: ['chords', 'melody'],
    apply(section, { rng }) {
      const m = section.music;
      m.density = round2(clamp((m.density ?? 0.45) + 0.25, 0, 0.9));
      m.restiness = round2(clamp((m.restiness ?? 0.2) - 0.1, 0.05, 1));
      m.sevenths = round2(clamp((m.sevenths ?? 0.2) + 0.25, 0, 1));
      m.spice = round2(clamp((m.spice ?? 0.15) + 0.2, 0, 1));
      m.melodyShape = pick(rng, ['leaps', 'arch']);
    },
  },
  {
    id: 'sparser',
    kind: 'move',
    group: 'feel',
    label: 'More air in it',
    trait: 'more air in it',
    hint: 'Fewer notes and longer rests. The hardest thing to make yourself do.',
    rolls: ['melody'],
    apply(section) {
      const m = section.music;
      m.density = round2(clamp((m.density ?? 0.45) - 0.18, 0.15, 1));
      m.restiness = round2(clamp((m.restiness ?? 0.2) + 0.2, 0, 0.7));
    },
  },
  {
    id: 'heldBack',
    kind: 'move',
    group: 'feel',
    label: 'Held back',
    trait: 'held back',
    hint: 'Quieter, thinner drums, the bass on roots. A verse after a big chorus.',
    rolls: ['melody', 'bass', 'drums'],
    dials: { dynamics: 0.68 },
    apply(section) {
      const m = section.music;
      m.density = round2(clamp((m.density ?? 0.45) - 0.12, 0.2, 1));
      m.bassStyle = 'roots';
      section.rhythm.density = round2(clamp((section.rhythm.density ?? 0.5) - 0.2, 0.15, 1));
    },
  },
  {
    id: 'flatOut',
    kind: 'move',
    group: 'feel',
    label: 'Flat out',
    trait: 'flat out',
    hint: 'Louder, busier drums, the bass pushing. The last chorus.',
    rolls: ['bass', 'drums'],
    dials: { dynamics: 1.18 },
    apply(section, { rng }) {
      section.music.bassStyle = pick(rng, ['pump', 'lock']);
      section.rhythm.density = round2(clamp((section.rhythm.density ?? 0.5) + 0.2, 0, 0.95));
      section.rhythm.trackIds = [...new Set([...(section.rhythm.trackIds || PLAIN_KIT), 'crash'])];
    },
  },
  {
    id: 'higher',
    kind: 'move',
    group: 'feel',
    label: 'The tune sits higher',
    trait: 'the tune sits higher',
    hint: 'The whole line up a fifth, notes and all — nothing is rewritten.',
    needs: (section) => (section.music?.melodyBase || []).length > 0,
    apply: (section) => shiftTune(section, 7),
  },
  {
    id: 'lower',
    kind: 'move',
    group: 'feel',
    label: 'The tune sits lower',
    trait: 'the tune sits lower',
    hint: 'And the same the other way, down a fourth.',
    needs: (section) => (section.music?.melodyBase || []).length > 0,
    apply: (section) => shiftTune(section, -5),
  },
  {
    id: 'octave',
    kind: 'move',
    group: 'feel',
    label: 'The tune an octave up',
    trait: 'the tune an octave up',
    hint: 'The same line, an octave above. The oldest way to make a repeat matter.',
    needs: (section) => (section.music?.melodyBase || []).length > 0,
    apply: (section) => shiftTune(section, 12),
  },

  // --- the dials ------------------------------------------------------------
  {
    id: 'dynamics',
    kind: 'dial',
    group: 'feel',
    label: 'Played at',
    hint: 'How hard the section is played, against the rest of the song.',
    min: 0.4,
    max: 1.4,
    step: 0.02,
    read: (section) => section.dynamics ?? 1,
    write(section, value) {
      const level = round2(clamp(value, 0.4, 1.4));
      if (level === 1) delete section.dynamics;
      else section.dynamics = level;
    },
    describe: (value) => `played at ${Math.round(value * 100)}%`,
    // A hair either side of 1 is not worth saying out loud.
    silent: (value) => value > 0.98 && value < 1.02,
  },
  {
    id: 'tempoScale',
    kind: 'dial',
    group: 'feel',
    label: 'Taken at',
    hint: 'This section against the transport — a half-time coda, a chorus pushed a shade faster.',
    min: 0.7,
    max: 1.35,
    step: 0.01,
    read: (section) => section.tempoScale ?? 1,
    write(section, value) {
      const scale = round2(clamp(value, 0.7, 1.35));
      if (scale === 1) delete section.tempoScale;
      else section.tempoScale = scale;
    },
    describe: (value) => `taken at ${Math.round(value * 100)}% of the tempo`,
    silent: (value) => value === 1,
  },
];

/** The tune moved bodily, hand edits and all, without being rewritten. */
function shiftTune(section, semitones) {
  const m = section.music;
  const move = (note) => ({ ...note, midi: note.midi + semitones });
  m.melodyBase = (m.melodyBase || []).map(move);
  m.melody = (m.melody || []).map(move);
  m.rangeLow = (m.rangeLow ?? 60) + semitones;
  m.rangeHigh = (m.rangeHigh ?? 84) + semitones;
}

export const VARIATION_IDS = VARIATIONS.map((variation) => variation.id);

export function getVariation(id) {
  return VARIATIONS.find((variation) => variation.id === id) || null;
}

/** The switches and dials, which are the ones with a state to show. */
export const SWITCHES = VARIATIONS.filter((v) => v.kind === 'switch');
export const DIALS = VARIATIONS.filter((v) => v.kind === 'dial');
export const MOVES = VARIATIONS.filter((v) => v.kind === 'move');

/**
 * Whether a move is worth offering on this section. A section with no tune
 * cannot have its tune put up an octave, and saying so beforehand is kinder
 * than doing nothing when it is asked for.
 */
export function variationApplies(variation, section) {
  return !variation.needs || variation.needs(section);
}

// --- what a section is currently doing --------------------------------------

/**
 * The traits a section can be *asked* for rather than told.
 *
 * Anything a switch or a dial owns is derived here, every time the card is
 * drawn, rather than stored — because a stored "no bass" on a section that has
 * had its bass put back is a lie, and a card that lies about the music is
 * worse than a card that says nothing.
 */
export function describeSectionState(section) {
  if (!section) return [];
  const out = [];
  for (const variation of SWITCHES) {
    if (variation.read(section)) out.push(variation.trait);
  }
  for (const variation of DIALS) {
    const value = variation.read(section);
    if (!variation.silent(value)) out.push(variation.describe(value));
  }
  return out;
}

/**
 * The composer's own compound words for a section that is missing parts, and
 * which switches each of them already accounts for.
 *
 * "Drums alone" says more than "no bass · no tune" does — it also says there are
 * no chords, which is not a switch — so the phrase is kept and the switches it
 * covers are not repeated underneath it.
 */
const IMPLIED = new Map([
  ['drums alone', ['noBass', 'noTune']],
  ['just the tune, no band', ['noBass', 'noDrums']],
  ['chords on their own', ['noTune']],
  ['the band, before the tune arrives', ['noTune']],
]);

/** A switch's own words for itself, which the card derives and never stores. */
const SWITCH_TRAITS = new Set(SWITCHES.map((variation) => variation.trait));

/**
 * Drops any stored trait that is no longer true of the section, and hands back
 * what is left. Called once while the variations are applied and again by
 * regenerateSection once the music has actually been written, because a "no
 * tune" that is about to be given a tune is only stale after the tune arrives.
 *
 * Two different rules, because there are two kinds of claim in there. A plain
 * "no bass" is a statement of state and nothing else, so it goes unconditionally
 * — the card derives that from the music, and one fact with two sources is one
 * source too many. A compound phrase like "drums alone" says more than the
 * switches can (that there are no chords either), so it is worth keeping — but
 * only while it is still true, which it stops being the moment any part it
 * claims is missing has been put back.
 */
export function pruneStaleTraits(section) {
  const stillOff = (id) => Boolean(getVariation(id)?.read(section));
  return (section.traits || []).filter((trait) => {
    if (SWITCH_TRAITS.has(trait)) return false;
    const implied = IMPLIED.get(trait);
    // A phrase like "drums alone" is true only while every part it says is
    // missing is still missing.
    return !implied || implied.every(stillOff);
  });
}

/**
 * The whole line under a section card: where it has been, then what it is doing.
 *
 * The first half is stored on the section — the moves the composer made, or the
 * ones you asked for. The second half is measured off the music every time,
 * minus anything the first half has already said.
 */
export function sectionTraitLine(section) {
  const stored = section?.traits || [];
  const ids = new Set(stored.flatMap((trait) => IMPLIED.get(trait) || []));
  const covered = new Set(SWITCHES.filter((v) => ids.has(v.id)).map((v) => v.trait));
  return [...stored, ...describeSectionState(section).filter((trait) => !covered.has(trait))];
}

/**
 * What is switched on, what the dials say, and which one-way moves this section
 * could still be sent on. This is what the regenerate dialog draws itself from.
 */
export function readVariations(section) {
  const switches = {};
  for (const variation of SWITCHES) switches[variation.id] = variation.read(section);
  const dials = {};
  for (const variation of DIALS) dials[variation.id] = variation.read(section);
  return {
    switches,
    dials,
    available: MOVES.filter((variation) => variationApplies(variation, section))
      .map((variation) => variation.id),
  };
}

/**
 * Applies an edit to a section's variations, in place.
 *
 * Switches are set to whatever you asked for, whether or not that is what they
 * already said; dials are written only when you name them, so a move that
 * lowers the volume is not immediately undone by a dial you never touched; and
 * moves are applied in the order they are listed here rather than the order
 * they arrived, so two of them always compose the same way round.
 *
 * @param {object} section a section, which is mutated
 * @param {{switches?: Record<string, boolean>, dials?: Record<string, number>,
 *   moves?: string[]}} wanted
 * @param {{rng: () => number}} context
 * @returns {{rolls: Set<string>, enables: Set<string>, regrid: boolean,
 *   traits: string[]}}
 */
export function applyVariations(section, wanted = {}, { rng = Math.random } = {}) {
  const rolls = new Set();
  const enables = new Set();
  const traits = [];
  let regrid = false;

  const take = (result, variation) => {
    for (const aspect of variation.rolls || []) rolls.add(aspect);
    for (const aspect of result?.rolls || []) rolls.add(aspect);
    for (const aspect of variation.enables || []) enables.add(aspect);
    for (const aspect of result?.enables || []) enables.add(aspect);
    regrid = regrid || Boolean(result?.regrid);
  };

  for (const variation of SWITCHES) {
    const on = wanted.switches?.[variation.id];
    if (typeof on !== 'boolean') continue;
    if (variation.read(section) === on) continue;
    take(variation.set(section, on), variation);
  }

  // Moves before dials: a move may set a dial, and a dial you moved by hand
  // should win over one a move nudged for you.
  const asked = new Set(wanted.moves || []);
  for (const variation of MOVES) {
    if (!asked.has(variation.id) || !variationApplies(variation, section)) continue;
    take(variation.apply?.(section, { rng }), variation);
    for (const [dial, value] of Object.entries(variation.dials || {})) {
      getVariation(dial)?.write(section, value);
    }
    if (variation.trait) traits.push(variation.trait);
  }

  for (const variation of DIALS) {
    const value = wanted.dials?.[variation.id];
    if (!Number.isFinite(value)) continue;
    variation.write(section, value);
  }

  // The stored line is history — where this section has been. Anything in it
  // that has stopped being true is dropped here, whether or not this edit was
  // what stopped it.
  const kept = pruneStaleTraits(section);
  const merged = [...kept, ...traits.filter((trait) => !kept.includes(trait))];
  if (merged.length) section.traits = merged;
  else delete section.traits;

  return {
    rolls, enables, regrid, traits,
  };
}

/** "busier, and more chromatic and up an octave" — for the summary line. */
export function describeVariations(ids = []) {
  const labels = MOVES.filter((variation) => ids.includes(variation.id))
    .map((variation) => variation.trait || variation.label.toLowerCase());
  if (!labels.length) return '';
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
