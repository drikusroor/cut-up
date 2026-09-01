// The desk, rolling a section again, and the two file formats.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compressorSettings,
  defaultChannel,
  defaultMix,
  describeMix,
  effectiveLevels,
  EQ_BANDS,
  impulseResponse,
  isDefaultMix,
  MIXER_TRACKS,
  MixerRig,
  normalizeMix,
  panLabel,
  TRACK_IDS,
} from '../src/music/mixer.js';
import { Synth } from '../src/music/synth.js';
import {
  allAspects, describeAspects, REGEN_ASPECTS, regenerateSection,
} from '../src/music/regenerate.js';
import {
  applyVariations,
  describeSectionState,
  describeVariations,
  DIALS,
  getVariation,
  KEY_MOVES,
  keyMove,
  MOVES,
  readVariations,
  sectionTraitLine,
  SWITCHES,
  VARIATION_GROUPS,
  variationApplies,
} from '../src/music/variations.js';
import { makeSection } from '../src/music/sections.js';
import { composeSong } from '../src/music/compose.js';
import {
  applySong,
  byteSize,
  parseFile,
  sectionFile,
  sectionFilename,
  serialize,
  sizeLabel,
  slug,
  songFile,
  songFilename,
} from '../src/library/format.js';
import {
  clear, get, list, put, remove, storageKind, STORES,
} from '../src/library/store.js';

// --- the desk ---------------------------------------------------------------

/** Enough of a Web Audio context to build a desk in and read the knobs back. */
function fakeContext() {
  const made = [];
  const param = (value = 0) => ({
    value,
    setTargetAtTime(target) { this.value = target; return this; },
    setValueAtTime(target) { this.value = target; return this; },
    linearRampToValueAtTime(target) { this.value = target; return this; },
  });
  const node = (kind, extra = {}) => {
    const built = {
      kind, connect(to) { return to; }, disconnect() {}, ...extra,
    };
    made.push(built);
    return built;
  };
  return {
    made,
    currentTime: 0,
    sampleRate: 48000,
    destination: node('destination'),
    createGain: () => node('gain', { gain: param(1) }),
    createBiquadFilter: () => node('filter', { type: 'peaking', frequency: param(), Q: param(), gain: param() }),
    createDynamicsCompressor: () => node('comp', {
      threshold: param(), ratio: param(), knee: param(), attack: param(), release: param(),
    }),
    createStereoPanner: () => node('panner', { pan: param() }),
    createConvolver: () => node('convolver', { buffer: null }),
    createBuffer: (channels, length) => ({
      numberOfChannels: channels,
      length,
      getChannelData: () => new Float32Array(length),
    }),
  };
}

test('a fresh desk is flat, and says so', () => {
  const mix = defaultMix();
  assert.equal(isDefaultMix(mix), true);
  assert.equal(describeMix(mix), 'flat — everything at unity');
  for (const id of TRACK_IDS) {
    assert.deepEqual(mix.tracks[id], defaultChannel(id));
  }
});

test('a mix read back from anywhere is put inside its own ranges', () => {
  const mix = normalizeMix({
    master: 40,
    reverb: { size: -3, damp: 9 },
    tracks: { melody: { level: -5, pan: 12, low: 99, compress: 4 } },
  });
  assert.equal(mix.master, 2);
  assert.equal(mix.reverb.size, 0);
  assert.equal(mix.reverb.damp, 1);
  assert.equal(mix.tracks.melody.level, 0);
  assert.equal(mix.tracks.melody.pan, 1);
  assert.equal(mix.tracks.melody.low, 15);
  assert.equal(mix.tracks.melody.compress, 1);
  // A channel the file never mentioned is still a channel.
  assert.deepEqual(mix.tracks.drums, defaultChannel('drums'));
});

test('muting a channel takes it to nothing and leaves the rest alone', () => {
  const mix = defaultMix();
  mix.tracks.drums.mute = true;
  const levels = effectiveLevels(mix);
  assert.equal(levels.drums, 0);
  assert.equal(levels.melody, 1);
  assert.equal(describeMix(mix), 'drums muted');
});

test('soloing anything silences everything that is not soloed', () => {
  const mix = defaultMix();
  mix.tracks.vocal.solo = true;
  const levels = effectiveLevels(mix);
  assert.equal(levels.vocal, 1);
  for (const id of TRACK_IDS.filter((track) => track !== 'vocal')) {
    assert.equal(levels[id], 0);
  }
  assert.equal(describeMix(mix), 'soloing voice');
});

test('the master fader multiplies every channel', () => {
  const mix = defaultMix();
  mix.master = 0.5;
  mix.tracks.bass.level = 0.5;
  const levels = effectiveLevels(mix);
  assert.equal(levels.bass, 0.25);
  assert.equal(levels.melody, 0.5);
});

test('one compression knob walks the threshold down as it walks the ratio up', () => {
  const open = compressorSettings(0);
  const squeezed = compressorSettings(1);
  assert.ok(squeezed.threshold < open.threshold);
  assert.ok(squeezed.ratio > open.ratio);
  assert.ok(squeezed.attack < open.attack);
  // What it takes off is partly given back, or nobody would ever turn it up.
  assert.ok(squeezed.makeup > open.makeup);
  // Out of range in either direction is still a usable set of numbers.
  assert.deepEqual(compressorSettings(-4), open);
  assert.deepEqual(compressorSettings(9), squeezed);
});

test('a bigger reverb is a longer impulse', () => {
  const ctx = fakeContext();
  const small = impulseResponse(ctx, { size: 0 });
  const big = impulseResponse(ctx, { size: 1 });
  assert.ok(big.length > small.length);
  assert.equal(big.numberOfChannels, 2);
});

test('every part arrives on its own channel of the desk', () => {
  const ctx = fakeContext();
  const master = ctx.createGain();
  const rig = new MixerRig(ctx, master, defaultMix());
  const inputs = MIXER_TRACKS.map((track) => rig.input(track.id));
  assert.equal(new Set(inputs).size, MIXER_TRACKS.length);
  // Anything the desk has never heard of goes straight out rather than nowhere.
  assert.equal(rig.input('kazoo'), master);
});

test('moving a fader moves the graph that is already running', () => {
  const ctx = fakeContext();
  const rig = new MixerRig(ctx, ctx.createGain(), defaultMix());
  const before = rig.channels.bass;

  const mix = defaultMix();
  mix.tracks.bass.level = 0.25;
  mix.tracks.bass.pan = -1;
  mix.tracks.bass.reverb = 0.5;
  mix.tracks.bass.low = 6;
  rig.apply(mix);

  // The same nodes, with different numbers in them — nothing was rebuilt.
  assert.equal(rig.channels.bass, before);
  assert.equal(rig.channels.bass.fader.gain.value, 0.25);
  assert.equal(rig.channels.bass.panner.pan.value, -1);
  assert.equal(rig.channels.bass.send.gain.value, 0.5);
  const low = EQ_BANDS.findIndex((band) => band.id === 'low');
  assert.equal(rig.channels.bass.bands[low].gain.value, 6);
});

test('taking the desk out of circuit is a straight wire', () => {
  const ctx = fakeContext();
  const mix = defaultMix();
  mix.on = false;
  mix.tracks.melody.pan = 1;
  mix.tracks.melody.low = -12;
  mix.tracks.melody.level = 0.1;
  const rig = new MixerRig(ctx, ctx.createGain(), mix);
  assert.equal(rig.channels.melody.fader.gain.value, 1);
  assert.equal(rig.channels.melody.panner.pan.value, 0);
  assert.equal(rig.channels.melody.bands[0].gain.value, 0);
});

test('a synth with no context to build in plays straight at the master bus', () => {
  const synth = new Synth();
  assert.equal(synth.bus('melody'), null);
  const ctx = fakeContext();
  const master = ctx.createGain();
  const wired = new Synth(ctx, master);
  wired.setMix(defaultMix());
  assert.notEqual(wired.bus('melody'), master);
  assert.equal(wired.bus('melody'), wired.bus('melody'));
});

test('pan reads the way a desk writes it', () => {
  assert.equal(panLabel(0), 'C');
  assert.equal(panLabel(-0.4), 'L40');
  assert.equal(panLabel(1), 'R100');
});

// --- rolling a section again ------------------------------------------------

/** A song's worth of sections, written the way the composer writes them. */
function composed(seed = 'test-seed') {
  return composeSong({
    settings: {
      seed, letters: 3, minutes: 2, intro: true, outro: true,
    },
    tempo: 100,
    meter: { beats: 4, unit: 4 },
    rootPc: 9,
    scaleId: 'minor',
  });
}

/** The first section that actually has chords, a tune and a bass line in it. */
function fullSection(result) {
  return result.sections.find((section) => section.music.chords.length
    && section.music.melody.length && section.music.bass.length);
}

test('rolling everything keeps what the section is and changes what it is made of', () => {
  const section = fullSection(composed());
  const rolled = regenerateSection(section, { aspects: allAspects() });

  assert.equal(rolled.id, section.id);
  assert.equal(rolled.name, section.name);
  assert.equal(rolled.kind, section.kind);
  assert.equal(rolled.music.rootPc, section.music.rootPc);
  assert.equal(rolled.music.scaleId, section.music.scaleId);
  assert.equal(rolled.music.chords.length, section.music.chords.length);
  // A different take: the seeds moved, so at least one part came out different.
  assert.notEqual(rolled.music.chordSeed, section.music.chordSeed);
  assert.notEqual(
    JSON.stringify([rolled.music.chords, rolled.music.melody, rolled.rhythm.pattern]),
    JSON.stringify([section.music.chords, section.music.melody, section.rhythm.pattern]),
  );
  // And it is still playable: the voicings were rebuilt for the new chords.
  assert.equal(rolled.music.voicings.length, rolled.music.chords.length);
});

test('rolling one aspect leaves every other note exactly where it was', () => {
  const section = fullSection(composed());
  const rolled = regenerateSection(section, { aspects: ['melody'] });

  assert.deepEqual(rolled.music.chords, section.music.chords);
  assert.deepEqual(rolled.rhythm.pattern, section.rhythm.pattern);
  assert.deepEqual(rolled.music.bass, section.music.bass);
  assert.equal(rolled.music.leadInstrument, section.music.leadInstrument);
  assert.notDeepEqual(rolled.music.melody, section.music.melody);
});

test('new instruments are new instruments, and only that', () => {
  const section = fullSection(composed());
  const rolled = regenerateSection(section, { aspects: ['instruments'] });
  assert.deepEqual(rolled.music.melody, section.music.melody);
  assert.deepEqual(rolled.rhythm.pattern, section.rhythm.pattern);
  assert.notEqual(rolled.music.leadInstrument, section.music.leadInstrument);
  assert.notEqual(rolled.rhythm.kit, section.rhythm.kit);
});

test('a section written without chords does not get handed a progression', () => {
  const section = makeSection({
    name: 'Count-in',
    kind: 'intro',
    music: {
      rootPc: 0, scaleId: 'minor', chords: [], melody: [], melodyBase: [], bass: [], length: 4,
    },
    rhythm: {
      style: 'euclid', bars: 1, density: 0.5, variation: 0.2, trackIds: ['kick', 'hat'],
    },
    meter: { beats: 4, unit: 4 },
  });
  const rolled = regenerateSection(section, { aspects: allAspects() });
  assert.deepEqual(rolled.music.chords, []);
  assert.deepEqual(rolled.music.melody, []);
  assert.ok(rolled.rhythm.pattern.tracks.length);
});

test('moving a section to another key moves it, notes and all', () => {
  const section = fullSection(composed());
  const to = (section.music.rootPc + 5) % 12;
  const moved = regenerateSection(section, { aspects: [], rootPc: to });

  assert.equal(moved.music.rootPc, to);
  assert.equal(moved.music.chords.length, section.music.chords.length);
  assert.equal(moved.music.melody.length, section.music.melody.length);
  // Every chord moved by the same interval, which is what a key change is.
  const steps = new Set(moved.music.chords.map(
    (chord, i) => (chord.rootPc - section.music.chords[i].rootPc + 12) % 12,
  ));
  assert.deepEqual([...steps], [5]);
  const notes = new Set(moved.music.melody.map((note, i) => note.midi - section.music.melody[i].midi));
  assert.equal(notes.size, 1);
});

test('a change of mode is written rather than moved into', () => {
  const section = fullSection(composed());
  const rolled = regenerateSection(section, { aspects: [], scaleId: 'major' });
  assert.equal(rolled.music.scaleId, 'major');
  // Chords were rewritten even though the box was not ticked, because there is
  // no other honest answer.
  assert.notDeepEqual(rolled.music.chords, section.music.chords);
});

test('the same seed is the same take twice', () => {
  const section = fullSection(composed());
  const once = regenerateSection(section, { seed: 'kerosene' });
  const twice = regenerateSection(section, { seed: 'kerosene' });
  const other = regenerateSection(section, { seed: 'ribcage' });
  assert.deepEqual(once.music, twice.music);
  assert.deepEqual(once.rhythm.pattern, twice.rhythm.pattern);
  assert.notDeepEqual(once.music.chords, other.music.chords);
});

// --- the variations ---------------------------------------------------------

test('every variation belongs to a group the dialog draws', () => {
  const groups = new Set(VARIATION_GROUPS.map((group) => group.id));
  for (const variation of [...SWITCHES, ...MOVES, ...DIALS]) {
    assert.ok(groups.has(variation.group), `${variation.id} is in no group`);
    assert.ok(variation.label && variation.hint, `${variation.id} says nothing about itself`);
  }
  // Ids are what a saved edit is written in terms of, so they have to be unique.
  const ids = [...SWITCHES, ...MOVES, ...DIALS].map((variation) => variation.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('a switch reads what the section is doing, both ways round', () => {
  const section = fullSection(composed());
  const state = readVariations(section);
  assert.equal(state.switches.noBass, false);
  assert.equal(state.switches.noTune, false);

  const stripped = regenerateSection(section, {
    aspects: [],
    variations: { switches: { noBass: true, noDrums: true, noTune: true } },
  });
  assert.deepEqual(stripped.music.bass, []);
  assert.equal(stripped.music.bassOn, false);
  assert.deepEqual(stripped.rhythm.trackIds, []);
  assert.deepEqual(stripped.music.melody, []);
  assert.deepEqual(readVariations(stripped).switches, {
    noBass: true, noDrums: true, noTune: true,
  });
});

test('unticking a switch puts the part back, written fresh', () => {
  const section = fullSection(composed());
  const stripped = regenerateSection(section, {
    aspects: [],
    variations: { switches: { noBass: true, noDrums: true, noTune: true } },
  });
  const restored = regenerateSection(stripped, {
    aspects: [],
    variations: { switches: { noBass: false, noDrums: false, noTune: false } },
    seed: 'back',
  });
  assert.ok(restored.music.bass.length, 'the bass came back');
  assert.ok(restored.music.melody.length, 'the tune came back');
  assert.ok(restored.rhythm.pattern.tracks.length, 'the drums came back');
  assert.deepEqual(describeSectionState(restored).filter((trait) => trait.startsWith('no')), []);
});

test('a state a switch owns is never left claimed in the stored traits', () => {
  const section = { ...fullSection(composed()), traits: ['no bass', 'a modal vamp'] };
  const rolled = regenerateSection(section, {
    aspects: [],
    variations: { switches: { noBass: false } },
    seed: 'x',
  });
  // The stored line keeps the history and drops the claim about the state; the
  // card asks the music itself about that.
  assert.deepEqual(rolled.traits, ['a modal vamp']);
  assert.ok(!describeSectionState(rolled).includes('no bass'));
});

test('a dial is read off the section and written back to it', () => {
  const section = fullSection(composed());
  const quiet = regenerateSection(section, {
    aspects: [],
    variations: { dials: { dynamics: 0.8, tempoScale: 0.9 } },
  });
  assert.equal(quiet.dynamics, 0.8);
  assert.equal(quiet.tempoScale, 0.9);
  assert.ok(describeSectionState(quiet).includes('played at 80%'));
  assert.ok(describeSectionState(quiet).includes('taken at 90% of the tempo'));

  // Back to 1 is "nothing to say", not "a dial set to one".
  const plain = regenerateSection(quiet, {
    aspects: [],
    variations: { dials: { dynamics: 1, tempoScale: 1 } },
  });
  assert.equal(plain.dynamics, undefined);
  assert.equal(plain.tempoScale, undefined);
  assert.deepEqual(describeSectionState(plain), []);
});

test('a move that changes the settings also writes the music again', () => {
  const section = fullSection(composed());
  // Nothing is asked to roll, so anything that moves moved because the
  // variation said it had to.
  const busier = regenerateSection(section, {
    aspects: [],
    variations: { moves: ['busier'] },
    seed: 'busy',
  });
  assert.ok(busier.music.density > section.music.density);
  assert.notDeepEqual(busier.music.melody, section.music.melody);
  assert.ok(busier.traits.includes('busier, and more chromatic'));
});

test('the tune goes up an octave without being rewritten', () => {
  const section = fullSection(composed());
  const up = regenerateSection(section, {
    aspects: [],
    variations: { moves: ['octave'] },
  });
  assert.equal(up.music.melody.length, section.music.melody.length);
  const steps = new Set(up.music.melody.map((note, i) => note.midi - section.music.melody[i].midi));
  assert.deepEqual([...steps], [12]);
  assert.equal(up.music.rangeLow, section.music.rangeLow + 12);
});

test('halving a section keeps the front of its progression', () => {
  const section = fullSection(composed());
  if (section.music.chords.length < 4) return;
  const half = regenerateSection(section, { aspects: [], variations: { moves: ['halve'] }, seed: 'h' });
  const want = Math.max(2, Math.round(section.music.chords.length / 2));
  assert.equal(half.music.chords.length, want);
  assert.deepEqual(half.music.chords, section.music.chords.slice(0, want));
  assert.equal(half.music.voicings.length, want);
});

test('a move that cannot apply is not offered and does nothing if asked for', () => {
  const silent = makeSection({
    name: 'Count-in',
    kind: 'intro',
    music: {
      rootPc: 0, scaleId: 'minor', chords: [], melody: [], melodyBase: [], bass: [], length: 4,
    },
    rhythm: {
      style: 'euclid', bars: 1, density: 0.5, variation: 0.2, trackIds: ['kick', 'hat'],
    },
    meter: { beats: 4, unit: 4 },
  });
  assert.equal(variationApplies(getVariation('octave'), silent), false);
  assert.ok(!readVariations(silent).available.includes('octave'));
  const rolled = regenerateSection(silent, { aspects: [], variations: { moves: ['octave'] } });
  assert.deepEqual(rolled.music.melody, []);
  assert.ok(!(rolled.traits || []).includes('the tune an octave up'));
});

test('applying variations twice from the same seed lands in the same place', () => {
  const section = fullSection(composed());
  const wanted = { switches: { noDrums: true }, moves: ['busier', 'colour'], dials: { dynamics: 0.7 } };
  const once = regenerateSection(section, { aspects: [], variations: wanted, seed: 'twice' });
  const twice = regenerateSection(section, { aspects: [], variations: wanted, seed: 'twice' });
  assert.deepEqual(once.music, twice.music);
  assert.deepEqual(once.rhythm, twice.rhythm);
});

test('applyVariations reports what it disturbed', () => {
  const section = fullSection(composed());
  const draft = JSON.parse(JSON.stringify(section));
  const edit = applyVariations(draft, { moves: ['busier', 'kit'] }, { rng: () => 0.5 });
  assert.ok(edit.rolls.has('melody'));
  assert.ok(edit.rolls.has('drums'));
  // In catalogue order rather than the order they were asked for, so two moves
  // always compose the same way round.
  assert.deepEqual(edit.traits, ['a different kit', 'busier, and more chromatic']);
});

test('the key shortcuts answer with a key rather than changing anything', () => {
  assert.deepEqual(keyMove('relative', { rootPc: 9, scaleId: 'minor' }), { rootPc: 0, scaleId: 'major' });
  assert.deepEqual(keyMove('parallel', { rootPc: 9, scaleId: 'minor' }), { rootPc: 9, scaleId: 'major' });
  assert.deepEqual(keyMove('fourth', { rootPc: 9, scaleId: 'minor' }), { rootPc: 2, scaleId: 'minor' });
  assert.deepEqual(keyMove('semitone', { rootPc: 11, scaleId: 'major' }), { rootPc: 0, scaleId: 'major' });
  // An id it does not know leaves the key alone rather than inventing one.
  assert.deepEqual(keyMove('nonsense', { rootPc: 3, scaleId: 'dorian' }), { rootPc: 3, scaleId: 'dorian' });
  assert.ok(KEY_MOVES.every((move) => move.label && move.hint));
});

test('a compound description is not repeated by the switches under it', () => {
  const drumsOnly = makeSection({
    name: 'Count-in',
    kind: 'intro',
    music: {
      rootPc: 0, scaleId: 'minor', chords: [], melody: [], melodyBase: [], bass: [], length: 4,
    },
    rhythm: {
      style: 'euclid', bars: 1, density: 0.5, variation: 0.2, trackIds: ['kick', 'hat'],
    },
    meter: { beats: 4, unit: 4 },
    traits: ['drums alone'],
  });
  // "Drums alone" already says there is no bass and no tune — and says the one
  // thing the switches cannot, which is that there are no chords either.
  assert.deepEqual(sectionTraitLine(drumsOnly), ['drums alone']);
  // A section that says nothing about itself still gets the derived half. The
  // bass is not switched off here, it simply has no notes — which is a different
  // fact, and not one the switch claims.
  assert.deepEqual(sectionTraitLine({ ...drumsOnly, traits: [] }), ['no tune']);
  assert.deepEqual(
    sectionTraitLine({ ...drumsOnly, traits: [], music: { ...drumsOnly.music, bassOn: false } }),
    ['no bass', 'no tune'],
  );
});

test('a stored claim about the music is dropped when it stops being true', () => {
  const intro = composed().sections.find((section) => (section.traits || []).includes('chords on their own'));
  if (!intro) return;

  // Still true after a roll that did not give it a tune, so it still says so —
  // and it says more than the switches can, since it also means "no bass".
  const rolled = regenerateSection(intro, { aspects: ['drums'], seed: 'a' });
  assert.ok(rolled.traits.includes('chords on their own'));

  // And gone the moment it is given one, without anybody having to remember to
  // go and edit the line.
  const tuned = regenerateSection(intro, {
    aspects: [],
    variations: { switches: { noTune: false } },
    seed: 'a',
  });
  assert.ok(tuned.music.melody.length);
  assert.ok(!(tuned.traits || []).includes('chords on their own'));
});

test('what a set of variations is about to do, in words', () => {
  assert.equal(describeVariations([]), '');
  assert.equal(describeVariations(['busier']), 'busier, and more chromatic');
  assert.equal(describeVariations(['octave', 'sparser']), 'more air in it and the tune an octave up');
});

test('what a roll is about to touch, in words', () => {
  assert.equal(describeAspects([]), 'nothing');
  assert.equal(describeAspects(['melody']), 'melody');
  assert.equal(describeAspects(['chords', 'melody']), 'chords and melody');
  assert.equal(describeAspects(allAspects()), 'everything');
  assert.equal(REGEN_ASPECTS.length, allAspects().length);
});

// --- the file formats -------------------------------------------------------

/** A state object shaped like the app's, small enough to read in a test. */
function fakeState() {
  const result = composed('file-seed');
  return {
    tempo: 104,
    swing: 0.15,
    meter: { beats: 7, unit: 8 },
    feel: { amount: 0.4, seed: 'feel', parts: {} },
    tuning: { system: 'edo', divisions: 19, detune: 4, drift: 2, seed: 'tune' },
    mix: (() => {
      const mix = defaultMix();
      mix.tracks.drums.level = 0.6;
      mix.tracks.vocal.reverb = 0.4;
      return mix;
    })(),
    parts: {
      chords: true, melody: true, vocal: false, bass: true, drums: true,
    },
    music: { rootPc: 9, scaleId: 'minor', chords: [], vocal: { on: true, lines: ['a line'] } },
    rhythm: { style: 'euclid', bars: 2, pattern: null },
    sections: result.sections,
    arrangement: result.arrangement,
    currentSectionId: result.sections[0].id,
    compose: { seed: 'file-seed', letters: 3 },
    words: { lang: 'en', text: 'a page of newsprint', output: ['a line', 'another'] },
  };
}

test('a section survives the round trip through a file', () => {
  const section = fullSection(composed());
  const parsed = parseFile(serialize(sectionFile(section)));
  assert.equal(parsed.kind, 'section');
  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].name, section.name);
  assert.deepEqual(parsed.sections[0].music.chords, section.music.chords);
  assert.deepEqual(parsed.sections[0].music.melody, section.music.melody);
});

test('several sections travel in one file', () => {
  const sections = composed().sections.slice(0, 3);
  const parsed = parseFile(sectionFile(sections));
  assert.equal(parsed.sections.length, 3);
  assert.deepEqual(parsed.sections.map((s) => s.name), sections.map((s) => s.name));
});

test('a song file carries the whole desk, not only the notes', () => {
  const state = fakeState();
  const parsed = parseFile(serialize(songFile(state, { name: 'The Undertow' })));

  assert.equal(parsed.kind, 'song');
  assert.equal(parsed.song.name, 'The Undertow');
  assert.equal(parsed.song.tempo, 104);
  assert.equal(parsed.song.swing, 0.15);
  assert.deepEqual(parsed.song.meter, { beats: 7, unit: 8 });
  assert.equal(parsed.song.tuning.divisions, 19);
  assert.equal(parsed.song.mix.tracks.drums.level, 0.6);
  assert.equal(parsed.song.mix.tracks.vocal.reverb, 0.4);
  assert.equal(parsed.song.parts.vocal, false);
  assert.equal(parsed.song.sections.length, state.sections.length);
  assert.equal(parsed.song.arrangement.length, state.arrangement.length);
  // The words are half the point of this program, so they travel with it.
  assert.equal(parsed.song.words.text, 'a page of newsprint');
});

test('a running order pointing at sections a file does not carry is not kept', () => {
  const state = fakeState();
  const file = songFile(state, { name: 'Holes' });
  file.song.arrangement.push({ sectionId: 'no-such-section', repeats: 3 });
  const parsed = parseFile(file);
  assert.equal(
    parsed.song.arrangement.some((item) => item.sectionId === 'no-such-section'),
    false,
  );
});

test('settings out of range in a file are clamped rather than trusted', () => {
  const state = fakeState();
  const file = songFile(state, { name: 'Loud' });
  file.song.tempo = 9000;
  file.song.mix.master = 40;
  file.song.arrangement[0].repeats = 900;
  const parsed = parseFile(file);
  assert.equal(parsed.song.tempo, 220);
  assert.equal(parsed.song.mix.master, 2);
  assert.equal(parsed.song.arrangement[0].repeats, 16);
});

test('a file from a newer version is refused with a sentence, not a stack trace', () => {
  const file = songFile(fakeState(), { name: 'From the future' });
  file.version = 99;
  assert.throws(() => parseFile(file), /newer version/);
  assert.throws(() => parseFile('not json at all'), /not even JSON/);
  assert.throws(() => parseFile('{"format":"something-else"}'), /not a Cut-Up/);
  assert.throws(() => parseFile('{"format":"cut-up.section","sections":[{}]}'), /no music/);
});

test('opening a song pours it into the state without replacing what the panels hold', () => {
  const state = fakeState();
  const file = parseFile(songFile(state, { name: 'Again' }));

  const live = {
    tempo: 96,
    swing: 0,
    meter: { beats: 4, unit: 4 },
    feel: {},
    tuning: {},
    mix: defaultMix(),
    parts: {
      chords: true, melody: true, vocal: true, bass: true, drums: true,
    },
    music: { rootPc: 0, scaleId: 'major', chords: [], vocal: { on: false } },
    rhythm: { style: 'euclid', pattern: null },
    sections: [],
    arrangement: [],
    words: { lang: 'en', text: '' },
    compose: {},
  };
  const music = live.music;
  const rhythm = live.rhythm;

  applySong(live, file.song);

  // The panels hold these two objects, so they are filled rather than swapped.
  assert.equal(live.music, music);
  assert.equal(live.rhythm, rhythm);
  assert.equal(live.tempo, 104);
  assert.equal(live.music.rootPc, 9);
  assert.equal(live.parts.vocal, false);
  assert.equal(live.sections.length, state.sections.length);
  assert.equal(live.words.text, 'a page of newsprint');
  assert.equal(live.mix.tracks.drums.level, 0.6);
});

test('file names survive a file system, and sizes read like sizes', () => {
  assert.equal(slug('Middle eight'), 'middle-eight');
  assert.equal(slug('  '), 'cut-up');
  assert.equal(sectionFilename({ name: 'Section A' }), 'cut-up-section-a.cutsec');
  assert.equal(songFilename('The Undertow'), 'cut-up-the-undertow.cutsong');
  assert.equal(sizeLabel(400), '400 B');
  assert.equal(sizeLabel(4096), '4 KB');
  assert.equal(sizeLabel(3 * 1024 * 1024), '3.0 MB');
  assert.ok(byteSize({ a: 'x' }) > 0);
});

// --- the shelf --------------------------------------------------------------

test('the shelf keeps things, hands them back newest first, and lets them go', async () => {
  // Node has neither IndexedDB nor localStorage, which is the third case the
  // store is written for: it keeps the library in memory so the page still runs.
  await put(STORES.sections, { id: 'one', name: 'One', savedAt: 1000 });
  await put(STORES.sections, { id: 'two', name: 'Two', savedAt: 2000 });
  assert.deepEqual((await list(STORES.sections)).map((r) => r.name), ['Two', 'One']);
  assert.equal((await get(STORES.sections, 'one')).name, 'One');
  assert.equal(storageKind(), 'memory');

  await remove(STORES.sections, 'one');
  assert.deepEqual((await list(STORES.sections)).map((r) => r.name), ['Two']);
  assert.equal(await get(STORES.sections, 'one'), null);

  // Songs are a different shelf, not the same one under another name.
  await put(STORES.songs, { id: 'song', name: 'A song', savedAt: 1 });
  assert.equal((await list(STORES.songs)).length, 1);
  assert.equal((await list(STORES.sections)).length, 1);

  await clear(STORES.sections);
  await clear(STORES.songs);
  assert.deepEqual(await list(STORES.sections), []);
});
