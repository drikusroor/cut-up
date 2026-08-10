// The humanizer: what stops the thing sounding like a sequencer.
//
// Nobody plays on the grid. A player is late on some notes and early on others,
// and — more tellingly — is late or early *consistently*: a drummer pushes the
// hats and drags the snare, a bass player sits behind the beat all night. Those
// are two different things, so there are two knobs for them:
//
//   spread  how far each note wanders off its step, at random
//   push    which side of the step the part sits on, all the time
//           (rush = early, lag = late)
//
// Both are per part, because a band is not one player, and both are scaled by a
// master amount so the whole thing can be tightened back to a machine.
//
// The deviations are *seeded*, not rolled fresh: the same seed, the same step
// and the same part always give back the same offset. That is what lets the
// MIDI export be the take you just heard rather than a different one, and it is
// the same promise the rest of the app makes about its generators.

import { makeRng } from '../rng.js';

/** The four parts that can be humanised, in the order the transport lists them. */
export const HUMANIZE_PARTS = [
  { id: 'drums', label: 'Drums' },
  { id: 'bass', label: 'Bass' },
  { id: 'chords', label: 'Chords' },
  { id: 'melody', label: 'Melody' },
];

/**
 * How far a fully humanised part strays, in steps. A sixteenth at 100bpm is
 * 150ms, so 0.3 of one is a lazy-but-still-musical 45ms — about as far as a
 * real player goes before it stops sounding like feel and starts sounding like
 * a mistake.
 */
const MAX_SPREAD = 0.3;

/** How far a rushing or dragging part sits off the beat, in steps. */
const MAX_PUSH = 0.22;

/** @returns {{amount:number, seed:string, parts:Record<string,{spread:number, push:number}>}} */
export function defaultHumanize() {
  return {
    amount: 0,
    seed: 'feel',
    parts: Object.fromEntries(HUMANIZE_PARTS.map((part) => [part.id, { spread: 0.5, push: 0 }])),
  };
}

/** Fills in whatever an older saved state, or a caller, left out. */
export function normalizeHumanize(feel) {
  const base = defaultHumanize();
  const amount = Number(feel?.amount);
  return {
    amount: Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : 0,
    seed: feel?.seed || base.seed,
    parts: Object.fromEntries(HUMANIZE_PARTS.map((part) => {
      const stored = feel?.parts?.[part.id] || {};
      const spread = Number(stored.spread);
      const push = Number(stored.push);
      return [part.id, {
        spread: Number.isFinite(spread) ? Math.min(1, Math.max(0, spread)) : base.parts[part.id].spread,
        push: Number.isFinite(push) ? Math.min(1, Math.max(-1, push)) : 0,
      }];
    })),
  };
}

/** True when nothing is being humanised, so callers can skip the work. */
export function isMachineTight(feel) {
  return normalizeHumanize(feel).amount <= 0;
}

/**
 * How far off its step one note lands, in steps. Positive is late.
 *
 * The random part is the average of two draws rather than one, which piles the
 * offsets up around zero instead of spreading them flat: most notes nearly
 * right, a few noticeably out. That is what a player's timing actually looks
 * like when you measure it.
 *
 * @param {string} part one of HUMANIZE_PARTS
 * @param {number} step absolute step in the arrangement
 * @param {object} [feel] the humanize settings
 * @param {number|string} [voice] optional extra salt, so two pieces of the kit
 *   landing on the same step do not land on exactly the same offset
 * @returns {number} offset in steps
 */
export function humanizeOffset(part, step, feel, voice = '') {
  const { amount, seed, parts } = normalizeHumanize(feel);
  if (amount <= 0) return 0;
  const settings = parts[part];
  if (!settings) return 0;

  const rng = makeRng(`${seed}:${part}:${voice}:${step}`);
  const centred = (rng() + rng()) / 2 - 0.5; // -0.5..0.5, humped in the middle
  const spread = centred * 2 * MAX_SPREAD * settings.spread * amount;
  const push = settings.push * MAX_PUSH * amount;
  return spread + push;
}

/** The label for a rush/lag setting, for the readout under the slider. */
export function pushLabel(push) {
  const value = Number(push) || 0;
  if (Math.abs(value) < 0.05) return 'on the beat';
  const strength = Math.abs(value) > 0.66 ? 'hard' : Math.abs(value) > 0.33 ? '' : 'a touch';
  const side = value < 0 ? 'rushing' : 'dragging';
  return [strength, side].filter(Boolean).join(' ').replace('hard rushing', 'rushing hard').replace('hard dragging', 'dragging hard');
}
