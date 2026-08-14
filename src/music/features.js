// What a section looks like to a machine.
//
// A neural network cannot hear. Everything it will ever know about a piece of
// music has to arrive as a row of numbers, and *which* numbers you choose is
// the whole game — far more than the size of the net or how long you train it.
// Feed it raw MIDI and it needs a million songs to work out that a leap of a
// seventh is unusual. Feed it "the proportion of melodic intervals that are
// leaps" and it can learn something from fifty examples, because you have
// already done the listening for it.
//
// So this file is the ear. Every number in here is a thing a musician would
// actually say about a section — how fast the chords move, whether the tune
// steps or leaps, whether the snare is on the backbeat, whether the bass locks
// to the kick — measured on a scale where 0 and 1 both mean something.
//
// Two vectors come out of here:
//
//   sectionFeatures(section)   what one idea is like on its own
//   pairFeatures(a, b)         what happens *between* two of them: the key
//                              change, the register jump, the join at the seam
//
// Both are fixed-length and both are named, because a model you cannot
// interrogate is a model you cannot trust. The names are what the trainer
// prints when it tells you which of your opinions it managed to learn.
//
// One rule: this file is append-only in spirit. Adding a feature at the end is
// free; inserting one in the middle silently invalidates every model trained
// before it, which is why FEATURE_VERSION exists and why the trained model
// carries the names it was fitted against.

import { getScale, scalePitchClasses } from './theory.js';
import { meterInfo } from './meter.js';
import { SECTION_KINDS } from './sections.js';
import { RHYTHM_STYLES, trackRole } from './rhythm.js';

/**
 * Bumped whenever the meaning of an existing slot changes. A model whose
 * feature names no longer match the ones this file produces is refused rather
 * than quietly scored against the wrong columns.
 */
export const FEATURE_VERSION = 1;

// --- small helpers ----------------------------------------------------------

const clamp01 = (value) => Math.min(1, Math.max(0, value));

/** Safe ratio: an empty denominator is 0, not NaN. */
const ratio = (part, whole) => (whole > 0 ? part / whole : 0);

/** Squashes an unbounded positive quantity into 0..1. 8 bars ≈ 0.5. */
const soft = (value, half) => value / (value + half);

const mean = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

/** Population standard deviation, for "how much does this vary" features. */
function spread(list) {
  if (list.length < 2) return 0;
  const mu = mean(list);
  return Math.sqrt(mean(list.map((value) => (value - mu) ** 2)));
}

/** Interval class: how far apart two pitch classes are, 0..6, direction lost. */
function intervalClass(a, b) {
  const d = (((b - a) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
}

/**
 * Distance around the circle of fifths, 0..6. C to G is 1 and C to F# is 6 —
 * which is the distance people actually hear between two keys, unlike the
 * chromatic one that says those are 7 semitones and 6 semitones apart.
 */
function fifthsDistance(a, b) {
  const step = (((b - a) * 7) % 12 + 12) % 12; // ×7 is the inverse of ×5 mod 12
  return Math.min(step, 12 - step);
}

/**
 * Root motion, bucketed the way harmony is taught: a fourth up is not just
 * "five semitones", it is the move that every cadence in Western music is made
 * of, and it deserves its own column.
 */
const MOTION_BUCKETS = ['same', 'semitone', 'tone', 'third', 'fourth', 'tritone'];

function motionBucket(from, to) {
  return MOTION_BUCKETS[intervalClass(from, to)] || 'third';
}

// --- reading a section ------------------------------------------------------

/** Everything downstream wants the same handful of derived numbers. */
function shapeOf(section) {
  const music = section?.music || {};
  const grid = meterInfo(section?.meter || { beats: 4, unit: 4 });
  const chords = Array.isArray(music.chords) ? music.chords : [];
  const stepsPerChord = Math.max(1, Math.round(music.stepsPerChord || grid.stepsPerBar));
  const drumSteps = section?.rhythm?.pattern?.tracks?.[0]?.pattern?.length || 0;
  const melody = Array.isArray(music.melody) ? music.melody : [];
  const bass = (music.bassOn === false ? [] : music.bass) || [];
  const end = (notes) => notes.reduce((max, note) => Math.max(max, note.step + note.length), 0);
  const totalSteps = Math.max(
    chords.length * stepsPerChord, drumSteps, end(melody), end(bass), grid.stepsPerBar,
  );
  return {
    music,
    grid,
    chords,
    melody,
    bass,
    stepsPerChord,
    totalSteps,
    bars: Math.max(1, totalSteps / grid.stepsPerBar),
    pcs: new Set(scalePitchClasses(music.rootPc ?? 0, music.scaleId || 'major')),
  };
}

/** Which chord is sounding at a given step. */
function chordAt(shape, step) {
  if (!shape.chords.length) return null;
  return shape.chords[Math.floor(step / shape.stepsPerChord) % shape.chords.length];
}

/** The pitch classes a chord is made of. */
function chordPcs(chord) {
  if (!chord) return null;
  return new Set(chord.intervals.map((i) => (((chord.rootPc + i) % 12) + 12) % 12));
}

// --- the harmony ------------------------------------------------------------

function harmonyFeatures(shape, out) {
  const { chords, music } = shape;
  const scale = getScale(music.scaleId || 'major');
  const minorish = scale.steps[2] === 3;

  out('harm.present', chords.length ? 1 : 0);
  out('harm.count', soft(chords.length, 6));
  out('harm.variety', ratio(new Set(chords.map((c) => `${c.rootPc}:${c.typeId}`)).size, chords.length));
  out('harm.sevenths', ratio(chords.filter((c) => c.intervals.length >= 4).length, chords.length));
  out('harm.borrowed', ratio(chords.filter((c) => !shape.pcs.has(c.rootPc)).length, chords.length));
  out('harm.minorish', minorish ? 1 : 0);
  // How bright the mode is: lydian sits above major sits above aeolian sits
  // below phrygian. Summing the scale's steps is a crude but honest proxy.
  out('harm.brightness', clamp01((mean(scale.steps) - 4.5) / 3 + 0.5));
  // Held long or moving fast — the single thing that most changes how a
  // section feels without changing a note of it.
  out('harm.pace', clamp01(Math.log2(Math.max(0.25, music.barsPerChord || 1)) / 4 + 0.5));

  // Chord colours, as proportions.
  const kinds = { maj: 0, min: 0, odd: 0, sus: 0 };
  for (const chord of chords) {
    const id = chord.typeId || '';
    if (id.startsWith('sus')) kinds.sus += 1;
    else if (id.startsWith('min')) kinds.min += 1;
    else if (id.startsWith('maj') || id === 'dom7' || id === 'add9') kinds.maj += 1;
    else if (id === 'maj6') kinds.maj += 1;
    else kinds.odd += 1;
  }
  for (const [name, count] of Object.entries(kinds)) out(`harm.type.${name}`, ratio(count, chords.length));

  // Root motion. A progression made of fourths is a different animal from one
  // made of steps, and this is where that shows up.
  const motions = { same: 0, semitone: 0, tone: 0, third: 0, fourth: 0, tritone: 0 };
  for (let i = 1; i < chords.length; i++) motions[motionBucket(chords[i - 1].rootPc, chords[i].rootPc)] += 1;
  const moves = Math.max(0, chords.length - 1);
  for (const name of MOTION_BUCKETS) out(`harm.motion.${name}`, ratio(motions[name], moves));

  // Where it starts and where it lands — and whether the last move home is the
  // one that has been ending pieces of music for four hundred years.
  const root = ((music.rootPc ?? 0) % 12 + 12) % 12;
  out('harm.startsHome', chords.length && chords[0].rootPc === root ? 1 : 0);
  out('harm.endsHome', chords.length && chords.at(-1).rootPc === root ? 1 : 0);
  const cadence = chords.length >= 2 ? chords.at(-2).rootPc : null;
  const toHome = (from) => (from == null ? 0 : ((root - from) % 12 + 12) % 12);
  out('harm.cadence.perfect', cadence != null && toHome(cadence) === 5 && chords.at(-1).rootPc === root ? 1 : 0);
  out('harm.cadence.plagal', cadence != null && toHome(cadence) === 7 && chords.at(-1).rootPc === root ? 1 : 0);
  // A progression that ends on the dominant is a question, and questions are a
  // legitimate way to end a verse.
  out('harm.open', chords.length && ((chords.at(-1).rootPc - root + 12) % 12) === 7 ? 1 : 0);

  // Voice leading: how far the fingers move between one chord and the next.
  const voicings = Array.isArray(music.voicings) ? music.voicings : [];
  const hops = [];
  for (let i = 1; i < voicings.length; i++) {
    const a = voicings[i - 1];
    const b = voicings[i];
    if (!a?.length || !b?.length) continue;
    hops.push(mean(b.map((note) => Math.min(...a.map((other) => Math.abs(note - other))))));
  }
  out('harm.voiceLeading', clamp01(mean(hops) / 6));
  out('harm.register', clamp01(((voicings.length ? mean(voicings.map((v) => mean(v))) : 60) - 40) / 40));
}

// --- the tune ---------------------------------------------------------------

function melodyFeatures(shape, out) {
  const { melody, grid, totalSteps } = shape;
  out('mel.present', melody.length ? 1 : 0);

  const sorted = [...melody].sort((a, b) => a.step - b.step);
  const notes = sorted.length;
  const perBar = ratio(notes, shape.bars);
  out('mel.density', soft(perBar, 6));
  const sounding = sorted.reduce((total, note) => total + note.length, 0);
  out('mel.rest', clamp01(1 - ratio(sounding, totalSteps)));

  const intervals = [];
  for (let i = 1; i < notes; i++) intervals.push(sorted[i].midi - sorted[i - 1].midi);
  const sizes = intervals.map(Math.abs);
  out('mel.stepwise', ratio(sizes.filter((s) => s > 0 && s <= 2).length, intervals.length));
  out('mel.repeated', ratio(sizes.filter((s) => s === 0).length, intervals.length));
  out('mel.leaps', ratio(sizes.filter((s) => s >= 5).length, intervals.length));
  out('mel.meanInterval', clamp01(mean(sizes) / 8));
  out('mel.maxLeap', clamp01((sizes.length ? Math.max(...sizes) : 0) / 14));
  out('mel.rising', ratio(intervals.filter((i) => i > 0).length, intervals.length));

  const pitches = sorted.map((note) => note.midi);
  out('mel.range', clamp01((pitches.length ? Math.max(...pitches) - Math.min(...pitches) : 0) / 24));
  out('mel.tessitura', clamp01(((pitches.length ? mean(pitches) : 67) - 52) / 32));

  // Does it belong to the chord under it, to the key, or to neither? The third
  // case is where a tune either sounds daring or sounds wrong.
  let chordTones = 0;
  let scaleTones = 0;
  for (const note of sorted) {
    const pc = ((note.midi % 12) + 12) % 12;
    const pcsHere = chordPcs(chordAt(shape, note.step));
    if (pcsHere?.has(pc)) chordTones += 1;
    if (shape.pcs.has(pc)) scaleTones += 1;
  }
  out('mel.chordTones', ratio(chordTones, notes));
  out('mel.scaleTones', ratio(scaleTones, notes));

  // Rhythm of the tune, which is at least half of what makes it memorable.
  const onPulse = sorted.filter((note) => note.step % grid.pulse === 0).length;
  out('mel.onBeat', ratio(onPulse, notes));
  out('mel.offGrid', ratio(sorted.filter((note) => note.step % 2 === 1).length, notes));
  out('mel.downbeats', ratio(sorted.filter((note) => note.step % grid.stepsPerBar === 0).length, Math.max(1, shape.bars)));
  const lengths = sorted.map((note) => note.length);
  out('mel.durationVariety', ratio(new Set(lengths).size, notes));
  out('mel.meanDuration', clamp01(mean(lengths) / (grid.pulse * 2)));
  out('mel.longestNote', clamp01((lengths.length ? Math.max(...lengths) : 0) / (grid.stepsPerBar * 2)));

  // Self-similarity: how often the same two-note gesture comes back. A tune
  // with a motif scores high here; a random walk scores near zero. This is the
  // closest thing in the vector to "is it a tune or is it just notes".
  const bigrams = new Map();
  for (let i = 1; i < intervals.length; i++) {
    const key = `${intervals[i - 1]},${intervals[i]}`;
    bigrams.set(key, (bigrams.get(key) || 0) + 1);
  }
  const repeats = [...bigrams.values()].reduce((total, n) => total + (n > 1 ? n - 1 : 0), 0);
  out('mel.motif', ratio(repeats, Math.max(1, intervals.length - 1)));

  // How it lands. A phrase that ends on the tonic is closed; one that ends on
  // the seventh is still in the air.
  const root = ((shape.music.rootPc ?? 0) % 12 + 12) % 12;
  const last = sorted.at(-1);
  const lastPc = last ? ((last.midi % 12) + 12) % 12 : null;
  const degree = lastPc == null ? null : ((lastPc - root) % 12 + 12) % 12;
  out('mel.endsHome', degree === 0 ? 1 : 0);
  out('mel.endsStable', degree === 0 || degree === 7 || degree === 4 || degree === 3 ? 1 : 0);
  out('mel.velocitySpread', clamp01(spread(sorted.map((note) => note.velocity ?? 90)) / 24));
}

// --- the kit ----------------------------------------------------------------

function rhythmFeatures(section, shape, out) {
  const rhythm = section?.rhythm || {};
  const tracks = rhythm.pattern?.tracks || [];
  const steps = tracks[0]?.pattern?.length || 0;
  const grid = shape.grid;

  out('rhy.present', tracks.length ? 1 : 0);
  out('rhy.pieces', soft(tracks.length, 3));

  const onsetsOf = (track) => track.pattern.reduce((total, hit) => total + (hit ? 1 : 0), 0);
  const allOnsets = tracks.reduce((total, track) => total + onsetsOf(track), 0);
  out('rhy.density', clamp01(ratio(allOnsets, Math.max(1, tracks.length * steps)) * 2));

  const byRole = (roles) => tracks.filter((track) => roles.includes(trackRole(track.id)));
  const roleDensity = (roles) => {
    const list = byRole(roles);
    return clamp01(ratio(list.reduce((t, track) => t + onsetsOf(track), 0), Math.max(1, list.length * steps)) * 3);
  };
  out('rhy.low', roleDensity(['low']));
  out('rhy.backbeat', roleDensity(['backbeat']));
  out('rhy.hats', roleDensity(['hats']));
  out('rhy.perc', roleDensity(['perc', 'clave', 'offbeat', 'fill', 'accent']));

  // Is the snare where a snare goes? Everything about whether a groove reads as
  // a groove rather than as a pattern hangs off this one question.
  const backbeats = byRole(['backbeat']);
  let onBackbeat = 0;
  let backbeatHits = 0;
  for (const track of backbeats) {
    track.pattern.forEach((hit, step) => {
      if (!hit) return;
      backbeatHits += 1;
      const pulse = Math.floor((step % grid.stepsPerBar) / grid.pulse);
      if (step % grid.pulse === 0 && pulse % 2 === 1) onBackbeat += 1;
    });
  }
  out('rhy.onTheTwoAndFour', ratio(onBackbeat, backbeatHits));

  const lows = byRole(['low']);
  const downbeats = lows.reduce((total, track) => {
    let hits = 0;
    for (let step = 0; step < steps; step += grid.stepsPerBar) if (track.pattern[step]) hits += 1;
    return total + hits;
  }, 0);
  out('rhy.kickOnOne', clamp01(ratio(downbeats, Math.max(1, lows.length * Math.max(1, steps / grid.stepsPerBar)))));

  // Syncopation: everything that does not land on a felt beat.
  let off = 0;
  for (const track of tracks) {
    track.pattern.forEach((hit, step) => { if (hit && step % grid.pulse !== 0) off += 1; });
  }
  out('rhy.syncopation', ratio(off, allOnsets));

  // Does the pattern move? A two-bar loop where both bars are identical is a
  // one-bar loop wearing a hat.
  const bars = Math.max(1, Math.round(steps / grid.stepsPerBar));
  let differing = 0;
  let compared = 0;
  if (bars > 1) {
    for (const track of tracks) {
      for (let step = 0; step < grid.stepsPerBar && step + grid.stepsPerBar < steps; step++) {
        compared += 1;
        if (track.pattern[step] !== track.pattern[step + grid.stepsPerBar]) differing += 1;
      }
    }
  }
  out('rhy.barVariety', ratio(differing, compared));
  out('rhy.length', soft(bars, 2));

  const velocities = tracks.flatMap((track) => track.pattern
    .map((hit, step) => (hit ? track.velocities[step] : null)).filter((v) => v != null));
  out('rhy.accents', clamp01(spread(velocities) / 24));

  for (const style of RHYTHM_STYLES) out(`rhy.style.${style.id}`, rhythm.style === style.id ? 1 : 0);
}

// --- the bass ---------------------------------------------------------------

function bassFeatures(section, shape, out) {
  const { bass, grid } = shape;
  out('bass.present', bass.length ? 1 : 0);
  const sorted = [...bass].sort((a, b) => a.step - b.step);
  out('bass.density', soft(ratio(sorted.length, shape.bars), grid.pulses));

  const intervals = [];
  for (let i = 1; i < sorted.length; i++) intervals.push(Math.abs(sorted[i].midi - sorted[i - 1].midi));
  out('bass.motion', clamp01(mean(intervals) / 7));
  out('bass.stepwise', ratio(intervals.filter((i) => i > 0 && i <= 2).length, intervals.length));

  let onRoot = 0;
  for (const note of sorted) {
    const chord = chordAt(shape, note.step);
    if (chord && ((note.midi % 12) + 12) % 12 === (((chord.rootPc % 12) + 12) % 12)) onRoot += 1;
  }
  out('bass.roots', ratio(onRoot, sorted.length));

  // Locked to the kick or walking against it — the difference between a band
  // and four people in a room.
  const kicks = (section?.rhythm?.pattern?.tracks || []).filter((track) => trackRole(track.id) === 'low');
  const kickSteps = new Set();
  for (const track of kicks) track.pattern.forEach((hit, step) => { if (hit) kickSteps.add(step); });
  const drumSteps = kicks[0]?.pattern?.length || 0;
  const locked = drumSteps
    ? sorted.filter((note) => kickSteps.has(note.step % drumSteps)).length
    : 0;
  out('bass.locksToKick', ratio(locked, sorted.length));
  out('bass.register', clamp01(((sorted.length ? mean(sorted.map((n) => n.midi)) : 40) - 24) / 32));
}

// --- how it is played -------------------------------------------------------

function stagingFeatures(section, shape, out) {
  out('set.bars', soft(shape.bars, 8));
  out('set.dynamics', clamp01((section?.dynamics ?? 1) / 2));
  out('set.tempoScale', clamp01(((section?.tempoScale ?? 1) - 0.5) / 1.5));
  out('set.pulses', soft(shape.grid.pulses, 4));
  out('set.compound', shape.grid.compound ? 1 : 0);
  out('set.oddMeter', shape.grid.pulses % 2 === 1 && shape.grid.pulses > 1 ? 1 : 0);
  for (const kind of SECTION_KINDS) out(`set.kind.${kind.id}`, section?.kind === kind.id ? 1 : 0);
}

// --- the vector itself ------------------------------------------------------

/**
 * Everything measurable about one section, as a fixed row of named numbers.
 *
 * @param {object} section a saved section — see music/sections.js
 * @returns {{names: string[], values: number[]}}
 */
export function sectionFeatures(section) {
  const names = [];
  const values = [];
  const out = (name, value) => {
    names.push(name);
    // A NaN anywhere poisons every weight it touches, and a feature that went
    // wrong should read as "nothing here" rather than take the model with it.
    values.push(Number.isFinite(value) ? value : 0);
  };

  const shape = shapeOf(section);
  harmonyFeatures(shape, out);
  melodyFeatures(shape, out);
  rhythmFeatures(section, shape, out);
  bassFeatures(section, shape, out);
  stagingFeatures(section, shape, out);
  return { names, values };
}

/** The column names, in order — for a model to check itself against. */
export function sectionFeatureNames() {
  return sectionFeatures(null).names;
}

/**
 * What happens *between* two sections.
 *
 * A pair of sections is not the sum of two sections. Two lovely ideas in keys a
 * tritone apart, one of them twice as loud, joined by a melodic leap of a
 * ninth, is not a lovely pair — and none of that is visible in either section's
 * own vector. So the join gets measured on its own terms: how far the key
 * moves, whether the bar changes underneath, what the seam actually sounds
 * like, and how different the two are overall.
 *
 * @param {object} a the section you have just heard
 * @param {object} b the one that follows it
 * @returns {{names: string[], values: number[]}}
 */
export function pairFeatures(a, b) {
  const names = [];
  const values = [];
  const out = (name, value) => {
    names.push(name);
    values.push(Number.isFinite(value) ? value : 0);
  };

  const shapeA = shapeOf(a);
  const shapeB = shapeOf(b);
  const rootA = ((shapeA.music.rootPc ?? 0) % 12 + 12) % 12;
  const rootB = ((shapeB.music.rootPc ?? 0) % 12 + 12) % 12;

  // The key change, measured two ways, because the ear uses both.
  out('to.sameKey', rootA === rootB ? 1 : 0);
  out('to.keyDistance', intervalClass(rootA, rootB) / 6);
  out('to.fifthsDistance', fifthsDistance(rootA, rootB) / 6);
  out('to.upSemitone', ((rootB - rootA + 12) % 12) === 1 ? 1 : 0);
  out('to.relative', ((rootB - rootA + 12) % 12) === 3 || ((rootB - rootA + 12) % 12) === 9 ? 1 : 0);
  out('to.sameScale', shapeA.music.scaleId === shapeB.music.scaleId ? 1 : 0);
  const minorish = (shape) => getScale(shape.music.scaleId || 'major').steps[2] === 3;
  out('to.modeFlip', minorish(shapeA) !== minorish(shapeB) ? 1 : 0);

  // The bar, the tempo and the volume: the three things that make a listener
  // sit up, and the three easiest to overdo.
  const meterA = shapeA.grid;
  const meterB = shapeB.grid;
  out('to.sameMeter', meterA.beats === meterB.beats && meterA.unit === meterB.unit ? 1 : 0);
  out('to.tempoJump', clamp01(Math.abs((a?.tempoScale ?? 1) - (b?.tempoScale ?? 1)) * 4));
  const dynA = a?.dynamics ?? 1;
  const dynB = b?.dynamics ?? 1;
  out('to.louder', clamp01((dynB - dynA) / 1.5 + 0.5));
  out('to.dynamicJump', clamp01(Math.abs(dynB - dynA) * 2));

  // Length: a middle eight half the length of the verse is a middle eight; one
  // three times the length is a second song.
  out('to.lengthRatio', clamp01(Math.log2(shapeB.bars / Math.max(0.25, shapeA.bars)) / 4 + 0.5));

  // Colour. Changing every voice at once is a jump cut; changing none of them
  // is a section that nobody notices arriving.
  const voices = ['leadInstrument', 'harmonyInstrument', 'bassInstrument'];
  let shared = 0;
  for (const key of voices) if (shapeA.music[key] === shapeB.music[key]) shared += 1;
  out('to.sharedVoices', shared / voices.length);
  out('to.sameKit', a?.rhythm?.kit === b?.rhythm?.kit ? 1 : 0);
  const kitA = new Set(a?.rhythm?.trackIds || []);
  const kitB = new Set(b?.rhythm?.trackIds || []);
  const union = new Set([...kitA, ...kitB]);
  out('to.sharedKit', ratio([...kitA].filter((id) => kitB.has(id)).length, union.size));

  // The seam. What the last thing you heard was, and what the first thing you
  // hear next is — the one moment where a transition is actually audible.
  const lastNote = [...shapeA.melody].sort((x, y) => x.step - y.step).at(-1);
  const firstNote = [...shapeB.melody].sort((x, y) => x.step - y.step)[0];
  const jump = lastNote && firstNote ? firstNote.midi - lastNote.midi : null;
  out('to.melodyJoin', jump == null ? 0.5 : clamp01(jump / 24 + 0.5));
  out('to.melodyJoinSize', jump == null ? 0 : clamp01(Math.abs(jump) / 14));
  out('to.melodyJoinStep', jump != null && Math.abs(jump) <= 2 ? 1 : 0);

  const lastChord = shapeA.chords.at(-1);
  const firstChord = shapeB.chords[0];
  if (lastChord && firstChord) {
    for (const name of MOTION_BUCKETS) {
      out(`to.join.${name}`, motionBucket(lastChord.rootPc, firstChord.rootPc) === name ? 1 : 0);
    }
    // The seam as a cadence: does the last chord of A lead into the first of B
    // the way a dominant leads home?
    out('to.joinResolves', ((firstChord.rootPc - lastChord.rootPc + 12) % 12) === 5 ? 1 : 0);
  } else {
    for (const name of MOTION_BUCKETS) out(`to.join.${name}`, 0);
    out('to.joinResolves', 0);
  }

  // And the blunt one: how different are they, over everything measured above?
  // Contrast is the point of a second section, but there is such a thing as two
  // sections that have nothing whatever to do with each other.
  const fa = sectionFeatures(a).values;
  const fb = sectionFeatures(b).values;
  const distance = Math.sqrt(fa.reduce((total, value, i) => total + (value - fb[i]) ** 2, 0));
  out('to.distance', clamp01(distance / 6));
  const parts = { melody: 'mel.', harmony: 'harm.', rhythm: 'rhy.' };
  const allNames = sectionFeatureNames();
  for (const [label, prefix] of Object.entries(parts)) {
    let sum = 0;
    let count = 0;
    allNames.forEach((name, i) => {
      if (!name.startsWith(prefix)) return;
      sum += (fa[i] - fb[i]) ** 2;
      count += 1;
    });
    out(`to.distance.${label}`, clamp01(Math.sqrt(sum / Math.max(1, count)) * 3));
  }

  return { names, values };
}

/** The pair column names, in order. */
export function pairFeatureNames() {
  return pairFeatures(null, null).names;
}
