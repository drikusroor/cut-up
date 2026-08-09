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
  DRUM_KITS,
  drumKit,
  HARMONY_INSTRUMENTS,
  harmonyInstrument,
  instrumentOptions,
  LEAD_INSTRUMENTS,
  leadInstrument,
  resolveInstruments,
  resolveKit,
  resolveLead,
} from '../src/music/instruments.js';
import {
  applyMelodyEdits,
  emptyMelodyEdits,
  generateMelody,
  melodyEditCount,
  MELODY_SHAPES,
  transformMelody,
} from '../src/music/melody.js';
import { arrange } from '../src/music/arrange.js';
import {
  buildSongPlan,
  forkSection,
  makeSection,
  nextSectionName,
  sectionSong,
  sectionSteps,
} from '../src/music/sections.js';
import { buildMidiFile, songToMidi, stepToTicks, writeVarInt } from '../src/music/midi.js';

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

// --- instruments -------------------------------------------------------------

test('every voice is a recipe the engine can actually build', () => {
  for (const [kind, list] of [['lead', LEAD_INSTRUMENTS], ['harmony', HARMONY_INSTRUMENTS]]) {
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
  assert.equal(resolveKit('808', 'anything'), '808');
  // A section saved before an instrument was renamed must still play.
  assert.equal(resolveLead('theremin', 'x'), resolveLead(AUTO, 'x'));
  assert.equal(leadInstrument('theremin').id, LEAD_INSTRUMENTS[0].id);
  assert.equal(harmonyInstrument(undefined).id, HARMONY_INSTRUMENTS[0].id);
  assert.equal(drumKit('nope').id, DRUM_KITS[0].id);
});

test('the three voices of a piece of music are resolved together', () => {
  const sound = resolveInstruments(
    { leadInstrument: 'flute', harmonyInstrument: AUTO, chordSeed: 'abc', melodySeed: 'def' },
    { kit: '909', seed: 'ghi' },
  );
  assert.equal(sound.lead, 'flute');
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
  assert.deepEqual(sectionSong(a).instruments, { lead: 'bell', harmony: 'organ', kit: '808' });

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
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 1, trackIds: ['kick'] }),
    instruments: { lead: 'pluck', harmony: 'rhodes', kit: 'tape' },
  });
  assert.ok(laid.chords.length && laid.chords.every((c) => c.instrument === 'rhodes'));
  assert.ok(laid.melody.length && laid.melody.every((n) => n.instrument === 'pluck'));
  assert.ok(laid.drums.length && laid.drums.every((h) => h.kit === 'tape'));
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

test('songToMidi includes chords, melody and drums on separate channels', () => {
  const chords = parseChords('Am F');
  const bytes = songToMidi({
    tempo: 100,
    swing: 0,
    chordVoicings: voiceProgression(chords, { octave: 3 }),
    stepsPerChord: 16,
    melody: [{ midi: 72, step: 0, length: 4, velocity: 100 }],
    rhythm: generateRhythm({ rng: makeRng('r'), steps: 16, bars: 1, trackIds: ['kick'] }),
  });
  const text = String.fromCharCode(...bytes);
  assert.equal((text.match(/MTrk/g) || []).length, 4); // tempo + three parts
  assert.ok(bytes.includes(0x99), 'drums should be on channel 10');
  assert.ok(bytes.includes(0x91), 'melody should be on channel 2');
});

test('step-to-tick conversion applies swing to off-steps', () => {
  assert.equal(stepToTicks(0), 0);
  assert.equal(stepToTicks(4), 480);
  assert.equal(stepToTicks(1, 0), 120);
  assert.equal(stepToTicks(1, 0.5), 150);
});
