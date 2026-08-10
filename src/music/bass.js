// Bass generation: the part that has to face two ways at once.
//
// Downwards, at the kit. A bass line written without looking at the drums
// fights them, so the onsets are read straight off the drum pattern: wherever
// the kick moves the bass moves with it, a tom fill or a crash gets answered,
// and because the pattern is read step by step rather than bar by bar, a kit
// that changes in bar two takes the bass with it.
//
// Upwards, at the melody. A bass line that shadows the tune is only a thicker
// tune, so every pitch is scored against what the melody is doing at that
// moment: go the other way when the tune moves, and stay off the note it is
// already sitting on.
//
// And sideways, at the chords, because it is still the part that says where the
// harmony is. Every chord change gets a note under it, the note before a change
// is usually an approach into the root of the next one, and the lean into a
// change — hitting the new root early and holding it over the bar line — is
// written in as its own kind of onset. That is the whole walking-bass trick,
// and most of what makes a line sound played rather than derived.

import { chance, pickWeighted, randInt } from '../rng.js';
import { trackRole } from './rhythm.js';
import { scalePitchClasses } from './theory.js';

/**
 * The app's grid is sixteenths all the way through, so a beat is four steps in
 * four-four. Anything else says so — see meter.js — and the walk, the pump and
 * the accents all move with it.
 */
const DEFAULT_STEPS_PER_BEAT = 4;

export const BASS_STYLES = [
  { id: 'roots', label: 'Root notes', hint: 'The root of each chord and little else. Pure foundation.' },
  { id: 'lock', label: 'Locked to the kick', hint: 'Plays where the kick plays, so the two move as one instrument.' },
  { id: 'walk', label: 'Walking', hint: 'A note on every beat, walking into the root of the next chord.' },
  { id: 'pump', label: 'Driving eighths', hint: 'Straight eighths underneath everything — root, fifth, octave.' },
  { id: 'counter', label: 'Counterpoint', hint: 'Answers the melody: plays in its gaps and moves the opposite way.' },
];

/** Where the line sits. The number is the octave, the way the chords use it. */
export const BASS_REGISTERS = [
  { value: 1, label: 'Deep — around C1' },
  { value: 2, label: 'Standard — around C2' },
  { value: 3, label: 'High — around C3' },
];

/** How long a note is allowed to ring, per style, before it lets go. */
function holdFor(style, beat) {
  return {
    roots: beat * 8, lock: beat, walk: beat, pump: 2, counter: 8,
  }[style] ?? beat;
}

/**
 * How much of the kick pattern each style takes on board. "Locked" takes nearly
 * all of it; a walking line only borrows the odd syncopation.
 */
const KICK_APPETITE = {
  roots: [0.1, 0.3],
  lock: [0.55, 0.5],
  walk: [0.2, 0.35],
  pump: [0.15, 0.3],
  counter: [0.2, 0.4],
};

/**
 * @typedef {object} BassNote
 * @property {number} midi
 * @property {number} step
 * @property {number} length
 * @property {number} velocity
 * @property {string} id
 */

/**
 * @param {object} opts
 * @param {() => number} opts.rng
 * @param {import('./theory.js').Chord[]} opts.chords
 * @param {number} [opts.rootPc] key root, for the passing notes
 * @param {string} [opts.scaleId]
 * @param {number} [opts.stepsPerChord]
 * @param {number} [opts.stepsPerBeat] steps in one felt beat, from the meter
 * @param {string} [opts.style] one of BASS_STYLES
 * @param {number} [opts.density] 0..1 how many notes
 * @param {number} [opts.motion] 0..1 root-bound ↔ walking, and how hard it leans
 * @param {number} [opts.counter] 0..1 how strongly it works against the melody
 * @param {number} [opts.octave] register, as in BASS_REGISTERS
 * @param {{tracks: Array<{id:string, role?:string, pattern:boolean[]}>}} [opts.rhythm]
 *   the drum pattern this line has to live with
 * @param {Array<{midi:number, step:number, length:number}>} [opts.melody]
 *   the tune it has to stay out of the way of
 * @returns {BassNote[]}
 */
export function generateBass(opts) {
  const {
    rng,
    chords = [],
    rootPc = 0,
    scaleId = 'major',
    stepsPerChord = 16,
    stepsPerBeat = DEFAULT_STEPS_PER_BEAT,
    style = 'walk',
    density = 0.5,
    motion = 0.5,
    counter = 0.5,
    octave = 2,
    rhythm = null,
    melody = [],
  } = opts;

  if (!chords.length) return [];

  const totalSteps = chords.length * stepsPerChord;
  const beat = Math.max(1, Math.round(stepsPerBeat));
  const drums = readDrums(rhythm);
  const tune = readMelody(melody, totalSteps);
  const scalePcs = scalePitchClasses(rootPc, scaleId);
  const base = 12 * (octave + 1); // MIDI octave numbering: C4 = 60
  const range = [base - 8, base + 16];
  const home = base + (((rootPc % 12) + 12) % 12);

  const marks = placeOnsets({
    rng, style, density, motion, totalSteps, stepsPerChord, beat, drums, tune,
  });

  return voiceLine({
    rng, marks, chords, stepsPerChord, totalSteps, beat, scalePcs, range, home, style, motion, counter, drums, tune,
  });
}

// --- listening --------------------------------------------------------------

/**
 * Reads a drum pattern as the handful of layers a bass player actually listens
 * for. By role rather than by name, so a kit built out of a shaker and a conga
 * still tells the bass where the beat is.
 *
 * @param {{tracks?: Array<{id:string, role?:string, pattern:boolean[]}>}} rhythm
 * @returns {{length:number, kick:boolean[], backbeat:boolean[], turn:boolean[]}}
 */
export function readDrums(rhythm) {
  const tracks = (rhythm?.tracks || []).filter((track) => Array.isArray(track?.pattern));
  const length = tracks.reduce((max, track) => Math.max(max, track.pattern.length), 0);
  const layer = (roles) => {
    const out = new Array(length).fill(false);
    for (const track of tracks) {
      if (!roles.includes(track.role || trackRole(track.id))) continue;
      track.pattern.forEach((on, i) => { if (on) out[i] = true; });
    }
    return out;
  };
  return {
    length,
    kick: layer(['low']),
    backbeat: layer(['backbeat']),
    // A tom fill or a crash is the kit saying something is about to change.
    turn: layer(['fill', 'accent']),
  };
}

/** Reads a step out of a looping layer, so a two-bar kit covers four of chords. */
function at(layer, step) {
  return layer.length > 0 && Boolean(layer[step % layer.length]);
}

/**
 * Flattens the melody onto the grid: what is sounding at each step, and where a
 * new note is struck. Both questions get asked once per bass note, so it is
 * cheaper to answer them all up front.
 */
function readMelody(melody, totalSteps) {
  const sounding = new Array(totalSteps).fill(null);
  const attack = new Array(totalSteps).fill(false);
  for (const note of melody || []) {
    if (!Number.isFinite(note?.midi) || !(note.length > 0)) continue;
    const from = ((Math.round(note.step) % totalSteps) + totalSteps) % totalSteps;
    attack[from] = true;
    for (let i = 0; i < note.length && from + i < totalSteps; i++) {
      // Where two notes overlap the top one wins: that is the one you hear as
      // the tune, and therefore the one the bass has to answer.
      if (sounding[from + i] == null || note.midi > sounding[from + i]) {
        sounding[from + i] = note.midi;
      }
    }
  }
  return { sounding, attack };
}

// --- rhythm -----------------------------------------------------------------

/**
 * Decides where the notes go, before deciding what they are. Returns a map of
 * step → why the note is there, which is what the pitch pass needs to know:
 *
 *   change  a chord starts here
 *   push    a lean into the chord that is about to start
 *   beat    the style's own pulse
 *   run     a passing note between two of those
 *   kick    the drummer put something here
 *   answer  a reply to a fill, or to a gap in the melody
 */
function placeOnsets({
  rng, style, density, motion, totalSteps, stepsPerChord, beat, drums, tune,
}) {
  const marks = new Map();
  const add = (step, kind) => {
    if (step < 0 || step >= totalSteps || marks.has(step)) return;
    marks.set(step, kind);
  };

  // The harmony first: a chord that arrives with nothing under it has not
  // really arrived.
  for (let step = 0; step < totalSteps; step += stepsPerChord) add(step, 'change');

  if (style === 'roots' && stepsPerChord >= 16) {
    // Long chords sag in the middle, so put a second root in there sometimes.
    for (let step = 0; step < totalSteps; step += stepsPerChord) {
      if (chance(rng, 0.2 + density * 0.6)) add(step + Math.round(stepsPerChord / 2), 'beat');
    }
  }

  if (style === 'walk') {
    // The quarter-note walk. This one is not up for negotiation — it is the
    // style. Density buys the doubled-up eighths a player throws in on the way.
    for (let step = 0; step < totalSteps; step += beat) add(step, 'beat');
    for (let step = Math.round(beat / 2); step < totalSteps; step += beat) {
      if (chance(rng, density * 0.4)) add(step, 'run');
    }
  }

  if (style === 'pump') {
    const every = density > 0.45 ? Math.max(1, Math.round(beat / 2)) : beat;
    for (let step = 0; step < totalSteps; step += every) add(step, 'beat');
    for (let step = 1; every === 2 && step < totalSteps; step += 2) {
      if (chance(rng, (density - 0.45) * 0.6)) add(step, 'run');
    }
  }

  if (style === 'counter') {
    // Call and response: the bass talks where the tune is not talking, and
    // keeps off the step where a melody note is being struck.
    for (let step = 0; step < totalSteps; step += 2) {
      if (tune.attack[step]) continue;
      const gap = tune.sounding[step] == null;
      const onBeat = step % beat === 0;
      if (chance(rng, (gap ? 0.55 : 0.14) * (onBeat ? 1.5 : 0.7) * (0.35 + density))) {
        add(step, gap ? 'answer' : 'beat');
      }
    }
  }

  // Now the kit. Every style takes some of the kick's syncopation on board —
  // that is the thing that makes two parts sound like one instrument — and
  // "locked to the kick" takes very nearly all of it.
  const [floor, span] = KICK_APPETITE[style] || KICK_APPETITE.lock;
  const appetite = floor + density * span;
  for (let step = 0; step < totalSteps; step++) {
    if (!at(drums.kick, step)) continue;
    // The off-beat kicks are the interesting ones; that is where the groove is.
    if (chance(rng, appetite * (step % beat === 0 ? 0.75 : 1))) add(step, 'kick');
  }

  // A kit with no kick in it — or no kit at all — still needs a floor under it.
  if (style === 'lock' && !drums.kick.some(Boolean)) {
    for (let step = 0; step < totalSteps; step += beat) add(step, 'beat');
  }

  // Answering the kit: a tom fill or a crash is the drummer announcing that
  // something is about to change, and the bass is the first to agree.
  for (let step = 0; step < totalSteps; step++) {
    if (at(drums.turn, step) && chance(rng, 0.35 + density * 0.45)) add(step, 'answer');
  }

  // Anticipation goes last, because it outranks whatever was already there. A
  // player leans into a change, hitting the new root an eighth or a sixteenth
  // early and holding it over the bar line; it is the most recognisable thing
  // a bass does that a chord chart does not say.
  const lean = style === 'roots' ? motion * 0.4 : 0.12 + motion * 0.55;
  for (let change = stepsPerChord; change <= totalSteps; change += stepsPerChord) {
    if (!chance(rng, lean)) continue;
    const push = change - (chance(rng, 0.6) ? 2 : 1);
    if (push <= 0) continue;
    marks.set(push, 'push');
    // Half the time it ties over the change rather than being struck again on
    // it, which is what makes the bar line disappear.
    if (chance(rng, 0.5)) marks.delete(change);
  }

  return marks;
}

// --- pitch ------------------------------------------------------------------

function voiceLine({
  rng, marks, chords, stepsPerChord, totalSteps, beat, scalePcs, range, home, style, motion, counter, drums, tune,
}) {
  const steps = [...marks.keys()].sort((a, b) => a - b);
  const hold = holdFor(style, beat);
  const notes = [];
  let previous = null;
  let previousStep = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const kind = marks.get(step);
    const until = steps[i + 1] ?? totalSteps;

    // A lean belongs to the chord it is leaning into, not the one it is still
    // standing in.
    const index = Math.floor(step / stepsPerChord) + (kind === 'push' ? 1 : 0);
    const chord = chords[index % chords.length];
    const nextChord = chords[(index + 1) % chords.length];
    const changeAt = (Math.floor(step / stepsPerChord) + 1) * stepsPerChord;

    const allowed = pitchesFor({
      rng,
      kind,
      chord,
      nextChord,
      scalePcs,
      motion,
      previousPc: previous == null ? null : ((previous % 12) + 12) % 12,
      // The last note of a chord gets to be an approach into the next root, so
      // long as it is close enough to the change to sound like one.
      approaching: kind !== 'push' && until >= changeAt && changeAt - step <= beat,
    });

    const midi = choosePitch({
      rng,
      allowed,
      previous,
      range,
      home,
      counter,
      melody: tune.sounding[step],
      // Contrary motion: where the tune went up, the bass would rather go down.
      want: contraryTo(tune, previousStep, step),
    });

    notes.push({
      id: `b${notes.length}`,
      midi,
      step,
      // An anticipation is held across the change it anticipates; everything
      // else runs to the next note, up to as long as the style likes to ring.
      length: Math.max(1, kind === 'push' ? until - step : Math.min(until - step, hold)),
      velocity: velocityFor({
        rng, kind, step, beat, stepsPerChord, drums,
      }),
    });

    previous = midi;
    previousStep = step;
  }

  return notes;
}

/** The direction the bass would rather move, given what the tune just did. */
function contraryTo(tune, fromStep, toStep) {
  const from = tune.sounding[fromStep];
  const to = tune.sounding[toStep];
  if (from == null || to == null || from === to) return 0;
  return to > from ? -1 : 1;
}

/** The pitch classes this note is allowed to be, in rough order of pull. */
function pitchesFor({
  rng, kind, chord, nextChord, scalePcs, motion, approaching, previousPc,
}) {
  const tones = chordTones(chord);

  // On a change — and on a lean into one — it is the root, full stop. This is
  // the moment the harmony has to be legible, and an inversion here costs more
  // than it buys.
  if (kind === 'change' || kind === 'push') return [tones.root];

  if (approaching) return approachTo(nextChord.rootPc, scalePcs, motion, rng);

  // Whatever was just played is a poor candidate for being played again: it is
  // what turns a line into a pedal note.
  const fresh = (pc, weight) => (pc === previousPc ? weight * 0.25 : weight);
  const choice = pickWeighted(rng, [
    { value: tones.root, weight: fresh(tones.root, 3.2 - motion * 1.8) },
    { value: tones.fifth, weight: fresh(tones.fifth, 1.7) },
    { value: tones.third, weight: fresh(tones.third, 0.9 + motion * 0.6) },
    { value: tones.seventh ?? tones.fifth, weight: tones.seventh == null ? 0 : fresh(tones.seventh, 0.7) },
    // Anything in the key: the passing notes that turn a bass part into a line.
    { value: 'scale', weight: motion * 2 },
  ]);
  return choice === 'scale' ? scalePcs : [choice];
}

function chordTones(chord) {
  const pcs = chord.intervals.map((i) => ((chord.rootPc + i) % 12 + 12) % 12);
  return {
    root: pcs[0], third: pcs[1] ?? pcs[0], fifth: pcs[2] ?? pcs[0], seventh: pcs[3],
  };
}

/**
 * Ways into a root. Two candidates come back where there are two sides to
 * approach from — the scoring picks whichever the line is already nearer, which
 * is what a player does without thinking about it.
 */
function approachTo(targetPc, scalePcs, motion, rng) {
  const move = pickWeighted(rng, [
    // The semitone is the strongest of the three, and the one that makes a line
    // sound walked rather than spelled out.
    { value: 'chromatic', weight: 0.4 + motion * 1.6 },
    { value: 'scale', weight: 1.2 },
    // The fifth above falling onto the root: the oldest move there is.
    { value: 'dominant', weight: 0.9 },
  ]);
  if (move === 'chromatic') return [(targetPc + 11) % 12, (targetPc + 1) % 12];
  if (move === 'dominant') return [(targetPc + 7) % 12];
  return scaleNeighbours(targetPc, scalePcs);
}

/** The scale notes either side of a pitch class. */
function scaleNeighbours(pc, scalePcs) {
  const wrap = (x) => ((x % 12) + 12) % 12;
  const out = [];
  for (const direction of [-1, 1]) {
    for (let d = 1; d <= 3; d++) {
      if (scalePcs.includes(wrap(pc + direction * d))) {
        out.push(wrap(pc + direction * d));
        break;
      }
    }
  }
  return out.length ? out : [wrap(pc)];
}

/**
 * Picks the actual note. Everything the line is trying to do at once is a
 * penalty here, and the cheapest pitch wins:
 *
 *   stay near the previous note      bass lines move by step
 *   stay near the middle of the range and do not crawl off the bottom
 *   move against the melody           counterpoint, weighted by the slider
 *   keep off a semitone clash         a fight the bass always loses
 */
function choosePitch({ rng, allowed, previous, range, home, counter, melody, want }) {
  const [low, high] = range;
  const centre = (low + high) / 2;
  let best = null;
  let bestScore = Infinity;

  for (let midi = low; midi <= high; midi++) {
    if (!allowed.includes(((midi % 12) + 12) % 12)) continue;
    let score = Math.abs(midi - centre) * 0.35 + rng() * 1.5;

    if (previous != null) {
      const move = midi - previous;
      const distance = Math.abs(move);
      score += distance * 0.5 + Math.max(0, distance - 7) * 1.6;
      if (distance === 12) score -= 2.5; // an octave jump is idiomatic, not a leap
      if (distance === 0) score += 1.2 * counter; // and repeating a note says little
      if (want) score += (Math.sign(move) === want ? -3 : 2.5) * counter;
    }

    if (melody != null) {
      const against = (((midi - melody) % 12) + 12) % 12;
      // A semitone or a major seventh against the tune is a fight, and one the
      // bass loses however low the counterpoint is turned; landing on the same
      // note as the tune merely thickens it.
      if (against === 1 || against === 11) score += 2 + 5 * counter;
      else if (against === 0) score += 1.5 * counter;
    }

    if (score < bestScore) {
      bestScore = score;
      best = midi;
    }
  }

  return best ?? clamp(Math.round(home), low, high);
}

function velocityFor({
  rng, kind, step, beat, stepsPerChord, drums,
}) {
  // Hardest at the top of a chord, hard on the beat, softer in between.
  let level = step % Math.max(1, stepsPerChord) === 0 ? 110 : step % beat === 0 ? 100 : 88;
  if (at(drums.kick, step)) level += 9; // landing with the kick, and hard
  if (at(drums.backbeat, step)) level += 3;
  if (kind === 'push') level += 5; // a lean nobody hears is not a lean
  if (kind === 'run') level -= 8; // passing notes stay out of the way
  return clamp(level + randInt(rng, -5, 5), 40, 127);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
