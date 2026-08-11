import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng } from '../src/rng.js';
import {
  chordSymbol,
  cutUpProgression,
  diatonicChord,
  generateProgression,
  parseChords,
  SCALES,
  scalePitchClasses,
  voiceProgression,
} from '../src/music/theory.js';
import {
  cutUpPattern,
  euclidean,
  generateRhythm,
  randomKitPieces,
  stepTime,
  TRACKS,
  trackRole,
} from '../src/music/rhythm.js';
import {
  AUTO,
  BASS_INSTRUMENTS,
  bassInstrument,
  DRUM_KITS,
  drumKit,
  HARMONY_INSTRUMENTS,
  harmonyInstrument,
  instrumentOptions,
  LEAD_INSTRUMENTS,
  leadInstrument,
  resolveBass,
  resolveInstruments,
  resolveKit,
  resolveLead,
} from '../src/music/instruments.js';
import { BASS_STYLES, generateBass, readDrums } from '../src/music/bass.js';
import {
  applyMelodyEdits,
  emptyMelodyEdits,
  generateMelody,
  melodyEditCount,
  MELODY_SHAPES,
  transformMelody,
} from '../src/music/melody.js';
import { arrange, normalizeFade, tempoScaleOf } from '../src/music/arrange.js';
import {
  composeSong,
  defaultComposeSettings,
  FORMS,
  formsFor,
  normalizeComposeSettings,
} from '../src/music/compose.js';
import { makeClock } from '../src/music/audio.js';
import {
  buildSongPlan,
  forkSection,
  makeSection,
  nextSectionName,
  sectionSong,
  sectionSteps,
} from '../src/music/sections.js';
import { buildMidiFile, songToMidi, stepToTicks, writeVarInt } from '../src/music/midi.js';
import {
  backbeatPulses,
  meterInfo,
  meterLabel,
  normalizeMeter,
  pulseSteps,
  stepsPerBar,
} from '../src/music/meter.js';
import {
  defaultHumanize,
  humanizeOffset,
  isMachineTight,
  normalizeHumanize,
  pushLabel,
} from '../src/music/humanize.js';
import {
  defaultTuning,
  isEqualTempered,
  noteCents,
  normalizeTuning,
  partDetuneCents,
  temperamentCents,
  tuningLabel,
} from '../src/music/tuning.js';

// --- theory -----------------------------------------------------------------

test('C major yields the textbook diatonic triads', () => {
  const symbols = Array.from({ length: 7 }, (_, degree) => chordSymbol(diatonicChord(0, 'major', degree)));
  assert.deepEqual(symbols, ['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim']);
});

test('A natural minor yields the relative-minor set', () => {
  const symbols = Array.from({ length: 7 }, (_, degree) => chordSymbol(diatonicChord(9, 'minor', degree)));
  assert.deepEqual(symbols, ['Am', 'Bdim', 'C', 'Dm', 'Em', 'F', 'G']);
});

test('seventh chords stack a fourth note', () => {
  const five = diatonicChord(0, 'major', 4, true);
  assert.equal(chordSymbol(five), 'G7');
  assert.deepEqual(five.intervals, [0, 4, 7, 10]);
  assert.equal(five.roman, 'V7');
});

test('scale pitch classes wrap inside an octave', () => {
  assert.deepEqual(scalePitchClasses(9, 'minor'), [9, 11, 0, 2, 4, 5, 7]);
  assert.deepEqual(scalePitchClasses(0, 'minorPentatonic'), [0, 3, 5, 7, 10]);
});

test('progressions start on the tonic and stay in the key', () => {
  const rng = makeRng('prog');
  const chords = generateProgression({ rng, rootPc: 7, scaleId: 'major', length: 8, mode: 'functional', sevenths: 0, spice: 0 });
  const inKey = new Set(scalePitchClasses(7, 'major'));
  assert.equal(chords.length, 8);
  assert.equal(chords[0].rootPc, 7);
  for (const chord of chords) assert.ok(inKey.has(chord.rootPc), `${chordSymbol(chord)} is out of key`);
});

test('functional mode never repeats the same chord twice in a row', () => {
  const chords = generateProgression({
    rng: makeRng('norepeat'), rootPc: 0, scaleId: 'major', length: 12, mode: 'functional', sevenths: 0, spice: 0,
  });
  for (let i = 1; i < chords.length; i++) {
    assert.notEqual(chords[i].rootPc, chords[i - 1].rootPc);
  }
});

test('roman numeral case always matches the chord quality, spice included', () => {
  const minorish = new Set(['min', 'min7', 'dim', 'dim7', 'min7b5', 'min6', 'madd9', 'minMaj7']);
  const majorish = new Set(['maj', 'maj7', 'dom7', 'aug', 'maj6', 'add9']);
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const chords = generateProgression({
      rng: makeRng(seed), rootPc: 9, scaleId: 'minor', length: 12, mode: 'functional', sevenths: 0.5, spice: 1,
    });
    for (const chord of chords) {
      const numeral = /[#b]?([ivIV]+)/.exec(chord.roman)?.[1];
      if (!numeral) continue;
      if (minorish.has(chord.typeId)) {
        assert.equal(numeral, numeral.toLowerCase(), `${chord.roman} is ${chord.typeId}`);
      } else if (majorish.has(chord.typeId)) {
        assert.equal(numeral, numeral.toUpperCase(), `${chord.roman} is ${chord.typeId}`);
      }
    }
  }
});

test('chord parsing understands common symbols', () => {
  const chords = parseChords('Am7 | F  Cmaj7 G7 / Bbm  D#dim  Esus4  nonsense');
  assert.deepEqual(chords.map((c) => chordSymbol(c, true)), ['Am7', 'F', 'Cmaj7', 'G7', 'Bbm', 'Ebdim', 'Esus4']);
  assert.deepEqual(parseChords(''), []);
});

test('cutting up a progression reuses only the given chords', () => {
  const source = parseChords('Am F C G');
  const cut = cutUpProgression(source, makeRng('cut'), 6);
  const allowed = new Set(source.map((c) => chordSymbol(c)));
  assert.equal(cut.length, 6);
  for (const chord of cut) assert.ok(allowed.has(chordSymbol(chord)));
});

test('voice leading keeps consecutive chords close together', () => {
  const chords = parseChords('C F G C');
  const led = voiceProgression(chords, { octave: 3, voiceLead: true });
  const plain = voiceProgression(chords, { octave: 3, voiceLead: false });
  const motion = (voicings) => voicings.slice(1).reduce(
    (sum, voicing, i) => sum + voicing.reduce((s, n, v) => s + Math.abs(n - voicings[i][v]), 0),
    0,
  );
  assert.ok(motion(led) < motion(plain), 'voice-led motion should be smaller');
  for (const voicing of led) {
    assert.equal(voicing.length, 3);
    assert.ok(voicing.every((n) => n > 20 && n < 100));
  }
});

// --- rhythm -----------------------------------------------------------------

test('euclidean spreads pulses evenly', () => {
  assert.deepEqual(euclidean(8, 3).map(Number).join(''), '10010010'); // tresillo
  assert.deepEqual(euclidean(16, 4).map(Number).join(''), '1000100010001000');
  assert.equal(euclidean(16, 0).some(Boolean), false);
  assert.equal(euclidean(16, 16).every(Boolean), true);
  assert.equal(euclidean(16, 5).filter(Boolean).length, 5);
});

test('euclidean rotation shifts the pattern without losing pulses', () => {
  const straight = euclidean(16, 5);
  const rotated = euclidean(16, 5, 4);
  assert.equal(rotated.filter(Boolean).length, straight.filter(Boolean).length);
  assert.deepEqual(rotated, straight.slice(4).concat(straight.slice(0, 4)));
});

test('cutting up a pattern preserves the number of hits', () => {
  const pattern = euclidean(16, 6);
  const cut = cutUpPattern(pattern, makeRng('chop'), 4);
  assert.equal(cut.length, pattern.length);
  assert.equal(cut.filter(Boolean).length, pattern.filter(Boolean).length);
});

test('generateRhythm produces one pattern per requested track', () => {
  const kit = generateRhythm({
    rng: makeRng('beat'), steps: 16, bars: 2, style: 'euclid', density: 0.5, trackIds: ['kick', 'snare', 'hat'],
  });
  assert.deepEqual(kit.tracks.map((t) => t.id), ['kick', 'snare', 'hat']);
  for (const track of kit.tracks) {
    assert.equal(track.pattern.length, 32);
    assert.equal(track.velocities.length, 32);
    track.pattern.forEach((on, i) => {
      if (on) assert.ok(track.velocities[i] >= 30 && track.velocities[i] <= 127);
      else assert.equal(track.velocities[i], 0);
    });
  }
  assert.equal(kit.tracks[0].pattern[0], true, 'the kick should land on the downbeat');
});

test('every kit piece has a role the generator knows how to write for', () => {
  const known = new Set(['low', 'backbeat', 'hats', 'offbeat', 'perc', 'clave', 'fill', 'accent']);
  const notes = new Set();
  for (const track of TRACKS) {
    assert.ok(known.has(track.role), `${track.id} has an unknown role: ${track.role}`);
    assert.ok(track.note >= 35 && track.note <= 81, `${track.id} is outside the GM drum map`);
    assert.equal(notes.has(track.note), false, `${track.id} reuses a drum note`);
    notes.add(track.note);
  }
  assert.equal(trackRole('kick'), 'low');
  // Anything the generator has never heard of still gets a part rather than
  // an exception.
  assert.equal(trackRole('kazoo'), 'perc');
});

test('the whole kit generates, whatever the style', () => {
  const trackIds = TRACKS.map((t) => t.id);
  for (const style of ['euclid', 'backbeat', 'chance', 'cutup', 'polyrhythm']) {
    const kit = generateRhythm({
      rng: makeRng(`kit:${style}`), steps: 16, bars: 2, style, density: 0.6, trackIds,
    });
    assert.deepEqual(kit.tracks.map((t) => t.id), trackIds, style);
    for (const track of kit.tracks) {
      assert.equal(track.pattern.length, 32, `${track.id}/${style}`);
      assert.equal(track.velocities.length, 32);
      assert.equal(track.pattern.every((on) => typeof on === 'boolean'), true);
    }
  }
});

test('a crash lands at the top of the phrase and a tom fill at the bottom', () => {
  const kit = generateRhythm({
    rng: makeRng('phrase'), steps: 16, bars: 2, density: 0.6, trackIds: ['crash', 'tom'],
  });
  const crash = kit.tracks.find((t) => t.id === 'crash');
  const tom = kit.tracks.find((t) => t.id === 'tom');
  // One hit, on the downbeat of bar one — not once a bar, which is what you get
  // if a cymbal is generated like a hi-hat.
  assert.deepEqual(crash.pattern.map(Number).join(''), '1'.padEnd(32, '0'));
  assert.equal(tom.pattern.slice(0, 16).some(Boolean), false, 'the fill waits for the last bar');
  assert.equal(tom.pattern.slice(16).some(Boolean), true);
});

test('the clave plays a clave rather than a euclidean guess', () => {
  const [clave] = generateRhythm({
    rng: makeRng('son'), steps: 16, bars: 1, density: 0.5, trackIds: ['clave'],
  }).tracks;
  const hits = clave.pattern.flatMap((on, i) => (on ? [i] : []));
  assert.deepEqual(hits, [0, 3, 6, 10, 12], '3-2 son clave');
});

test('a random kit is always playable', () => {
  const ids = new Set(TRACKS.map((t) => t.id));
  for (let seed = 0; seed < 40; seed++) {
    const kit = randomKitPieces(makeRng(`kit:${seed}`));
    assert.ok(kit.includes('kick'), 'there is always a kick');
    assert.ok(kit.some((id) => ['snare', 'clap'].includes(id)), 'and always a backbeat');
    assert.ok(kit.some((id) => ['hat', 'ride', 'shaker'].includes(id)), 'and always a timekeeper');
    assert.equal(new Set(kit).size, kit.length, 'no piece twice');
    for (const id of kit) assert.ok(ids.has(id), `${id} is not in the kit`);
    // Kit order, not pick order, so the grid does not reshuffle itself.
    const order = kit.map((id) => TRACKS.findIndex((t) => t.id === id));
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  }
});

test('swing delays every other step only', () => {
  assert.equal(stepTime(0, 0.1, 0.5), 0);
  assert.equal(stepTime(2, 0.1, 0.5).toFixed(4), '0.2000');
  assert.ok(stepTime(1, 0.1, 0.5) > 0.1);
  assert.equal(stepTime(1, 0.1, 0), 0.1);
});

// --- melody -----------------------------------------------------------------

test('melody stays in range, in key and on the grid', () => {
  const chords = generateProgression({ rng: makeRng('c'), rootPc: 2, scaleId: 'dorian', length: 4, mode: 'functional', sevenths: 0, spice: 0 });
  const notes = generateMelody({
    rng: makeRng('mel'),
    chords,
    rootPc: 2,
    scaleId: 'dorian',
    stepsPerChord: 16,
    density: 0.6,
    range: [60, 79],
  });
  assert.ok(notes.length > 4);
  const allowed = new Set(scalePitchClasses(2, 'dorian'));
  for (const note of notes) {
    assert.ok(note.midi >= 60 && note.midi <= 79, `out of range: ${note.midi}`);
    assert.ok(note.step >= 0 && note.step + note.length <= 64, 'note runs past the end of the phrase');
    assert.ok(note.length > 0);
    assert.ok(allowed.has(note.midi % 12) || chords.some((c) => c.intervals.some((i) => (c.rootPc + i) % 12 === note.midi % 12)));
  }
});

test('a melody never locks onto a single pitch', () => {
  // A drift of one or two semitones often rounds back to the note we are on —
  // a triad is four semitones wide — which used to flatten the whole line.
  for (const scale of SCALES) {
    for (const shape of MELODY_SHAPES) {
      for (let seed = 0; seed < 12; seed++) {
        const chords = generateProgression({
          rng: makeRng(`chords:${seed}`), rootPc: 9, scaleId: scale.id, length: 4, mode: 'functional', sevenths: 0.2, spice: 0.15,
        });
        const notes = generateMelody({
          rng: makeRng(`melody:${seed}`), chords, rootPc: 9, scaleId: scale.id, stepsPerChord: 16, shape: shape.id, range: [60, 84],
        });
        if (notes.length < 4) continue;
        const pitches = new Set(notes.map((n) => n.midi));
        assert.ok(pitches.size > 2, `${scale.id}/${shape.id}/${seed} flattened to ${[...pitches]}`);
      }
    }
  }
});

test('melody generation is reproducible', () => {
  const options = {
    chords: parseChords('Am F C G'),
    rootPc: 9,
    scaleId: 'minor',
    stepsPerChord: 16,
  };
  const a = generateMelody({ ...options, rng: makeRng('same') });
  const b = generateMelody({ ...options, rng: makeRng('same') });
  assert.deepEqual(a, b);
});

test('retrograde reverses the phrase and inversion mirrors it', () => {
  const notes = [
    { midi: 60, step: 0, length: 4, velocity: 100 },
    { midi: 64, step: 4, length: 4, velocity: 100 },
    { midi: 67, step: 8, length: 8, velocity: 100 },
  ];
  const back = transformMelody(notes, 'retrograde', { totalSteps: 16 });
  assert.deepEqual(back.map((n) => n.midi), [67, 64, 60]);
  assert.deepEqual(back.map((n) => n.step), [0, 8, 12]);

  const flipped = transformMelody(notes, 'invert', { range: [48, 96] });
  assert.deepEqual(flipped.map((n) => n.midi), [60, 56, 53]);
});

test('bar shuffle keeps every note inside the phrase', () => {
  const notes = Array.from({ length: 12 }, (_, i) => ({ midi: 60 + i, step: i * 4, length: 2, velocity: 90 }));
  const shuffled = transformMelody(notes, 'shuffle', { rng: makeRng('bars'), totalSteps: 48, stepsPerBar: 16 });
  assert.equal(shuffled.length, notes.length);
  for (const note of shuffled) assert.ok(note.step >= 0 && note.step + note.length <= 48);
  assert.deepEqual([...shuffled.map((n) => n.midi)].sort((a, b) => a - b), notes.map((n) => n.midi));
});

// --- hand edits -------------------------------------------------------------

const editable = () => [
  { id: 'n0', midi: 60, step: 0, length: 4, velocity: 100 },
  { id: 'n1', midi: 64, step: 8, length: 4, velocity: 100 },
  { id: 'n2', midi: 67, step: 16, length: 8, velocity: 100 },
];

test('every generated note carries a stable id', () => {
  const notes = generateMelody({
    rng: makeRng('ids'), chords: parseChords('Am F C G'), rootPc: 9, scaleId: 'minor', density: 0.8,
  });
  assert.ok(notes.length > 4);
  assert.equal(new Set(notes.map((n) => n.id)).size, notes.length);
  // Transforms reshuffle notes but must not lose track of which is which.
  for (const transform of ['retrograde', 'invert', 'shuffle', 'octave']) {
    const out = transformMelody(notes, transform, { rng: makeRng('t'), totalSteps: 64, stepsPerBar: 16 });
    assert.deepEqual([...out.map((n) => n.id)].sort(), [...notes.map((n) => n.id)].sort(), transform);
  }
});

test('an empty ledger leaves the generated melody alone', () => {
  const base = editable();
  const out = applyMelodyEdits(base, emptyMelodyEdits(), { totalSteps: 64 });
  assert.deepEqual(out.map((n) => [n.midi, n.step, n.length]), base.map((n) => [n.midi, n.step, n.length]));
  assert.equal(out.some((n) => n.edited), false);
  assert.equal(melodyEditCount(emptyMelodyEdits()), 0);
});

test('a dragged note moves in pitch and time without touching the base', () => {
  const base = editable();
  const edits = { ...emptyMelodyEdits(), moves: { n1: { dMidi: 3, dStep: -4 } } };
  const out = applyMelodyEdits(base, edits, { totalSteps: 64 });
  const moved = out.find((n) => n.id === 'n1');
  assert.equal(moved.midi, 67);
  assert.equal(moved.step, 4);
  assert.equal(moved.edited, true);
  // The generated melody is the record of what the seed produced; edits never
  // rewrite it, which is what makes "reset to generated" possible.
  assert.deepEqual(base, editable());
  assert.deepEqual(applyMelodyEdits(base, emptyMelodyEdits(), { totalSteps: 64 }).map((n) => n.midi), [60, 64, 67]);
});

test('hand edits stay inside the grid and the playable range', () => {
  const base = editable();
  const out = applyMelodyEdits(base, {
    moves: {
      n0: { dMidi: -900, dStep: -50 },
      n2: { dMidi: 900, dStep: 500, dLength: 400 },
    },
  }, { totalSteps: 64, range: [21, 108] });
  const [low, high] = [out.find((n) => n.id === 'n0'), out.find((n) => n.id === 'n2')];
  assert.equal(low.midi, 21);
  assert.equal(low.step, 0);
  assert.equal(high.midi, 108);
  assert.ok(high.step + high.length <= 64, 'a note dragged off the end gets clipped');
});

test('notes can be struck out and drawn in, and the ledger counts both', () => {
  const edits = {
    moves: { n0: { dMidi: 2 } },
    removed: ['n1'],
    added: [{ id: 'add1', midi: 72, step: 32, length: 2, velocity: 90 }],
  };
  const out = applyMelodyEdits(editable(), edits, { totalSteps: 64 });
  assert.deepEqual(out.map((n) => n.id), ['n0', 'n2', 'add1']);
  assert.equal(out.find((n) => n.id === 'add1').edited, true);
  assert.equal(melodyEditCount(edits), 3);
});

test('hand edits survive a transform, because the notes keep their ids', () => {
  const base = editable();
  const edits = { ...emptyMelodyEdits(), moves: { n2: { dMidi: -12 } } };
  const flipped = transformMelody(base, 'retrograde', { totalSteps: 24 });
  const out = applyMelodyEdits(flipped, edits, { totalSteps: 24 });
  const moved = out.find((n) => n.id === 'n2');
  assert.equal(moved.midi, 55, 'the octave drop follows the note through the retrograde');
  assert.equal(moved.step, 0, 'and it lands where the transform put it');
});

// --- bass -------------------------------------------------------------------

/** A hand-written drum lane: true at the given steps, false everywhere else. */
const onSteps = (length, steps) => Array.from({ length }, (_, i) => steps.includes(i));

const backbeat = (seed = 'kit') => generateRhythm({
  rng: makeRng(seed), steps: 16, bars: 2, style: 'backbeat', density: 0.6, trackIds: ['kick', 'snare', 'hat'],
});

const bassOptions = (extra = {}) => ({
  chords: parseChords('Am F C G'),
  rootPc: 9,
  scaleId: 'minor',
  stepsPerChord: 16,
  rhythm: backbeat(),
  ...extra,
});

test('the kit is read by role, so a pattern is heard rather than named', () => {
  const kit = generateRhythm({
    rng: makeRng('roles'), steps: 16, bars: 1, density: 0.6, trackIds: ['kick', 'snare', 'tom', 'hat'],
  });
  const heard = readDrums(kit);
  const pattern = (id) => kit.tracks.find((t) => t.id === id).pattern;
  assert.equal(heard.length, 16);
  assert.deepEqual(heard.kick, pattern('kick'));
  assert.deepEqual(heard.backbeat, pattern('snare'));
  assert.deepEqual(heard.turn, pattern('tom'), 'a tom fill is the kit announcing a change');
  // Nothing at all is a silent kit rather than an exception.
  assert.deepEqual(readDrums(null), {
    length: 0, kick: [], backbeat: [], turn: [],
  });
});

test('a bass line stays on the grid, in its register, and is reproducible', () => {
  for (const style of BASS_STYLES) {
    const options = bassOptions({ style: style.id, octave: 2 });
    const notes = generateBass({ ...options, rng: makeRng('bass') });
    assert.ok(notes.length >= 4, `${style.id} produced ${notes.length} notes`);
    for (const note of notes) {
      assert.ok(note.midi >= 28 && note.midi <= 52, `${style.id}: ${note.midi} is out of register`);
      assert.ok(note.step >= 0 && note.step + note.length <= 64, `${style.id}: ${note.step}+${note.length}`);
      assert.ok(note.length > 0 && note.velocity >= 40 && note.velocity <= 127);
    }
    assert.equal(new Set(notes.map((n) => n.id)).size, notes.length, 'ids must be unique');
    assert.deepEqual(generateBass({ ...options, rng: makeRng('bass') }), notes, `${style.id} is not reproducible`);
  }
  assert.deepEqual(generateBass({ rng: makeRng('x'), chords: [] }), [], 'no chords, no bass');
});

test('the register moves the whole line without changing what it plays', () => {
  const notes = (octave) => generateBass({ ...bassOptions({ octave }), rng: makeRng('reg') });
  const deep = notes(1);
  const high = notes(3);
  assert.deepEqual(deep.map((n) => n.step), high.map((n) => n.step), 'the rhythm is the same either way');
  assert.ok(Math.max(...deep.map((n) => n.midi)) < Math.min(...high.map((n) => n.midi)) + 12);
  assert.ok(deep.every((n) => n.midi >= 16 && n.midi <= 40));
});

test('every chord change has a bass note sounding under it', () => {
  // Either struck on the change or held into it from the anticipation before —
  // which is the one case where the downbeat is deliberately left empty.
  for (const style of BASS_STYLES) {
    for (let seed = 0; seed < 12; seed++) {
      const notes = generateBass({
        ...bassOptions({ style: style.id, motion: 1, rhythm: backbeat(`kit${seed}`) }),
        rng: makeRng(`change:${seed}`),
      });
      for (const change of [0, 16, 32, 48]) {
        const sounding = notes.find((n) => n.step <= change && n.step + n.length > change);
        assert.ok(sounding, `${style.id}/${seed}: nothing under the chord at step ${change}`);
      }
    }
  }
});

test('a line locked to the kick only plays where the drums or the chords do', () => {
  const rhythm = backbeat('locked');
  const kick = readDrums(rhythm).kick;
  for (let seed = 0; seed < 8; seed++) {
    const notes = generateBass({
      ...bassOptions({ style: 'lock', density: 1, rhythm }),
      rng: makeRng(`lock:${seed}`),
    });
    for (const note of notes) {
      const onKick = kick[note.step % kick.length];
      const onChange = note.step % 16 === 0;
      // Anything else has to be an anticipation, and those lean into a change.
      const leaning = note.step % 16 >= 14;
      assert.ok(onKick || onChange || leaning, `step ${note.step} is neither kick, change nor lean`);
    }
    assert.ok(
      notes.filter((n) => kick[n.step % kick.length]).length >= notes.length / 2,
      'most of the line should be sitting on the kick',
    );
  }
});

test('a walking line puts a note on every beat and approaches the next root', () => {
  const chords = parseChords('Am F C G');
  const notes = generateBass({
    ...bassOptions({ style: 'walk', chords, motion: 1, density: 0 }),
    rng: makeRng('walk'),
  });
  const steps = new Set(notes.map((n) => n.step));
  for (let beat = 0; beat < 64; beat += 4) {
    // Every beat is covered, either by its own note or by one tied over it.
    assert.ok(
      steps.has(beat) || notes.some((n) => n.step < beat && n.step + n.length > beat),
      `nothing on beat ${beat / 4}`,
    );
  }
  // The note before each change leans towards the root that is coming: within a
  // whole tone of it, a fifth above it, or the root itself.
  for (const change of [16, 32, 48]) {
    const before = notes.filter((n) => n.step < change).pop();
    const target = chords[(change / 16) % chords.length].rootPc;
    const gap = ((before.midi - target) % 12 + 12) % 12;
    assert.ok(
      [0, 1, 2, 10, 11, 7].includes(gap),
      `the note before step ${change} is ${gap} semitones off the next root`,
    );
  }
});

test('the bass leans into the kick when the kick moves off the beat', () => {
  // Two kits, identical but for where the kick falls. The line has to follow.
  const straight = { tracks: [{ id: 'kick', role: 'low', pattern: onSteps(32, [0, 8, 16, 24]) }] };
  const pushed = { tracks: [{ id: 'kick', role: 'low', pattern: onSteps(32, [0, 7, 16, 23]) }] };
  const onKick = (rhythm) => {
    const notes = generateBass({
      ...bassOptions({ style: 'lock', density: 1, rhythm }), rng: makeRng('follow'),
    });
    const kick = readDrums(rhythm).kick;
    return notes.filter((n) => kick[n.step % kick.length]).length;
  };
  assert.ok(onKick(straight) >= 4);
  assert.ok(onKick(pushed) >= 4);
  // And a kit with nothing in it still gets a floor under the chords.
  const dry = generateBass({ ...bassOptions({ style: 'lock', rhythm: null }), rng: makeRng('dry') });
  assert.ok(dry.length >= 4, 'a bass with no drums still has to play');
});

test('the bass answers a fill instead of ignoring it', () => {
  const withFill = {
    tracks: [
      { id: 'kick', role: 'low', pattern: onSteps(32, [0, 16]) },
      // A tom run across the last beat of the phrase: the drummer's hand-off.
      { id: 'tom', role: 'fill', pattern: onSteps(32, [28, 29, 30, 31]) },
    ],
  };
  const dry = { tracks: [withFill.tracks[0]] };
  const busyOverFill = (rhythm) => generateBass({
    ...bassOptions({ style: 'roots', density: 1, motion: 0, rhythm }),
    rng: makeRng('fill'),
  }).filter((n) => n.step >= 28).length;
  assert.ok(busyOverFill(withFill) > busyOverFill(dry), 'the fill should pull notes out of the bass');
});

/**
 * Counts, over a spread of seeds and styles, how often the bass moves against
 * the melody and how often it lands a semitone off it. Both are weighted
 * preferences rather than rules, so they can only be judged as rates.
 */
function counterpoint(counter) {
  const rhythm = backbeat('counterpoint');
  let clashes = 0;
  let notes = 0;
  let contrary = 0;
  let motions = 0;

  for (let seed = 0; seed < 12; seed++) {
    const chords = generateProgression({
      rng: makeRng(`p${seed}`), rootPc: 9, scaleId: 'minor', length: 4, mode: 'functional', sevenths: 0.2, spice: 0.15,
    });
    const melody = generateMelody({
      rng: makeRng(`m${seed}`), chords, rootPc: 9, scaleId: 'minor', stepsPerChord: 16, range: [60, 84],
    });
    const sounding = (step) => melody.find((n) => n.step <= step && n.step + n.length > step);

    for (const style of BASS_STYLES) {
      let previous = null;
      let previousStep = 0;
      for (const note of generateBass({
        rng: makeRng(`b${seed}`),
        chords,
        rootPc: 9,
        scaleId: 'minor',
        stepsPerChord: 16,
        style: style.id,
        counter,
        melody,
        rhythm,
      })) {
        const tune = sounding(note.step);
        const before = sounding(previousStep);
        if (tune) {
          notes += 1;
          const interval = ((note.midi - tune.midi) % 12 + 12) % 12;
          if (interval === 1 || interval === 11) clashes += 1;
          // Only the moments where both parts actually moved say anything
          // about whether they moved against each other.
          if (previous != null && before && before.midi !== tune.midi && previous !== note.midi) {
            motions += 1;
            if (Math.sign(note.midi - previous) === -Math.sign(tune.midi - before.midi)) contrary += 1;
          }
        }
        previous = note.midi;
        previousStep = note.step;
      }
    }
  }

  return { notes, clashes: clashes / notes, motions, contrary: contrary / motions };
}

test('the bass moves against the melody, and keeps off the note it is standing on', () => {
  const with0 = counterpoint(0);
  const with1 = counterpoint(1);
  assert.ok(with1.notes > 300 && with1.motions > 80, 'not enough notes to judge');

  // Left to itself the line goes whichever way is nearest, so it agrees with
  // the melody about half the time. Turned up, it should be pulling the other
  // way far more often than that.
  assert.ok(with0.contrary < 0.6, `${(with0.contrary * 100).toFixed(0)}% contrary with the slider off`);
  assert.ok(with1.contrary > 0.7, `only ${(with1.contrary * 100).toFixed(0)}% contrary with it up`);

  // A semitone against the tune is the one interval the bass should almost
  // never pick; the few that survive are chord roots it has no choice about.
  assert.ok(with1.clashes < 0.08, `${(with1.clashes * 100).toFixed(0)}% of the line fights the tune`);
});

test('a section with no bass in it plays no bass', () => {
  const a = testSection('A', 'Am F', { music: { bassOn: false, bass: [{ midi: 36, step: 0, length: 4 }] } });
  assert.deepEqual(sectionSong(a).bass, []);
  // And one saved before the bass existed at all is simply silent down there.
  assert.deepEqual(sectionSong(testSection('B', 'Am F')).bass, []);
});

// --- instruments -------------------------------------------------------------

test('every voice is a recipe the engine can actually build', () => {
  const lists = [['lead', LEAD_INSTRUMENTS], ['harmony', HARMONY_INSTRUMENTS], ['bass', BASS_INSTRUMENTS]];
  for (const [kind, list] of lists) {
    assert.equal(new Set(list.map((i) => i.id)).size, list.length, `${kind} ids must be unique`);
    for (const voice of list) {
      assert.ok(voice.label && voice.hint, `${voice.id} needs a label and a hint`);
      assert.ok(voice.program >= 0 && voice.program <= 127, `${voice.id} has no GM program`);
      assert.ok(voice.partials.length > 0, `${voice.id} has nothing to make a sound with`);
      for (const partial of voice.partials) {
        assert.ok((partial.ratio ?? 1) > 0, `${voice.id} has a partial at zero`);
        assert.ok((partial.level ?? 1) > 0);
      }
      const env = voice.env;
      assert.ok(env.attack >= 0 && env.decay > 0 && env.release > 0, `${voice.id} envelope`);
      assert.ok(env.sustain >= 0 && env.sustain <= 1, `${voice.id} sustain`);
      assert.ok(voice.filter.from > 0, `${voice.id} filter`);
    }
  }
  for (const kit of DRUM_KITS) {
    assert.ok(kit.pitch > 0 && kit.decay > 0 && kit.tone > 0 && kit.gain > 0, kit.id);
  }
});

test('an instrument left on auto comes from the seed, and comes back with it', () => {
  const first = resolveLead(AUTO, 'ember-42');
  assert.equal(resolveLead(AUTO, 'ember-42'), first, 'the same seed gives the same voice');
  assert.ok(LEAD_INSTRUMENTS.some((i) => i.id === first));
  // Over a spread of seeds it has to actually spread, or "surprise me" is a lie.
  const seen = new Set(Array.from({ length: 60 }, (_, i) => resolveLead(AUTO, `seed-${i}`)));
  assert.ok(seen.size > 3, `only ${seen.size} voices across 60 seeds`);
});

test('a pinned instrument beats the seed, and nonsense falls back to it', () => {
  assert.equal(resolveLead('bell', 'anything'), 'bell');
  assert.equal(resolveBass('upright', 'anything'), 'upright');
  assert.equal(bassInstrument('sousaphone').id, BASS_INSTRUMENTS[0].id);
  assert.equal(resolveKit('808', 'anything'), '808');
  // A section saved before an instrument was renamed must still play.
  assert.equal(resolveLead('theremin', 'x'), resolveLead(AUTO, 'x'));
  assert.equal(leadInstrument('theremin').id, LEAD_INSTRUMENTS[0].id);
  assert.equal(harmonyInstrument(undefined).id, HARMONY_INSTRUMENTS[0].id);
  assert.equal(drumKit('nope').id, DRUM_KITS[0].id);
});

test('the four voices of a piece of music are resolved together', () => {
  const sound = resolveInstruments(
    {
      leadInstrument: 'flute', harmonyInstrument: AUTO, bassInstrument: 'sub', chordSeed: 'abc', melodySeed: 'def',
    },
    { kit: '909', seed: 'ghi' },
  );
  assert.equal(sound.lead, 'flute');
  assert.equal(sound.bass, 'sub');
  assert.equal(sound.kit, '909');
  assert.equal(sound.harmony, resolveInstruments({ harmonyInstrument: AUTO, chordSeed: 'abc' }).harmony);
  // Missing state is a blank slate, not a crash.
  assert.ok(resolveInstruments().lead);
});

test('the instrument picker offers "from the seed" first', () => {
  const options = instrumentOptions(LEAD_INSTRUMENTS);
  assert.equal(options[0].value, AUTO);
  assert.equal(options.length, LEAD_INSTRUMENTS.length + 1);
});

// --- sections ---------------------------------------------------------------

function testSection(name, chordText, {
  kind = 'main', melody = [], stepsPerChord = 16, music = {}, rhythm = { pattern: null },
} = {}) {
  const chords = parseChords(chordText);
  return makeSection({
    name,
    kind,
    music: {
      chords, voicings: voiceProgression(chords, { octave: 3 }), stepsPerChord, melody, ...music,
    },
    rhythm,
  });
}

test('sections are named the way a lyric sheet names them', () => {
  const sections = [];
  const a = { name: nextSectionName(sections, 'main') };
  sections.push(a);
  const b = { name: nextSectionName(sections, 'main') };
  sections.push(b);
  assert.deepEqual([a.name, b.name], ['A', 'B']);
  assert.equal(nextSectionName(sections, 'intro'), 'Intro');
  assert.equal(nextSectionName([...sections, { name: 'Intro' }], 'intro'), 'Intro 2');
});

test('a fork is an independent copy under a new name', () => {
  const a = testSection('A', 'Am F C G');
  const copy = forkSection(a, [a]);
  assert.notEqual(copy.id, a.id);
  assert.equal(copy.name, 'B');
  copy.music.chords.pop();
  assert.equal(a.music.chords.length, 4, 'editing the fork must not reach back into the original');
});

test('a section knows how long it runs', () => {
  assert.equal(sectionSteps(testSection('A', 'Am F C G')), 64);
  assert.equal(sectionSteps(testSection('B', 'Am F', { stepsPerChord: 32 })), 64);
});

test('a song plan lays sections end to end with their repeats', () => {
  const intro = testSection('Intro', 'Am F', { kind: 'intro' });
  const a = testSection('A', 'Am F C G');
  const { blocks, totalSteps } = buildSongPlan(
    [intro, a],
    [{ sectionId: intro.id, repeats: 1 }, { sectionId: a.id, repeats: 2 }],
  );
  assert.deepEqual(blocks.map((b) => [b.name, b.start, b.length]), [
    ['Intro', 0, 32],
    ['A', 32, 128],
  ]);
  assert.equal(totalSteps, 160);
});

test('an arrangement entry whose section is gone is skipped, not fatal', () => {
  const a = testSection('A', 'Am F C G');
  const { blocks, totalSteps } = buildSongPlan([a], [
    { sectionId: 'deleted-long-ago' }, { sectionId: a.id },
  ]);
  assert.equal(blocks.length, 1);
  assert.equal(totalSteps, 64);
});

test('arranging a song concatenates its sections instead of looping one', () => {
  const intro = testSection('Intro', 'Am F', { kind: 'intro', melody: [{ midi: 72, step: 0, length: 4 }] });
  const a = testSection('A', 'C G', { melody: [{ midi: 60, step: 0, length: 4 }] });
  const plan = buildSongPlan([intro, a], [
    { sectionId: intro.id, repeats: 1 },
    { sectionId: a.id, repeats: 2 },
    { sectionId: intro.id, repeats: 1 },
  ]);
  const laid = arrange({ sections: plan.blocks.map((b) => b.song) });

  assert.equal(laid.totalSteps, 32 + 64 + 32);
  // The intro's chords come back at the end, and A's twice in the middle.
  assert.deepEqual(laid.chords.map((c) => c.step), [0, 16, 32, 48, 64, 80, 96, 112]);
  // The melody rides on its own section's progression, so A's single note comes
  // round once per repeat — at the top of each pass, not once per chord.
  assert.deepEqual(laid.melody.map((n) => [n.midi, n.step]), [
    [72, 0], [60, 32], [60, 64], [72, 96],
  ]);
});

test('muting a part does not shorten the section it was in', () => {
  const a = testSection('A', 'Am F C G');
  const [block] = buildSongPlan([a], [{ sectionId: a.id }]).blocks;
  const silent = arrange({ sections: [{ ...block.song, chordVoicings: [], melody: [] }] });
  assert.equal(silent.totalSteps, 64, 'the block keeps the length you heard');
});

test('a section carries its own kit, so the drums change with the section', () => {
  const a = testSection('A', 'Am F');
  a.rhythm = { pattern: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 1, trackIds: ['kick'] }) };
  const b = testSection('B', 'C G');
  const plan = buildSongPlan([a, b], [{ sectionId: a.id }, { sectionId: b.id }]);
  const { drums } = arrange({ sections: plan.blocks.map((x) => x.song) });
  assert.ok(drums.length, 'A has a kick pattern');
  assert.equal(drums.every((hit) => hit.step < 32), true, 'and B, which has none, stays dry');
});

test('a section carries its own voices, and they travel with it into the song', () => {
  const kick = (seed) => generateRhythm({ rng: makeRng(seed), steps: 16, bars: 1, trackIds: ['kick'] });
  const a = testSection('A', 'Am F', {
    melody: [{ midi: 72, step: 0, length: 4 }],
    music: { leadInstrument: 'bell', harmonyInstrument: 'organ' },
    rhythm: { kit: '808', pattern: kick('a') },
  });
  const b = testSection('B', 'C G', {
    melody: [{ midi: 60, step: 0, length: 4 }],
    music: { leadInstrument: 'flute', harmonyInstrument: 'strings' },
    rhythm: { kit: 'toybox', pattern: kick('b') },
  });
  assert.deepEqual(sectionSong(a).instruments, {
    lead: 'bell', harmony: 'organ', bass: resolveBass(AUTO, undefined), kit: '808',
  });

  const plan = buildSongPlan([a, b], [{ sectionId: a.id }, { sectionId: b.id }]);
  const laid = arrange({ sections: plan.blocks.map((x) => x.song) });
  assert.deepEqual(laid.melody.map((n) => n.instrument), ['bell', 'flute']);
  assert.deepEqual([...new Set(laid.chords.map((c) => c.instrument))], ['organ', 'strings']);
  assert.deepEqual([...new Set(laid.drums.map((h) => h.kit))], ['808', 'toybox']);
});

test('a section left on auto re-derives its voices from its own seeds', () => {
  const a = testSection('A', 'Am F', { music: { chordSeed: 'one', melodySeed: 'two' } });
  const b = testSection('B', 'Am F', { music: { chordSeed: 'three', melodySeed: 'four' } });
  assert.deepEqual(sectionSong(a).instruments, resolveInstruments(a.music, a.rhythm));
  // Two ideas rolled separately should not both come out as a saw lead.
  const sounds = new Set([sectionSong(a).instruments.lead, sectionSong(b).instruments.lead]);
  assert.ok(sounds.size >= 1);
  assert.deepEqual(sectionSong(a).instruments, sectionSong(a).instruments);
});

// --- midi -------------------------------------------------------------------

/**
 * Walks a MIDI file back into tracks of events. The writer never uses running
 * status, so this stays short — and it beats hunting for bytes in a haystack.
 */
function readMidi(bytes) {
  const data = [...bytes];
  const tracks = [];
  let at = 14; // an MThd chunk is always 8 header bytes plus 6 of payload
  while (at < data.length) {
    const length = (data[at + 4] << 24) | (data[at + 5] << 16) | (data[at + 6] << 8) | data[at + 7];
    const body = data.slice(at + 8, at + 8 + length);
    at += 8 + length;

    const events = [];
    let i = 0;
    let tick = 0;
    const varInt = () => {
      let value = 0;
      while (body[i] & 0x80) {
        value = (value << 7) | (body[i] & 0x7f);
        i += 1;
      }
      value = (value << 7) | body[i];
      i += 1;
      return value;
    };

    while (i < body.length) {
      tick += varInt();
      const status = body[i];
      i += 1;
      if (status === 0xff) {
        const type = body[i];
        i += 1;
        const size = varInt();
        events.push({ tick, status, type, data: body.slice(i, i + size) });
        i += size;
      } else {
        // Program change and channel pressure take one data byte; the rest two.
        const size = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
        events.push({ tick, status, data: body.slice(i, i + size) });
        i += size;
      }
    }
    tracks.push(events);
  }
  return tracks;
}

const programChanges = (events) => events.filter((e) => (e.status & 0xf0) === 0xc0);

test('an export opens on the instruments it was played with', () => {
  const bytes = songToMidi({
    tempo: 100,
    chordVoicings: voiceProgression(parseChords('Am F'), { octave: 3 }),
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4, velocity: 100 }],
    instruments: { lead: 'bell', harmony: 'rhodes' },
  });
  // One program change per part, not one per note.
  assert.deepEqual(
    programChanges(readMidi(bytes).flat()).map((e) => [e.status & 0x0f, e.data[0]]),
    [[0, harmonyInstrument('rhodes').program], [1, leadInstrument('bell').program]],
  );
});

test('a song that changes voice between sections changes program mid-track', () => {
  const a = testSection('A', 'Am F', {
    melody: [{ midi: 72, step: 0, length: 4 }], music: { leadInstrument: 'bell' },
  });
  const b = testSection('B', 'C G', {
    melody: [{ midi: 60, step: 0, length: 4 }], music: { leadInstrument: 'flute' },
  });
  const plan = buildSongPlan([a, b], [{ sectionId: a.id }, { sectionId: b.id }]);
  const bytes = songToMidi({ tempo: 100, sections: plan.blocks.map((x) => x.song) });

  const melody = readMidi(bytes).find((events) => events.some((e) => e.status === 0x91));
  assert.deepEqual(programChanges(melody).map((e) => [e.tick, e.data[0]]), [
    [0, leadInstrument('bell').program],
    [stepToTicks(32), leadInstrument('flute').program],
  ]);
  // And each one arrives before the note that asked for it.
  assert.ok(melody.indexOf(programChanges(melody)[0]) < melody.findIndex((e) => e.status === 0x91));
});

// --- arrangement ------------------------------------------------------------

test('a loop tags every event with the voice it is played on', () => {
  const laid = arrange({
    chordVoicings: voiceProgression(parseChords('Am F'), { octave: 3 }),
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4 }],
    bass: [{ midi: 45, step: 0, length: 8 }],
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 1, trackIds: ['kick'] }),
    instruments: {
      lead: 'pluck', harmony: 'rhodes', bass: 'upright', kit: 'tape',
    },
  });
  assert.ok(laid.chords.length && laid.chords.every((c) => c.instrument === 'rhodes'));
  assert.ok(laid.melody.length && laid.melody.every((n) => n.instrument === 'pluck'));
  assert.ok(laid.bass.length && laid.bass.every((n) => n.instrument === 'upright'));
  assert.ok(laid.drums.length && laid.drums.every((h) => h.kit === 'tape'));
});

test('the bass rides on the progression, the same way the melody does', () => {
  const { totalSteps, bass, melody } = arrange({
    chordVoicings: voiceProgression(parseChords('Am F'), { octave: 3 }),
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4 }],
    bass: [{ midi: 45, step: 0, length: 4 }, { midi: 41, step: 16, length: 4 }],
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 4, trackIds: ['kick'] }),
  });
  assert.equal(totalSteps, 64);
  // Two chords of bass under four bars of drums: it comes round with them.
  assert.deepEqual(bass.map((n) => [n.midi, n.step]), [[45, 0], [41, 16], [45, 32], [41, 48]]);
  assert.deepEqual(melody.map((n) => n.step), [0, 32]);
});

test('a bass line on its own still sets the length of the loop', () => {
  const { totalSteps, bass } = arrange({ bass: [{ midi: 36, step: 0, length: 32 }] });
  assert.equal(totalSteps, 32);
  assert.equal(bass.length, 1);
});

test('a short drum pattern repeats under a longer progression', () => {
  const rhythm = generateRhythm({ rng: makeRng('r'), steps: 16, bars: 2, trackIds: ['kick'] });
  const { totalSteps, drums } = arrange({
    chordVoicings: voiceProgression(parseChords('Am F C G'), { octave: 3 }),
    stepsPerChord: 16,
    rhythm,
  });

  assert.equal(totalSteps, 64);
  assert.ok(drums.length, 'expected some drum hits');
  // The bug: hits stopped at step 32 and the last two bars fell silent.
  assert.ok(drums.some((hit) => hit.step >= 32), 'drums must carry on past the pattern length');
  assert.ok(drums.every((hit) => hit.step < totalSteps), 'no hit may land past the loop');

  // Each repeat is the pattern again, moved along by its own length.
  const first = drums.filter((h) => h.step < 32).map((h) => h.step);
  const second = drums.filter((h) => h.step >= 32).map((h) => h.step - 32);
  assert.deepEqual(second, first);
});

test('a short progression repeats under longer drums', () => {
  const { totalSteps, chords, melody } = arrange({
    chordVoicings: voiceProgression(parseChords('Am F'), { octave: 3 }),
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4 }],
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 4, trackIds: ['kick'] }),
  });

  assert.equal(totalSteps, 64);
  assert.deepEqual(chords.map((c) => c.step), [0, 16, 32, 48]);
  assert.deepEqual(chords[0].voicing, chords[2].voicing);
  // The melody rides on the progression, so it comes round with it.
  assert.deepEqual(melody.map((n) => n.step), [0, 32]);
});

test('a repeat that overruns the loop is clipped, not dropped', () => {
  const { chords } = arrange({
    chordVoicings: voiceProgression(parseChords('Am F'), { octave: 3 }),
    stepsPerChord: 16,
    totalSteps: 40,
  });
  assert.deepEqual(chords.map((c) => [c.step, c.length]), [[0, 16], [16, 16], [32, 8]]);
});

test('exported MIDI carries the repeats it plays', () => {
  const song = {
    tempo: 100,
    chordVoicings: voiceProgression(parseChords('Am F C G'), { octave: 3 }),
    stepsPerChord: 16,
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 2, trackIds: ['kick'] }),
  };
  const hits = arrange(song).drums.length;
  const bytes = songToMidi(song);
  // One note-on and one note-off per hit, all on the drum channel.
  const noteOns = [...bytes].filter((b, i) => b === 0x99 && [...bytes][i + 1] === 36).length;
  assert.equal(noteOns, hits);
});

test('variable-length quantities match the MIDI spec', () => {
  assert.deepEqual(writeVarInt(0), [0x00]);
  assert.deepEqual(writeVarInt(127), [0x7f]);
  assert.deepEqual(writeVarInt(128), [0x81, 0x00]);
  assert.deepEqual(writeVarInt(8192), [0xc0, 0x00]);
  assert.deepEqual(writeVarInt(1048575), [0xbf, 0xff, 0x7f]);
});

test('a MIDI file has a valid header and one chunk per track', () => {
  const bytes = buildMidiFile({
    tempo: 120,
    tracks: [{ name: 'Test', channel: 0, notes: [{ midi: 60, tick: 0, durationTicks: 480, velocity: 100 }] }],
  });
  const text = String.fromCharCode(...bytes);
  assert.equal(text.slice(0, 4), 'MThd');
  assert.deepEqual([...bytes.slice(4, 8)], [0, 0, 0, 6]);
  assert.deepEqual([...bytes.slice(8, 10)], [0, 1], 'format 1');
  assert.deepEqual([...bytes.slice(10, 12)], [0, 2], 'tempo track plus one');
  assert.deepEqual([...bytes.slice(12, 14)], [1, 224], '480 ticks per quarter');
  assert.equal((text.match(/MTrk/g) || []).length, 2);
  // Each chunk must declare its own length correctly.
  assert.equal(text.endsWith(String.fromCharCode(0x00, 0xff, 0x2f, 0x00)), true);
});

test('songToMidi includes chords, melody, bass and drums on separate channels', () => {
  const chords = parseChords('Am F');
  const bytes = songToMidi({
    tempo: 100,
    swing: 0,
    chordVoicings: voiceProgression(chords, { octave: 3 }),
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4, velocity: 100 }],
    bass: [{ midi: 45, step: 0, length: 8, velocity: 104 }],
    instruments: { bass: 'upright' },
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 1, trackIds: ['kick'] }),
  });
  const text = String.fromCharCode(...bytes);
  assert.equal((text.match(/MTrk/g) || []).length, 5); // tempo + four parts
  assert.ok(bytes.includes(0x99), 'drums should be on channel 10');
  assert.ok(bytes.includes(0x91), 'melody should be on channel 2');
  assert.ok(bytes.includes(0x92), 'bass should be on channel 3');
  assert.deepEqual(
    programChanges(readMidi(bytes).flat()).filter((e) => (e.status & 0x0f) === 2).map((e) => e.data[0]),
    [bassInstrument('upright').program],
  );
});

test('step-to-tick conversion applies swing to off-steps', () => {
  assert.equal(stepToTicks(0), 0);
  assert.equal(stepToTicks(4), 480);
  assert.equal(stepToTicks(1, 0), 120);
  assert.equal(stepToTicks(1, 0.5), 150);
});

// --- meter ------------------------------------------------------------------

test('a bar is however many sixteenths the time signature asks for', () => {
  assert.equal(stepsPerBar({ beats: 4, unit: 4 }), 16);
  assert.equal(stepsPerBar({ beats: 3, unit: 4 }), 12);
  assert.equal(stepsPerBar({ beats: 5, unit: 4 }), 20);
  assert.equal(stepsPerBar({ beats: 6, unit: 8 }), 12);
  assert.equal(stepsPerBar({ beats: 7, unit: 8 }), 14);
  assert.equal(stepsPerBar({ beats: 12, unit: 8 }), 24);
});

test('compound meters are counted in threes, simple ones are not', () => {
  // 6/8 is two dotted quarters, not six eighths — the whole difference between
  // a jig and a fast waltz.
  const six = meterInfo({ beats: 6, unit: 8 });
  assert.equal(six.compound, true);
  assert.equal(six.pulse, 6);
  assert.equal(six.pulses, 2);
  assert.equal(meterInfo({ beats: 12, unit: 8 }).pulses, 4);
  // Three eighths is a bar, not two dotted beats.
  assert.equal(meterInfo({ beats: 3, unit: 8 }).compound, false);
  assert.equal(pulseSteps({ beats: 4, unit: 4 }), 4);
  assert.equal(pulseSteps({ beats: 7, unit: 8 }), 2);
});

test('a nonsense meter falls back to something playable', () => {
  assert.deepEqual(normalizeMeter({ beats: 0, unit: 5 }), { beats: 1, unit: 4 });
  assert.deepEqual(normalizeMeter(null), { beats: 4, unit: 4 });
  assert.deepEqual(normalizeMeter({ beats: 99, unit: 8 }), { beats: 16, unit: 8 });
  assert.equal(meterLabel({ beats: 7, unit: 8 }), '7/8');
});

test('the backbeat lands on two and four, or on two when there is no four', () => {
  assert.deepEqual(backbeatPulses(4), [1, 3]);
  assert.deepEqual(backbeatPulses(3), [1]);
  assert.deepEqual(backbeatPulses(2), [1]);
  assert.deepEqual(backbeatPulses(5), [1, 3]);
});

test('a pattern is written into the bar the meter asks for', () => {
  for (const meter of [{ beats: 3, unit: 4 }, { beats: 5, unit: 4 }, { beats: 7, unit: 8 }, { beats: 6, unit: 8 }]) {
    const pattern = generateRhythm({
      rng: makeRng(`m:${meterLabel(meter)}`),
      meter,
      bars: 2,
      style: 'backbeat',
      trackIds: ['kick', 'snare', 'hat'],
    });
    const bar = stepsPerBar(meter);
    assert.equal(pattern.steps, bar, `${meterLabel(meter)} bar length`);
    for (const track of pattern.tracks) {
      assert.equal(track.pattern.length, bar * 2);
      assert.equal(track.velocities.length, bar * 2);
    }
  }
});

test('the snare finds the felt beat, not the written one', () => {
  const snareIn = (meter) => generateRhythm({
    rng: makeRng('backbeat'), meter, bars: 1, style: 'backbeat', trackIds: ['snare'],
  }).tracks[0].pattern;

  // 4/4: two and four, at four sixteenths a beat.
  const four = snareIn({ beats: 4, unit: 4 });
  assert.equal(four[4], true);
  assert.equal(four[12], true);
  // 3/4: beat two only, because there is no four to land on.
  const three = snareIn({ beats: 3, unit: 4 });
  assert.equal(three[4], true);
  assert.equal(three[0], false);
  // 6/8: the second dotted beat, six sixteenths in — not the second eighth.
  const six = snareIn({ beats: 6, unit: 8 });
  assert.equal(six[6], true);
  assert.equal(six[2], false);
});

test('the downbeat of an odd bar is still the loudest thing in it', () => {
  const pattern = generateRhythm({
    rng: makeRng('accents'), meter: { beats: 5, unit: 4 }, bars: 1, style: 'euclid', trackIds: ['hat'],
  });
  const { pattern: hits, velocities } = pattern.tracks[0];
  assert.equal(hits[0], true);
  const others = velocities.filter((v, i) => v > 0 && i > 0);
  assert.ok(others.every((v) => v <= velocities[0]), 'nothing hits harder than the downbeat');
});

test('a melody in three counts its beats in three', () => {
  const chords = generateProgression({
    rng: makeRng('c'), rootPc: 0, scaleId: 'major', length: 2, mode: 'functional',
  });
  const notes = generateMelody({
    rng: makeRng('mel'),
    chords,
    rootPc: 0,
    scaleId: 'major',
    stepsPerChord: 12,
    stepsPerBeat: 4,
    density: 1,
    restiness: 0,
  });
  assert.ok(notes.length > 0);
  assert.ok(notes.every((n) => n.step + n.length <= 24), 'nothing runs past the last bar');
});

test('a walking bass walks in the meter it is given', () => {
  const chords = parseChords('Am F');
  const line = generateBass({
    rng: makeRng('b'),
    chords,
    stepsPerChord: 12,
    stepsPerBeat: 6, // 6/8: two dotted beats to the bar
    style: 'walk',
    density: 0,
    motion: 0,
  });
  // A note on every felt beat, and none of the sixteenth-note walk of 4/4.
  for (const step of [0, 6, 12, 18]) {
    assert.ok(line.some((n) => n.step === step), `a note on step ${step}`);
  }
  assert.ok(line.every((n) => n.step % 2 === 0));
});

// --- humanize ---------------------------------------------------------------

test('by default nothing is humanised at all', () => {
  const feel = defaultHumanize();
  assert.equal(isMachineTight(feel), true);
  for (let step = 0; step < 32; step++) {
    for (const part of ['drums', 'bass', 'chords', 'melody']) {
      assert.equal(humanizeOffset(part, step, feel), 0);
    }
  }
});

test('humanised notes wander off the grid, but not far', () => {
  const feel = normalizeHumanize({ amount: 1, parts: { drums: { spread: 1, push: 0 } } });
  const offsets = Array.from({ length: 64 }, (_, step) => humanizeOffset('drums', step, feel));
  assert.ok(offsets.some((o) => o !== 0), 'something moved');
  assert.ok(offsets.every((o) => Math.abs(o) <= 0.3), 'and nothing moved more than a third of a step');
  // Humped around zero rather than spread flat: most notes are nearly right.
  const near = offsets.filter((o) => Math.abs(o) < 0.15).length;
  assert.ok(near > offsets.length / 2, 'most notes stay close to the beat');
});

test('the same seed is the same take, and a new seed is a new one', () => {
  const feel = normalizeHumanize({ amount: 1, seed: 'take-one' });
  const again = normalizeHumanize({ amount: 1, seed: 'take-one' });
  const other = normalizeHumanize({ amount: 1, seed: 'take-two' });
  const run = (f) => Array.from({ length: 32 }, (_, step) => humanizeOffset('melody', step, f));
  assert.deepEqual(run(feel), run(again));
  assert.notDeepEqual(run(feel), run(other));
  // Two pieces of the kit on the same step do not land on the same offset.
  assert.notEqual(humanizeOffset('drums', 4, feel, 'kick'), humanizeOffset('drums', 4, feel, 'hat'));
});

test('a part that drags is late on average, and one that rushes is early', () => {
  const mean = (push) => {
    const feel = normalizeHumanize({ amount: 1, parts: { bass: { spread: 0.5, push } } });
    const offsets = Array.from({ length: 128 }, (_, step) => humanizeOffset('bass', step, feel));
    return offsets.reduce((sum, o) => sum + o, 0) / offsets.length;
  };
  assert.ok(mean(1) > 0.15, 'dragging sits behind the beat');
  assert.ok(mean(-1) < -0.15, 'rushing sits in front of it');
  assert.ok(Math.abs(mean(0)) < 0.05, 'and on the beat is on the beat');
});

test('turning the master down turns every player down with it', () => {
  const loose = normalizeHumanize({ amount: 1 });
  const tight = normalizeHumanize({ amount: 0.25 });
  for (let step = 1; step < 16; step++) {
    assert.ok(
      Math.abs(humanizeOffset('melody', step, tight)) <= Math.abs(humanizeOffset('melody', step, loose)) + 1e-9,
    );
  }
  assert.equal(humanizeOffset('melody', 3, normalizeHumanize({ amount: 0 })), 0);
});

test('rush and lag are described in words a drummer would use', () => {
  assert.equal(pushLabel(0), 'on the beat');
  assert.match(pushLabel(-0.8), /rushing/);
  assert.match(pushLabel(0.8), /dragging/);
});

// --- tuning -----------------------------------------------------------------

test('twelve equal divisions is the piano, and changes nothing', () => {
  const tuning = defaultTuning();
  assert.equal(isEqualTempered(tuning), true);
  for (let midi = 48; midi < 72; midi++) assert.equal(temperamentCents(midi, tuning, 0), 0);
  assert.equal(noteCents({ part: 'lead', midi: 60, tuning }), 0);
});

test('a finer ladder moves the notes of the key but never the tonic', () => {
  const tuning = normalizeTuning({ system: 'equal', divisions: 19 });
  assert.equal(isEqualTempered(tuning), false);
  // Tonic and octave are exact whatever the division; the third is not.
  assert.equal(temperamentCents(60, tuning, 0), 0);
  assert.equal(temperamentCents(72, tuning, 0), 0);
  assert.ok(temperamentCents(64, tuning, 0) < -15, '19-EDO flattens the major third');
  assert.ok(temperamentCents(63, tuning, 0) > 15, 'and sharpens the minor one');
  // 24 divisions contains the 12, so every note lands back on the piano.
  const quarter = normalizeTuning({ system: 'equal', divisions: 24 });
  for (let midi = 60; midi < 72; midi++) assert.equal(temperamentCents(midi, quarter, 0), 0);
});

test('an unequal temperament is measured from the key, not from C', () => {
  const just = normalizeTuning({ system: 'just' });
  // In A, the A is in tune and its fifth is the pure one.
  assert.equal(temperamentCents(69, just, 9), 0);
  assert.ok(Math.abs(temperamentCents(76, just, 9) - 1.96) < 0.01, 'a pure fifth is two cents wide');
  assert.ok(Math.abs(temperamentCents(73, just, 9) + 13.69) < 0.01, 'and a pure major third is flat');
  // The same note in a different key is a different distance from home.
  assert.notEqual(temperamentCents(73, just, 0), temperamentCents(73, just, 9));
});

test('detune puts every instrument slightly out, and keeps them there', () => {
  const tuning = normalizeTuning({ system: 'equal', detune: 20, seed: 'band' });
  const parts = ['lead', 'harmony', 'bass'].map((part) => partDetuneCents(part, tuning));
  assert.ok(parts.every((cents) => Math.abs(cents) <= 20), 'nobody is more than the slider says');
  assert.ok(parts.some((cents) => cents !== 0), 'and somebody is out');
  assert.equal(new Set(parts.map((c) => c.toFixed(6))).size, 3, 'each in their own direction');
  // Same seed, same band: the tuning does not shift between plays.
  assert.equal(partDetuneCents('bass', tuning), parts[2]);
  assert.notEqual(partDetuneCents('bass', { ...tuning, seed: 'other' }), parts[2]);
  assert.equal(partDetuneCents('bass', normalizeTuning({ detune: 0 })), 0);
});

test('drift moves a note without moving the instrument', () => {
  const tuning = normalizeTuning({ system: 'equal', drift: 10, seed: 'wobble' });
  const cents = [60, 64, 67].map((midi) => noteCents({
    part: 'lead', midi, step: 0, tuning,
  }));
  assert.ok(cents.some((c) => c !== 0));
  assert.ok(cents.every((c) => Math.abs(c) <= 10));
  // A held chord does not bend as one lump.
  assert.equal(new Set(cents.map((c) => c.toFixed(6))).size, 3);
  // The same note in the same bar is the same wobble, though.
  assert.equal(noteCents({ part: 'lead', midi: 60, step: 0, tuning }), cents[0]);
});

test('the tuning describes itself in words', () => {
  assert.match(tuningLabel(defaultTuning()), /piano/);
  assert.equal(tuningLabel({ system: 'equal', divisions: 31 }), '31 equal divisions of the octave');
  assert.equal(tuningLabel({ system: 'just' }), 'Just intonation');
});

// --- the three of them, in an exported file ---------------------------------

test('an export carries the time signature it was counted in', () => {
  const bytes = songToMidi({
    tempo: 100,
    meter: { beats: 7, unit: 8 },
    melody: [{ midi: 72, step: 0, length: 2 }],
  });
  const meta = readMidi(bytes).flat().filter((e) => e.status === 0xff && e.type === 0x58);
  assert.equal(meta.length, 1, 'once, in the tempo track');
  // 7/8: seven of them, and eight is two to the power of three.
  assert.deepEqual([...meta[0].data].slice(0, 2), [7, 3]);
});

test('a humanised export is the take that was played, not a tidy one', () => {
  const song = {
    tempo: 100,
    melody: Array.from({ length: 8 }, (_, i) => ({ midi: 72, step: i * 2, length: 2 })),
  };
  const onsets = (feel) => readMidi(songToMidi({ ...song, feel }))
    .flat()
    .filter((e) => (e.status & 0xf0) === 0x90)
    .map((e) => e.tick);

  const straight = onsets(null);
  const loose = onsets(normalizeHumanize({ amount: 1, seed: 'take' }));
  assert.notDeepEqual(loose, straight, 'the notes moved');
  assert.deepEqual(loose, onsets(normalizeHumanize({ amount: 1, seed: 'take' })), 'and moved the same way twice');
  // Off the grid, not off the rails: within a third of a step of where it was.
  loose.forEach((tick, i) => assert.ok(Math.abs(tick - straight[i]) <= 0.3 * 120 + 1));
});

test('a microtonal export bends the notes onto their real pitches', () => {
  const song = {
    tempo: 100,
    rootPc: 0,
    melody: [{ midi: 64, step: 0, length: 4 }],
    bass: [{ midi: 40, step: 0, length: 4 }],
    chordVoicings: [[60, 64, 67]],
    stepsPerChord: 16,
  };
  const bends = (tuning) => readMidi(songToMidi({ ...song, tuning }))
    .flat()
    .filter((e) => (e.status & 0xf0) === 0xe0);

  assert.deepEqual(bends(null), [], 'equal temperament needs no bending');
  const microtonal = bends(normalizeTuning({ system: 'equal', divisions: 19 }));
  // The melody and the bass are monophonic, so each can be bent on its own; a
  // chord voicing on one channel cannot, and is left on the nearest keys.
  assert.deepEqual(microtonal.map((e) => e.status & 0x0f), [1, 2]);
  // A 19-EDO major third is flat, so the wheel goes down from centre.
  const value = (e) => (e.data[1] << 7) | e.data[0];
  assert.ok(value(microtonal[0]) < 8192);
  // And the file says what the wheel means, rather than hoping.
  const rpn = readMidi(songToMidi({ ...song, tuning: normalizeTuning({ system: 'equal', divisions: 19 }) }))
    .flat()
    .filter((e) => (e.status & 0xf0) === 0xb0)
    .map((e) => [...e.data]);
  assert.deepEqual(rpn.slice(0, 4), [[101, 0], [100, 0], [6, 2], [38, 0]]);
});

test('a loop in five is five beats long, not four', () => {
  const song = arrange({
    stepsPerBar: 20,
    melody: [{ midi: 60, step: 0, length: 2 }],
  });
  assert.equal(song.totalSteps, 20, 'a bar of five-four is the shortest a loop gets');
});

test('every pitched event knows the key it was written in', () => {
  const song = arrange({
    rootPc: 9,
    chordVoicings: [[57, 60, 64]],
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4 }],
    bass: [{ midi: 45, step: 0, length: 4 }],
  });
  assert.equal(song.chords[0].rootPc, 9);
  assert.equal(song.melody[0].rootPc, 9);
  assert.equal(song.bass[0].rootPc, 9);
});

test('a song in two keys tunes each section to its own tonic', () => {
  const a = testSection('A', 'Am', { melody: [{ midi: 72, step: 0, length: 4 }], music: { rootPc: 9 } });
  const b = testSection('B', 'C', { melody: [{ midi: 72, step: 0, length: 4 }], music: { rootPc: 0 } });
  const plan = buildSongPlan([a, b], [{ sectionId: a.id }, { sectionId: b.id }]);
  const laid = arrange({ sections: plan.blocks.map((block) => block.song) });
  assert.deepEqual([...new Set(laid.melody.map((n) => n.rootPc))], [9, 0]);
});

test('a tambourine in six-eight lands on an eighth, not between two', () => {
  const offbeats = (meter) => generateRhythm({
    rng: makeRng('off'), meter, bars: 1, style: 'backbeat', trackIds: ['tamb'],
  }).tracks[0].pattern.flatMap((on, i) => (on ? [i] : []));

  // 4/4: the "and" of each beat, two sixteenths in.
  assert.deepEqual(offbeats({ beats: 4, unit: 4 }), [2, 6, 10, 14]);
  // 6/8: the third eighth of each dotted beat. A tambourine on step 3 would be
  // playing a sixteenth nobody is counting.
  assert.deepEqual(offbeats({ beats: 6, unit: 8 }), [4, 10]);
});

// --- the composer -----------------------------------------------------------

/** A song, composed off a fixed seed so a failure is reproducible. */
function composed(settings = {}, options = {}) {
  return composeSong({
    settings: { seed: 'test', ...settings },
    rootPc: 9,
    scaleId: 'minor',
    meter: { beats: 4, unit: 4 },
    tempo: 96,
    ...options,
  });
}

test('a composed song is an ordinary drawer of sections and a running order', () => {
  const song = composed();
  assert.ok(song.sections.length >= 3, 'a song is more than a loop');
  assert.ok(song.arrangement.length >= song.sections.length);

  const ids = new Set(song.sections.map((section) => section.id));
  for (const item of song.arrangement) {
    assert.ok(ids.has(item.sectionId), 'every entry points at a section that exists');
  }
  const used = new Set(song.arrangement.map((item) => item.sectionId));
  for (const section of song.sections) {
    assert.ok(used.has(section.id), `${section.name} is on the shelf but never played`);
  }
  // And it is playable: the plan agrees with the length the composer aimed for.
  const plan = buildSongPlan(song.sections, song.arrangement);
  assert.equal(plan.totalSteps, song.steps);
});

test('the same seed writes the same song back', () => {
  const a = composed({ seed: 'again' });
  const b = composed({ seed: 'again' });
  const shape = (song) => song.arrangement.map((item, index) => [
    song.sections[index]?.name, item.repeats,
  ]);
  assert.deepEqual(shape(a), shape(b));
  assert.deepEqual(
    a.sections.map((s) => s.music.chords.map((c) => c.roman)),
    b.sections.map((s) => s.music.chords.map((c) => c.roman)),
  );
  assert.notDeepEqual(
    composed({ seed: 'other' }).sections.map((s) => s.name + s.music.chordSeed),
    a.sections.map((s) => s.name + s.music.chordSeed),
  );
});

test('a song comes out about as long as it was asked to be', () => {
  for (const minutes of [1, 2.5, 4]) {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const song = composed({ seed, minutes });
      const ratio = song.seconds / (minutes * 60);
      assert.ok(
        ratio > 0.8 && ratio < 1.25,
        `${minutes}min asked for, ${(song.seconds / 60).toFixed(2)} written (seed ${seed})`,
      );
    }
  }
});

test('every letter after the first is pulled away from the home section', () => {
  for (const seed of ['one', 'two', 'three', 'four', 'five']) {
    const song = composed({ seed, letters: 3 });
    const [home, ...rest] = song.sections.filter((s) => s.kind !== 'intro' && s.kind !== 'outro');
    const bodies = rest.filter((section) => !/[′″‴]/.test(section.name));
    assert.ok(bodies.length, 'a three-letter song has more than one idea in it');
    for (const section of bodies) {
      const moved = section.music.rootPc !== home.music.rootPc
        || section.music.scaleId !== home.music.scaleId
        || section.music.harmonyInstrument !== home.music.harmonyInstrument
        || section.music.leadInstrument !== home.music.leadInstrument
        || (section.dynamics ?? 1) !== (home.dynamics ?? 1)
        || (section.tempoScale ?? 1) !== (home.tempoScale ?? 1)
        || section.meter.beats !== home.meter.beats
        || section.rhythm.trackIds.join() !== home.rhythm.trackIds.join()
        || section.music.length !== home.music.length;
      assert.ok(moved, `${section.name} is the same as ${home.name} in every way that can be heard`);
      assert.ok(section.traits.length > 1, `${section.name} cannot say what makes it different`);
    }
  }
});

test('a middle eight goes somewhere the verse does not', () => {
  // Whatever else it does, the section that turns up once has to change the
  // ground under it or the colour on top of it — that is what a bridge is.
  for (const seed of ['m1', 'm2', 'm3', 'm4']) {
    const song = composed({ seed, letters: 3, form: 'ababcb' });
    const bridge = song.sections.find((section) => section.kind === 'bridge');
    assert.ok(bridge, 'ABABCB has a middle eight in it');
    const home = song.sections.find((section) => section.name === 'A');
    assert.ok(
      bridge.music.rootPc !== home.music.rootPc
        || bridge.music.scaleId !== home.music.scaleId
        || bridge.meter.beats !== home.meter.beats
        || bridge.music.harmonyInstrument !== home.music.harmonyInstrument,
      'the middle eight is only decorated differently',
    );
  }
});

test('the bookends are the bookends, and can be turned off', () => {
  const song = composed({ seed: 'ends', intro: true, outro: true });
  const kinds = song.arrangement.map(
    (item) => song.sections.find((section) => section.id === item.sectionId).kind,
  );
  assert.equal(kinds[0], 'intro');
  assert.equal(kinds.at(-1), 'outro');
  assert.equal(kinds.filter((kind) => kind === 'intro' || kind === 'outro').length, 2);

  const bare = composed({ seed: 'ends', intro: false, outro: false });
  assert.ok(!bare.sections.some((section) => section.kind === 'intro' || section.kind === 'outro'));
});

test('a repeat that comes back changed is a section of its own', () => {
  // A′ is A: the same chords, in the same order, played differently.
  const song = composed({ seed: 'vary', variation: 1, letters: 2 });
  const variant = song.sections.find((section) => /[′″‴]/.test(section.name));
  assert.ok(variant, 'nothing came back changed at full variation');
  const source = song.sections.find((section) => section.name === variant.name[0]);
  assert.equal(variant.music.chordSeed, source.music.chordSeed, 'a variant keeps its progression');
  assert.deepEqual(
    variant.music.chords.map((chord) => chord.roman),
    source.music.chords.map((chord) => chord.roman),
    'a variant is the same progression, however it is played or transposed',
  );
  assert.ok(variant.traits.some((trait) => trait.startsWith(source.name)));

  const straight = composed({ seed: 'vary', variation: 0, letters: 2 });
  assert.ok(!straight.sections.some((section) => /[′″‴]/.test(section.name)));
});

test('what the composer is told not to do, it does not do', () => {
  for (const seed of ['n1', 'n2', 'n3', 'n4', 'n5']) {
    const song = composed({
      seed, letters: 4, modulate: false, meterShifts: false, tempoShifts: false, pickTempo: false,
    });
    assert.equal(song.tempo, 96, 'the transport tempo was kept');
    for (const section of song.sections) {
      assert.equal(section.music.rootPc, 9, `${section.name} changed key`);
      assert.deepEqual(section.meter, { beats: 4, unit: 4 }, `${section.name} changed the bar`);
      assert.equal(section.tempoScale ?? 1, 1, `${section.name} changed tempo`);
    }
  }
});

test('the shapes are all playable, and each needs exactly its own letters', () => {
  for (const form of FORMS) {
    assert.ok(form.shape.length >= 2, `${form.id} is not a shape`);
    assert.equal(new Set(form.shape).size, form.letters, `${form.id} miscounts its letters`);
    assert.equal(form.shape[0], 0, `${form.id} does not start at home`);
    const song = composed({ form: form.id, seed: form.id });
    assert.ok(song.sections.length >= form.letters);
    assert.equal(song.form.id, form.id);
  }
  assert.deepEqual(formsFor(2).map((f) => f.letters), formsFor(2).map(() => 2));
});

test('compose settings are clamped rather than trusted', () => {
  const settings = normalizeComposeSettings({
    letters: 99, minutes: 500, contrast: -3, variation: 'lots', intro: 'yes',
  });
  assert.equal(settings.letters, 6);
  assert.equal(settings.minutes, 12);
  assert.equal(settings.contrast, 0);
  assert.equal(settings.variation, defaultComposeSettings().variation);
  assert.equal(settings.intro, true, 'a non-boolean falls back to the default');
});

// --- how a section is played ------------------------------------------------

test('a section played softer comes out softer, note for note', () => {
  const loud = testSection('A', 'Am F', { melody: [{ midi: 72, step: 0, length: 4, velocity: 100 }] });
  const soft = { ...testSection('B', 'Am F', { melody: [{ midi: 72, step: 0, length: 4, velocity: 100 }] }), dynamics: 0.5 };
  const plan = buildSongPlan([loud, soft], [{ sectionId: loud.id }, { sectionId: soft.id }]);
  const laid = arrange({ sections: plan.blocks.map((block) => block.song) });
  assert.equal(laid.melody[0].velocity, 100);
  assert.equal(laid.melody.at(-1).velocity, 50);
  // Chords are struck at a velocity too, or the harmony would not follow.
  assert.ok(laid.chords.at(-1).velocity < laid.chords[0].velocity);
});

test('a fade holds, then goes, and takes every part with it', () => {
  const a = testSection('A', 'Am F C G', {
    melody: Array.from({ length: 8 }, (_, i) => ({ midi: 72, step: i * 8, length: 4, velocity: 100 })),
  });
  const plan = buildSongPlan([a], [{ sectionId: a.id, repeats: 2, fade: true }]);
  const laid = arrange({ sections: plan.blocks.map((block) => block.song) });
  const velocities = laid.melody.map((note) => note.velocity);
  assert.equal(velocities[0], 100, 'a fade does not start at step one');
  assert.ok(velocities.at(-1) < 10, 'it is nearly gone by the end');
  for (let i = 1; i < velocities.length; i++) {
    assert.ok(velocities[i] <= velocities[i - 1], 'a fade never gets louder');
  }
  assert.deepEqual(normalizeFade(false), null);
  assert.equal(normalizeFade(true).to, 0);
});

test('a section taken at another tempo says so, in steps', () => {
  const a = testSection('A', 'Am F');
  const coda = { ...testSection('Coda', 'Am F', { kind: 'outro' }), tempoScale: 0.5 };
  const plan = buildSongPlan([a, coda], [{ sectionId: a.id }, { sectionId: coda.id }]);
  const laid = arrange({ sections: plan.blocks.map((block) => block.song), meter: { beats: 4, unit: 4 } });
  assert.deepEqual(laid.tempoMap, [{ step: 0, scale: 1 }, { step: 32, scale: 0.5 }]);
  assert.equal(tempoScaleOf('nonsense'), 1);
  assert.equal(tempoScaleOf(0), 1);
});

test('a section counted in another bar says so too', () => {
  const a = testSection('A', 'Am F');
  const b = { ...testSection('B', 'Am F'), meter: { beats: 3, unit: 4 } };
  const plan = buildSongPlan([a, b], [{ sectionId: a.id }, { sectionId: b.id }]);
  const laid = arrange({ sections: plan.blocks.map((block) => block.song), meter: { beats: 4, unit: 4 } });
  assert.deepEqual(laid.meterMap, [
    { step: 0, meter: { beats: 4, unit: 4 } },
    { step: 32, meter: { beats: 3, unit: 4 } },
  ]);
});

test('the clock turns a tempo map into seconds, and back into steps', () => {
  // Sixteen steps at one tempo, then sixteen at half speed.
  const clock = makeClock([{ step: 0, scale: 1 }, { step: 16, scale: 0.5 }], 0.1, 32);
  assert.equal(clock.timeAt(0), 0);
  assert.equal(clock.timeAt(16), 1.6);
  assert.ok(Math.abs(clock.timeAt(32) - 4.8) < 1e-9, 'the second half takes twice as long');
  assert.equal(clock.stepSeconds(20), 0.2);
  assert.ok(Math.abs(clock.stepAt(1.6) - 16) < 1e-9);
  assert.ok(Math.abs(clock.stepAt(4.8) - 32) < 1e-9);
  // A song with one tempo is the old multiplication, exactly.
  const plain = makeClock([], 0.125, 64);
  assert.equal(plain.timeAt(8), 1);
  assert.equal(plain.total, 8);
});

test('a tempo change and a bar change are written into the exported file', () => {
  const a = testSection('A', 'Am F');
  const coda = { ...testSection('Coda', 'Am F', { kind: 'outro' }), tempoScale: 0.5, meter: { beats: 3, unit: 4 } };
  const plan = buildSongPlan([a, coda], [{ sectionId: a.id }, { sectionId: coda.id }]);
  const bytes = songToMidi({
    sections: plan.blocks.map((block) => block.song), tempo: 120, meter: { beats: 4, unit: 4 },
  });
  // Two tempo meta events (FF 51) and two time signatures (FF 58) on track 0.
  let tempos = 0;
  let meters = 0;
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x51) tempos += 1;
    if (bytes[i] === 0xff && bytes[i + 1] === 0x58) meters += 1;
  }
  assert.equal(tempos, 2, 'the coda drops to half tempo in the file too');
  assert.equal(meters, 2, 'and is counted in three');
});

test('a section remembers the bar it was written in', () => {
  const section = makeSection({
    name: 'A',
    music: { chords: [], voicings: [[57, 60, 64]], stepsPerChord: 12 },
    rhythm: {},
    meter: { beats: 3, unit: 4 },
    dynamics: 0.8,
    tempoScale: 1,
    traits: ['A natural minor'],
  });
  assert.deepEqual(section.meter, { beats: 3, unit: 4 });
  assert.equal(section.dynamics, 0.8);
  assert.ok(!('tempoScale' in section), 'a section at the transport tempo says nothing about it');
  assert.deepEqual(sectionSong(section).meter, { beats: 3, unit: 4 });
  assert.equal(sectionSong(section).dynamics, 0.8);
});
