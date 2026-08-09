// Rhythm generation on a step grid.
//
// A pattern is a flat array of booleans, one per step, plus per-step velocity.
// 16 steps = one bar of 4/4 in sixteenth notes.

import { chance, pick, randInt, shuffle } from '../rng.js';

/** General MIDI drum notes, channel 10. */
export const TRACKS = [
  { id: 'kick', label: 'Kick', note: 36 },
  { id: 'snare', label: 'Snare', note: 38 },
  { id: 'clap', label: 'Clap', note: 39 },
  { id: 'hat', label: 'Closed hat', note: 42 },
  { id: 'openhat', label: 'Open hat', note: 46 },
  { id: 'tom', label: 'Tom', note: 45 },
  { id: 'rim', label: 'Rim', note: 37 },
];

export const RHYTHM_STYLES = [
  { id: 'euclid', label: 'Euclidean', hint: 'Pulses spread as evenly as possible across the bar.' },
  { id: 'backbeat', label: 'Backbeat', hint: 'Kick on the floor, snare on 2 and 4.' },
  { id: 'chance', label: 'Pure chance', hint: 'Every step is a coin flip weighted by density.' },
  { id: 'cutup', label: 'Cut-up', hint: 'Generate a bar, then chop it into strips and shuffle.' },
];

/**
 * Euclidean rhythm (Bjorklund): distribute `pulses` over `steps` as evenly as
 * possible. This is the pattern behind a huge amount of world percussion.
 *
 * @param {number} steps
 * @param {number} pulses
 * @param {number} [rotation]
 * @returns {boolean[]}
 */
export function euclidean(steps, pulses, rotation = 0) {
  const n = Math.max(0, Math.floor(steps));
  const k = Math.min(n, Math.max(0, Math.floor(pulses)));
  const out = new Array(n).fill(false);
  if (n === 0 || k === 0) return out;
  // Bresenham formulation — same result as Bjorklund, far less code.
  for (let i = 0; i < n; i++) {
    out[i] = Math.floor((i * k) / n) !== Math.floor(((i - 1) * k) / n);
  }
  if (!rotation) return out;
  const r = ((rotation % n) + n) % n;
  return out.slice(r).concat(out.slice(0, r));
}

/** Chops a pattern into strips of whole beats and reshuffles them. */
export function cutUpPattern(pattern, rng, stepsPerBeat = 4) {
  const strips = [];
  for (let i = 0; i < pattern.length; i += stepsPerBeat) {
    strips.push(pattern.slice(i, i + stepsPerBeat));
  }
  return shuffle(rng, strips).flat().slice(0, pattern.length);
}

/**
 * Generates a full kit pattern.
 *
 * @param {object} opts
 * @param {() => number} opts.rng
 * @param {number} [opts.steps] steps per bar (16 = sixteenths in 4/4)
 * @param {number} [opts.bars]
 * @param {string} [opts.style] one of RHYTHM_STYLES
 * @param {number} [opts.density] 0..1 overall busyness
 * @param {number} [opts.variation] 0..1 how much bar 2+ drifts from bar 1
 * @param {string[]} [opts.trackIds] which kit pieces to include
 * @returns {{steps: number, bars: number, tracks: Array<{id: string, label: string, note: number, pattern: boolean[], velocities: number[]}>}}
 */
export function generateRhythm(opts) {
  const {
    rng,
    steps = 16,
    bars = 2,
    style = 'euclid',
    density = 0.5,
    variation = 0.25,
    trackIds = ['kick', 'snare', 'hat'],
  } = opts;

  const total = steps * bars;
  const tracks = TRACKS.filter((t) => trackIds.includes(t.id)).map((track) => {
    const bar = generateBar(track.id, { rng, steps, style, density });
    const pattern = [];
    for (let b = 0; b < bars; b++) {
      const source = b === 0 ? bar : mutate(bar, rng, variation);
      pattern.push(...source);
    }
    return {
      ...track,
      pattern: pattern.slice(0, total),
      velocities: pattern.slice(0, total).map((on, i) => (on ? accentFor(i, steps, rng) : 0)),
    };
  });

  return { steps, bars, tracks };
}

function generateBar(trackId, { rng, steps, style, density }) {
  const stepsPerBeat = Math.max(1, Math.round(steps / 4));

  if (style === 'backbeat') {
    const bar = new Array(steps).fill(false);
    if (trackId === 'kick') {
      bar[0] = true;
      bar[Math.floor(steps / 2)] = true;
      if (chance(rng, density)) bar[randInt(rng, 1, steps - 1)] = true;
    } else if (trackId === 'snare' || trackId === 'clap') {
      bar[stepsPerBeat] = true;
      bar[stepsPerBeat * 3] = true;
      if (chance(rng, density * 0.4)) bar[randInt(rng, 0, steps - 1)] = true;
    } else {
      const every = density > 0.66 ? 1 : density > 0.33 ? 2 : 4;
      for (let i = 0; i < steps; i += every) bar[i] = true;
    }
    return bar;
  }

  if (style === 'chance') {
    const bias = trackId === 'kick' ? 0.7 : trackId === 'hat' ? 1.2 : 0.8;
    const bar = Array.from({ length: steps }, (_, i) => {
      // Downbeats are likelier than off-steps, or it turns to soup.
      const onBeat = i % stepsPerBeat === 0 ? 1.6 : 0.6;
      return chance(rng, Math.min(0.95, density * bias * onBeat));
    });
    if (trackId === 'kick') bar[0] = true;
    return bar;
  }

  if (style === 'cutup') {
    const seed = generateBar(trackId, { rng, steps, style: 'euclid', density });
    const cut = cutUpPattern(seed, rng, stepsPerBeat);
    if (trackId === 'kick' && !cut.some(Boolean)) cut[0] = true;
    return cut;
  }

  // Euclidean, with a pulse count scaled by density and instrument role.
  const range = trackId === 'hat' || trackId === 'openhat'
    ? [Math.round(steps * 0.25), steps]
    : trackId === 'kick'
      ? [2, Math.round(steps * 0.55)]
      : [1, Math.round(steps * 0.4)];
  const pulses = Math.max(1, Math.round(range[0] + (range[1] - range[0]) * density));
  const rotation = trackId === 'snare' || trackId === 'clap' ? pick(rng, [0, Math.round(steps / 4)]) : 0;
  const bar = euclidean(steps, pulses, rotation);
  if (trackId === 'kick') bar[0] = true;
  return bar;
}

function mutate(bar, rng, amount) {
  return bar.map((on, i) => {
    if (i === 0) return on;
    return chance(rng, amount * 0.5) ? !on : on;
  });
}

function accentFor(index, steps, rng) {
  const stepsPerBeat = Math.max(1, Math.round(steps / 4));
  const local = index % steps;
  const base = local === 0 ? 118 : local % stepsPerBeat === 0 ? 100 : 78;
  return Math.max(30, Math.min(127, base + randInt(rng, -8, 8)));
}

/**
 * Converts a step index into a time offset in seconds. Swing delays every
 * other step, which is what turns a straight sixteenth grid into a shuffle.
 *
 * @param {number} step
 * @param {number} secondsPerStep
 * @param {number} [swing] 0 = straight, 1 = maximum drag (triplet feel ≈ 0.66)
 */
export function stepTime(step, secondsPerStep, swing = 0) {
  const offset = step % 2 === 1 ? secondsPerStep * swing * 0.5 : 0;
  return step * secondsPerStep + offset;
}
