// Tuning: how far off a perfect twelve-tone piano this is allowed to get.
//
// Two separate ideas share this file, because they are the same arithmetic.
//
// *Temperament* is where the notes are. Equal temperament cuts the octave into
// twelve identical steps, which is a compromise nothing before about 1700 was
// interested in and no instrument with a fret or a valve fully obeys now. The
// alternatives here are the old ones — just intonation, Pythagorean, meantone —
// and the microtonal one: cut the octave into some other number of parts (19,
// 21, 27, 31…) and put the twelve notes of the key on the nearest ones. You
// still play in a key, with twelve notes and the chords you know; they simply
// are not where a piano would put them. The octave stays pure whatever you
// choose, so nothing drifts as it goes up.
//
// *Detune* is where the players are. Two instruments are never in tune with
// each other, and no instrument is quite in tune with itself from one note to
// the next. A fixed offset per part is a string section that tuned five minutes
// ago; a wobble per note is a singer.
//
// Everything is expressed in cents (100 to the semitone) off equal temperament,
// so equal temperament with no detune is exactly zero everywhere and the app
// sounds precisely as it did before any of this existed.

import { makeRng } from '../rng.js';

/** Cents above the tonic for the twelve notes of a key, per temperament. */
const TEMPERAMENTS = {
  // 5-limit just: the intervals as small whole-number ratios. Sweet in the home
  // key, increasingly strange as you walk away from it — which is the point.
  just: [0, 111.73, 203.91, 315.64, 386.31, 498.04, 590.22, 701.96, 813.69, 884.36, 996.09, 1088.27],
  // Stacked pure fifths. Bright thirds, and the wolf has to go somewhere.
  pythagorean: [0, 90.22, 203.91, 294.13, 407.82, 498.04, 611.73, 701.96, 792.18, 905.87, 996.09, 1109.78],
  // Quarter-comma meantone: pure major thirds, bought with narrow fifths. What
  // a lot of the music people think of as "early" was actually written for.
  meantone: [0, 76.05, 193.16, 310.26, 386.31, 503.42, 579.47, 696.58, 772.63, 889.74, 1006.84, 1082.89],
};

export const TUNING_SYSTEMS = [
  {
    id: 'equal',
    label: 'Equal divisions of the octave',
    hint: '12 is the piano. Anything else keeps the twelve notes of the key but moves them onto a finer grid — 19, 24, 31 all sound like themselves.',
    divisible: true,
  },
  { id: 'just', label: 'Just intonation', hint: 'Whole-number ratios. Pure in the home key, and stranger the further you walk from it.' },
  { id: 'pythagorean', label: 'Pythagorean', hint: 'Pure fifths stacked all the way round. Bright thirds, one bad fifth.' },
  { id: 'meantone', label: 'Quarter-comma meantone', hint: 'Pure major thirds, narrow fifths. What a lot of pre-piano music was written for.' },
];

/** How far apart an octave's worth of equal divisions may be spread. */
export const DIVISION_RANGE = [5, 72];

/** Ceiling on the "every instrument is slightly out" slider, in cents. */
export const MAX_DETUNE = 30;

/** Ceiling on the note-to-note wobble, in cents. */
export const MAX_DRIFT = 20;

/**
 * The parts that get their own detune offset, named after the instrument slots
 * they are played on. The drums are unpitched, so they sit this one out.
 */
export const TUNED_PARTS = ['lead', 'harmony', 'bass'];

/** @returns {{system:string, divisions:number, detune:number, drift:number, seed:string}} */
export function defaultTuning() {
  return {
    system: 'equal', divisions: 12, detune: 0, drift: 0, seed: 'tune',
  };
}

/** Fills in whatever an older saved state, or a caller, left out. */
export function normalizeTuning(tuning) {
  const base = defaultTuning();
  const divisions = Math.round(Number(tuning?.divisions));
  const detune = Number(tuning?.detune);
  const drift = Number(tuning?.drift);
  return {
    system: TUNING_SYSTEMS.some((s) => s.id === tuning?.system) ? tuning.system : base.system,
    divisions: Number.isFinite(divisions)
      ? Math.min(DIVISION_RANGE[1], Math.max(DIVISION_RANGE[0], divisions))
      : base.divisions,
    detune: Number.isFinite(detune) ? Math.min(MAX_DETUNE, Math.max(0, detune)) : 0,
    drift: Number.isFinite(drift) ? Math.min(MAX_DRIFT, Math.max(0, drift)) : 0,
    seed: tuning?.seed || base.seed,
  };
}

/** True when this is a plain twelve-tone piano and nothing needs bending. */
export function isEqualTempered(tuning) {
  const { system, divisions } = normalizeTuning(tuning);
  return system === 'equal' && divisions === 12;
}

/**
 * How far one note sits off equal temperament, in cents, because of the
 * temperament alone.
 *
 * Everything is measured from the tonic rather than from C: the key you are in
 * is the key that is in tune, which is the whole bargain of an unequal
 * temperament. Octaves stay pure, so only the note's pitch class matters.
 *
 * @param {number} midi
 * @param {object} [tuning]
 * @param {number} [rootPc] the key's root pitch class
 * @returns {number} cents, positive is sharp
 */
export function temperamentCents(midi, tuning, rootPc = 0) {
  const { system, divisions } = normalizeTuning(tuning);
  const degree = (((Math.round(midi) - Math.round(rootPc)) % 12) + 12) % 12;

  const table = TEMPERAMENTS[system];
  if (table) return table[degree] - degree * 100;

  if (divisions === 12) return 0;
  // The twelve notes of the key land on whichever divisions come nearest.
  // 19 and 31 pull the thirds flat, 17 pushes them sharp; either way the tonic,
  // and the octave above it, stay exactly where they were.
  const nearest = Math.round((degree * divisions) / 12);
  return nearest * (1200 / divisions) - degree * 100;
}

/**
 * The fixed offset a part is out by: this section's violins, tuned five minutes
 * ago and drifting since. Seeded, so a piece keeps the same slightly-wrong
 * tuning every time it is played rather than being re-tuned on every pass.
 *
 * @param {string} part one of TUNED_PARTS
 * @param {object} [tuning]
 * @returns {number} cents
 */
export function partDetuneCents(part, tuning) {
  const { detune, seed } = normalizeTuning(tuning);
  if (detune <= 0) return 0;
  const rng = makeRng(`detune:${seed}:${part}`);
  return (rng() * 2 - 1) * detune;
}

/**
 * The wobble from one note to the next — a finger landing a hair off, a reed
 * warming up. Keyed to the note as well as the part, so held chords do not all
 * bend the same way.
 *
 * @returns {number} cents
 */
export function driftCents(part, step, midi, tuning) {
  const { drift, seed } = normalizeTuning(tuning);
  if (drift <= 0) return 0;
  const rng = makeRng(`drift:${seed}:${part}:${step}:${midi}`);
  return ((rng() + rng()) / 2 - 0.5) * 2 * drift;
}

/**
 * Everything that moves one note off the piano, added up. Playback and MIDI
 * export both call this, so an exported file bends the same way it sounded.
 *
 * @param {object} opts
 * @param {string} opts.part one of TUNED_PARTS
 * @param {number} opts.midi
 * @param {number} [opts.step]
 * @param {number} [opts.rootPc]
 * @param {object} [opts.tuning]
 * @returns {number} cents
 */
export function noteCents({
  part, midi, step = 0, rootPc = 0, tuning,
}) {
  return temperamentCents(midi, tuning, rootPc)
    + partDetuneCents(part, tuning)
    + driftCents(part, step, midi, tuning);
}

/** "31 equal divisions" / "Just intonation", for a readout. */
export function tuningLabel(tuning) {
  const { system, divisions } = normalizeTuning(tuning);
  const spec = TUNING_SYSTEMS.find((s) => s.id === system);
  if (system !== 'equal') return spec?.label || system;
  return divisions === 12 ? 'Equal temperament (the piano)' : `${divisions} equal divisions of the octave`;
}
