// Time signatures.
//
// One rule holds the whole app together: a step is always a sixteenth note.
// Everything downstream — the grid, the piano roll, the MIDI ticks — is written
// against that, so a time signature is not a new unit of time. It only says how
// many sixteenths make a bar, and where the accents fall inside it.
//
//   4/4  four quarters   → 16 steps    3/4  three quarters → 12 steps
//   6/8  six eighths     → 12 steps    7/8  seven eighths  → 14 steps
//
// Compound meters are the one place where the beat you count is not the beat
// written in the signature: 6/8 is felt in two dotted quarters, not six
// eighths, and a drummer who accents all six is playing 6/8 wrong. So there are
// two questions to ask a meter — how it is written (`unit`) and how it is
// counted (`pulseSteps`) — and the generators ask the second one.

/** Denominators worth offering. A step is a sixteenth, so 16 is the floor. */
export const METER_UNITS = [2, 4, 8, 16];

/** The ones people actually write, for the picker. */
export const METER_PRESETS = [
  { beats: 4, unit: 4 },
  { beats: 3, unit: 4 },
  { beats: 2, unit: 4 },
  { beats: 5, unit: 4 },
  { beats: 7, unit: 4 },
  { beats: 6, unit: 8 },
  { beats: 5, unit: 8 },
  { beats: 7, unit: 8 },
  { beats: 9, unit: 8 },
  { beats: 12, unit: 8 },
];

export const DEFAULT_METER = { beats: 4, unit: 4 };

/** Steps in one whole note. The app's grid is sixteenths, all the way down. */
const STEPS_PER_WHOLE = 16;

/** Clamps whatever came out of an input or old storage into a real meter. */
export function normalizeMeter(meter) {
  const beats = Math.round(Number(meter?.beats));
  const unit = Math.round(Number(meter?.unit));
  return {
    beats: Number.isFinite(beats) ? Math.min(16, Math.max(1, beats)) : DEFAULT_METER.beats,
    unit: METER_UNITS.includes(unit) ? unit : DEFAULT_METER.unit,
  };
}

/** Steps in one written beat — a quarter in 4/4, an eighth in 6/8. */
export function stepsPerBeat(meter) {
  return STEPS_PER_WHOLE / normalizeMeter(meter).unit;
}

/** Steps in one bar. */
export function stepsPerBar(meter) {
  const m = normalizeMeter(meter);
  return m.beats * stepsPerBeat(m);
}

/**
 * True for the meters counted in threes: 6/8, 9/8, 12/8 and their 16th-note
 * cousins. 3/8 is not one of them — three eighths is a bar, not two dotted
 * beats.
 */
export function isCompound(meter) {
  const m = normalizeMeter(meter);
  return m.unit >= 8 && m.beats >= 6 && m.beats % 3 === 0;
}

/**
 * Steps in one *felt* beat: the thing a foot taps and a backbeat lands on. Same
 * as the written beat except in compound time, where three of them are counted
 * as one.
 */
export function pulseSteps(meter) {
  const m = normalizeMeter(meter);
  return stepsPerBeat(m) * (isCompound(m) ? 3 : 1);
}

/** How many of those there are in a bar. */
export function pulsesPerBar(meter) {
  return Math.max(1, Math.round(stepsPerBar(meter) / pulseSteps(meter)));
}

/** "4/4", for a readout. */
export function meterLabel(meter) {
  const m = normalizeMeter(meter);
  return `${m.beats}/${m.unit}`;
}

/**
 * Everything a generator wants to know about the bar it is writing into,
 * worked out once so nothing downstream has to divide by four and hope.
 *
 * @param {{beats:number, unit:number}} meter
 * @returns {{beats:number, unit:number, stepsPerBar:number, stepsPerBeat:number,
 *   pulse:number, pulses:number, compound:boolean, label:string}}
 */
export function meterInfo(meter) {
  const m = normalizeMeter(meter);
  return {
    ...m,
    stepsPerBar: stepsPerBar(m),
    stepsPerBeat: stepsPerBeat(m),
    pulse: pulseSteps(m),
    pulses: pulsesPerBar(m),
    compound: isCompound(m),
    label: meterLabel(m),
  };
}

/**
 * The felt beats a backbeat belongs on: 2 and 4 of a four-beat bar, 2 of a
 * three-beat one. Zero-based, so [1, 3] is "two and four".
 *
 * @param {number} pulses felt beats in the bar
 * @returns {number[]}
 */
export function backbeatPulses(pulses) {
  if (pulses < 2) return [0];
  if (pulses < 4) return [1];
  const out = [];
  for (let beat = 1; beat < pulses; beat += 2) out.push(beat);
  return out;
}
