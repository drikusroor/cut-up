import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSONANTS,
  countSyllables,
  isVowel,
  lineSyllables,
  phoneIds,
  phoneInfo,
  phonemise,
  syllabifyPhones,
  VOWELS,
  wordSyllables,
} from '../src/music/phonemes.js';
import {
  defaultVocal,
  normalizeVocal,
  phoneSchedule,
  phraseMelody,
  setLyric,
  singMelody,
  spreadSyllables,
  sungText,
  VOCAL_MODES,
  VOCAL_VOICES,
  vocalMode,
  vocalVoice,
} from '../src/music/vocal.js';
import { songToMidi } from '../src/music/midi.js';
import { AudioEngine } from '../src/music/audio.js';
import { sectionSong } from '../src/music/sections.js';

// --- sounding words out -----------------------------------------------------

test('every phone the rules can produce knows how to be made', () => {
  for (const id of phoneIds()) {
    const info = phoneInfo(id);
    assert.ok(info, `${id} has no recipe`);
    if (info.kind === 'vowel') {
      assert.equal(info.f.length, 3, `${id} needs three formants`);
      assert.ok(info.f.every((hz) => hz > 100 && hz < 4000), `${id} has a formant off the map`);
      if (info.glide) assert.equal(info.glide.length, 3);
    } else if (info.kind === 'plosive' || info.kind === 'affricate') {
      assert.ok(info.burst > 0, `${id} has no burst`);
    } else if (info.f) {
      assert.equal(info.f.length, 3);
    } else {
      assert.ok(info.band > 0, `${id} has no noise band`);
    }
  }
  // The vowels and the consonants are two disjoint sets, and isVowel agrees.
  for (const id of Object.keys(VOWELS)) assert.ok(isVowel(id));
  for (const id of Object.keys(CONSONANTS)) assert.ok(!isVowel(id));
});

test('English spelling comes out as roughly the right sounds', () => {
  const say = (word) => phonemise(word, 'en').map((x) => x.p).join(' ');
  assert.equal(say('the'), 'D @');
  assert.equal(say('sing'), 's I N');
  assert.equal(say('shine'), 'S aI n');
  assert.equal(say('thunder'), 'T V n d 3');
  assert.equal(say('nation'), 'n eI S @ n');
  // A doubled consonant is one sound, not two.
  assert.equal(say('running'), 'r V n I N');
  // The listed words win over the rules, which is what they are for.
  assert.equal(say('people'), 'p i p @ l');
});

test('Dutch spelling comes out as roughly the right sounds', () => {
  const say = (word) => phonemise(word, 'nl').map((x) => x.p).join(' ');
  assert.equal(say('huis'), 'h 9Y s');
  assert.equal(say('nacht'), 'n Q x t');
  assert.equal(say('meeuw'), 'm e w');
  // Open syllable long, closed syllable short — the one rule Dutch really has.
  assert.equal(say('maken'), 'm A k @ n');
  assert.equal(say('makkelijk').slice(0, 5), 'm Q k');
  // Final devoicing: the d in "hand" is a t.
  assert.equal(say('hand'), 'h Q n t');
});

test('sounding a word out is deterministic and survives rubbish', () => {
  assert.deepEqual(phonemise('kerosene', 'en'), phonemise('kerosene', 'en'));
  assert.deepEqual(phonemise('KEROSENE', 'en'), phonemise('kerosene', 'en'));
  assert.deepEqual(phonemise('', 'en'), []);
  assert.deepEqual(phonemise('...', 'en'), []);
  assert.deepEqual(phonemise('123', 'en'), []);
  // An accent is a spelling, not a different word.
  assert.ok(phonemise('café', 'en').length > 0);
});

test('a word breaks into one syllable per vowel', () => {
  const count = (word, lang = 'en') => wordSyllables(word, lang).length;
  assert.equal(count('cut'), 1);
  assert.equal(count('kerosene'), 3);
  assert.equal(count('undertow'), 3);
  assert.equal(count('wallpaper'), 3);
  assert.equal(count('zilveren', 'nl'), 3);
  assert.equal(count('straat', 'nl'), 1);
  // Every syllable has a vowel in it, and every phone lands in exactly one.
  for (const word of ['harbour', 'machine', 'rattling', 'electric']) {
    const syllables = wordSyllables(word, 'en');
    const total = syllables.reduce((n, s) => n + s.phones.length, 0);
    assert.equal(total, phonemise(word, 'en').length);
    for (const syllable of syllables) assert.ok(syllable.phones.some(isVowel), `${word}: ${syllable.text}`);
  }
});

test('the syllables spell the word back', () => {
  for (const word of ['singing', 'wallpaper', 'undertow', 'ribcage', 'running']) {
    assert.equal(wordSyllables(word, 'en').map((s) => s.text).join(''), word);
  }
});

test('a syllable with no vowel in it is still one syllable', () => {
  // "shh" has no nucleus; it must not vanish or split into nothing.
  const groups = syllabifyPhones(phonemise('shh', 'en'));
  assert.equal(groups.length, 1);
  assert.deepEqual(syllabifyPhones([]), []);
});

test('a line becomes a run of syllables that know where the words are', () => {
  const line = lineSyllables('Rust and kerosene', 'en');
  assert.equal(line.length, countSyllables('Rust and kerosene', 'en'));
  assert.deepEqual(line.map((s) => s.word), ['Rust', 'and', 'kerosene', 'kerosene', 'kerosene']);
  assert.deepEqual(line.map((s) => s.wordStart), [true, true, true, false, false]);
  assert.deepEqual(line.map((s) => s.wordEnd), [true, true, false, false, true]);
});

// --- setting words to a tune ------------------------------------------------

/** Notes every `gap` steps, `length` long. */
function run(count, { step = 2, length = 2, from = 0 } = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`, midi: 60 + (i % 5), step: from + i * step, length,
  }));
}

test('a melody breaks into phrases where it rests', () => {
  const notes = [...run(4), ...run(3, { from: 16 })];
  const phrases = phraseMelody(notes);
  assert.equal(phrases.length, 2);
  assert.deepEqual(phrases[0], [0, 1, 2, 3]);
  assert.deepEqual(phrases[1], [4, 5, 6]);
  // No rests, one phrase.
  assert.equal(phraseMelody(run(8)).length, 1);
  assert.deepEqual(phraseMelody([]), []);
});

test('spare notes are handed out as held vowels, ends of words first', () => {
  const syllables = [
    { wordEnd: false }, { wordEnd: true }, { wordEnd: false }, { wordEnd: true },
  ];
  const spread = spreadSyllables(8, syllables, { melisma: 1 });
  assert.equal(spread.reduce((a, b) => a + b, 0), 8, 'every note is used');
  assert.ok(spread.every((n) => n >= 1), 'every syllable still gets a note');
  // The end of the line is where a singer has breath to spare.
  assert.ok(spread[3] > 1);
  // Exactly enough notes means one each, whatever the setting.
  assert.deepEqual(spreadSyllables(4, syllables, { melisma: 1 }), [1, 1, 1, 1]);
  assert.deepEqual(spreadSyllables(0, syllables), []);
  assert.deepEqual(spreadSyllables(4, []), []);
});

test('the words land on the notes in order', () => {
  const melody = run(6);
  const set = setLyric(melody, ['Cold salt hums'], { lang: 'en', seed: 'a' });
  const sung = set.notes.filter((n) => n.syllable && !n.syllable.tie)
    .sort((a, b) => a.step - b.step);
  assert.deepEqual(sung.map((n) => n.syllable.text), ['Cold', 'salt', 'hums']);
  assert.equal(set.syllables, 3);
  assert.equal(sungText(set.notes), 'Cold salt hums');
  // Nothing was moved and nothing was mutated.
  assert.deepEqual(melody, run(6), 'the melody it was given is untouched');
});

test('more notes than syllables holds vowels across them', () => {
  const set = setLyric(run(8), ['Cold wire'], { lang: 'en', melisma: 1, seed: 'b' });
  assert.equal(set.syllables, 3);
  assert.equal(set.sung, 8, 'every note in the phrase is sung');
  assert.equal(set.melismas, 5);
  const held = set.notes.filter((n) => n.syllable?.tie);
  // A held note carries the vowel only, and knows where it is sliding from.
  for (const note of held) {
    assert.ok(note.syllable.phones.every(isVowel), note.syllable.phones.join(''));
    assert.equal(typeof note.syllable.slideFrom, 'number');
  }
});

test('more syllables than notes splits the long notes', () => {
  const melody = [{ id: 'a', midi: 60, step: 0, length: 4 }, { id: 'b', midi: 62, step: 4, length: 4 }];
  const set = setLyric(melody, ['Rust and kerosene'], { lang: 'en', seed: 'c' });
  assert.ok(set.splits > 0, 'a long note was divided');
  assert.equal(set.notes.length, 2 + set.splits);
  // The pieces of a split note fill exactly the space the note had.
  const first = set.notes.filter((n) => n.step < 4);
  assert.equal(first.reduce((total, n) => total + n.length, 0), 4);
  // They are in time order and none of them are on top of each other.
  const steps = set.notes.map((n) => n.step);
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
  assert.equal(new Set(set.notes.map((n) => n.id)).size, set.notes.length, 'ids stay unique');
});

test('words that will not fit are carried on rather than lost', () => {
  const melody = [...run(2), ...run(2, { from: 16 })];
  const set = setLyric(melody, ['One two three four', 'five six'], { lang: 'en', seed: 'd' });
  const sung = set.notes.filter((n) => n.syllable && !n.syllable.tie)
    .sort((a, b) => a.step - b.step)
    .map((n) => n.syllable.word.toLowerCase());
  // The second phrase picks up where the first ran out, and only then moves on.
  assert.deepEqual(sung.slice(0, 2), ['one', 'two']);
  assert.deepEqual(sung.slice(2, 4), ['three', 'four']);
});

test('a line shorter than the tune comes round again', () => {
  const melody = [...run(2), ...run(2, { from: 16 }), ...run(2, { from: 32 })];
  const set = setLyric(melody, ['Ash', 'Bone'], { lang: 'en', seed: 'e' });
  assert.equal(set.phrases, 3);
  const words = set.notes.filter((n) => n.syllable && !n.syllable.tie)
    .sort((a, b) => a.step - b.step).map((n) => n.syllable.word);
  assert.deepEqual(words.slice(0, 3), ['Ash', 'Bone', 'Ash']);
});

test('setting the same words on the same tune twice gives the same result', () => {
  const a = setLyric(run(9), ['Kerosene rivers turning'], { seed: 'same', melisma: 0.6 });
  const b = setLyric(run(9), ['Kerosene rivers turning'], { seed: 'same', melisma: 0.6 });
  assert.deepEqual(a.notes, b.notes);
  const c = setLyric(run(9), ['Kerosene rivers turning'], { seed: 'other', melisma: 0.6 });
  assert.equal(c.syllables, a.syllables);
});

test('no words, or no melody, changes nothing', () => {
  assert.deepEqual(setLyric(run(4), []).notes, run(4));
  assert.deepEqual(setLyric(run(4), ['   ', '']).notes, run(4));
  assert.deepEqual(setLyric([], ['Ash']).notes, []);
});

// --- the shape of one syllable in time --------------------------------------

test('a syllable puts its consonants around its vowel', () => {
  const { segments, lead, vowelAt } = phoneSchedule(['s', 't', 'r', 'aI', 'k'], 0.5);
  assert.deepEqual(segments.map((s) => s.p), ['s', 't', 'r', 'aI', 'k']);
  // The consonants are sung in front of the beat, and the vowel is what lands.
  assert.ok(lead > 0 && lead <= 0.07);
  assert.equal(segments[0].at, -lead);
  assert.equal(segments[3].at, vowelAt);
  // Nothing overlaps and nothing leaves a hole.
  for (let i = 1; i < segments.length; i++) {
    assert.ok(Math.abs(segments[i].at - (segments[i - 1].at + segments[i - 1].dur)) < 1e-9);
  }
  // The whole thing lasts as long as the note does.
  const end = segments.at(-1).at + segments.at(-1).dur;
  assert.ok(Math.abs(end - 0.5) < 1e-9, `ends at ${end}`);
});

test('a very short note squeezes its consonants rather than dropping them', () => {
  const { segments } = phoneSchedule(['m', 'I', 'l', 'k'], 0.1);
  assert.deepEqual(segments.map((s) => s.p), ['m', 'I', 'l', 'k']);
  assert.ok(segments.every((s) => s.dur > 0));
  // The vowel is still there, however little of it there is.
  assert.ok(segments[1].dur >= 0.03);
});

test('a bare vowel is the whole note, and nonsense is nothing', () => {
  const { segments, lead } = phoneSchedule(['A'], 0.25);
  assert.deepEqual(segments, [{ p: 'A', at: 0, dur: 0.25 }]);
  assert.equal(lead, 0);
  assert.deepEqual(phoneSchedule(['?', '!'], 0.3).segments, []);
  assert.deepEqual(phoneSchedule([], 0.3).segments, []);
});

// --- settings ---------------------------------------------------------------

test('the voice settings clean up whatever they are handed', () => {
  const clean = normalizeVocal({
    on: 1, source: 'nonsense', voice: 'nope', mode: 'nope', level: 5, melisma: -2, lang: 'de', lines: [1, null],
  });
  assert.equal(clean.on, true);
  assert.equal(clean.source, defaultVocal().source);
  assert.equal(clean.voice, VOCAL_VOICES[0].id);
  assert.equal(clean.mode, VOCAL_MODES[0].id);
  assert.equal(clean.level, 1);
  assert.equal(clean.melisma, 0);
  assert.equal(clean.lang, 'en');
  assert.deepEqual(clean.lines, ['1', '']);
  assert.deepEqual(normalizeVocal(undefined), defaultVocal());
  // Every listed voice and mode is a real one with a hint on it.
  for (const voice of VOCAL_VOICES) {
    assert.equal(vocalVoice(voice.id).id, voice.id);
    assert.ok(voice.hint && voice.formant > 0);
  }
  for (const mode of VOCAL_MODES) assert.equal(vocalMode(mode.id).id, mode.id);
});

test('singMelody tags every sung note with how to sing it', () => {
  const music = {
    melody: run(6),
    melodySeed: 'seed',
    vocal: {
      on: true, lines: ['Cold salt hums'], voice: 'bass', mode: 'talkbox', level: 0.5,
    },
  };
  const { notes, stats } = singMelody(music);
  assert.ok(stats);
  for (const note of notes.filter((n) => n.syllable)) {
    assert.deepEqual(note.vocal, { voice: 'bass', mode: 'talkbox', level: 0.5 });
  }
  // Switched off, or with nothing to sing, the melody is handed straight back.
  assert.equal(singMelody({ melody: music.melody }).notes, music.melody);
  assert.equal(singMelody({ melody: music.melody, vocal: { on: true, lines: [] } }).notes, music.melody);
});

test('a saved section keeps the words it was saved with', () => {
  const section = {
    id: 'sec1',
    music: {
      voicings: [[60, 64, 67]],
      stepsPerChord: 16,
      melody: run(4),
      vocal: { on: true, lines: ['Rust and salt'], voice: 'tenor', mode: 'vocoder' },
    },
    rhythm: {},
  };
  const song = sectionSong(section);
  const sung = song.melody.filter((n) => n.syllable);
  assert.equal(sung.length, 4);
  assert.equal(sung[0].vocal.mode, 'vocoder');
});

// --- what comes out the other end -------------------------------------------

test('the exported MIDI carries the words on the melody track', () => {
  const song = {
    tempo: 100,
    melody: setLyric(run(6), ['Cold salt hums'], { seed: 'midi' }).notes,
    stepsPerChord: 16,
    // Exactly as long as the melody, so the loop does not repeat the line.
    totalSteps: 12,
    stepsPerBar: 12,
  };
  const bytes = songToMidi(song);
  // FF 05 <length> <text> — the lyric meta event.
  const found = [];
  for (let i = 0; i < bytes.length - 2; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0x05) {
      const len = bytes[i + 2];
      found.push(new TextDecoder().decode(bytes.slice(i + 3, i + 3 + len)));
    }
  }
  assert.deepEqual(found.map((s) => s.trim()), ['Cold', 'salt', 'hums']);
  // A melody with no words in it writes no lyric events at all.
  const plain = songToMidi({ tempo: 100, melody: run(6) });
  assert.ok(!plain.some((byte, i) => byte === 0xff && plain[i + 1] === 0x05));
});

/**
 * Enough of a Web Audio context to sing into. Every node is recorded, so a test
 * can ask what the voice actually built rather than what it sounded like.
 */
function fakeContext() {
  const graph = {
    time: 0, nodes: [], sources: [], connections: 0,
  };
  const param = () => ({
    value: 0,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
  });
  const node = (kind, extra) => {
    const made = {
      kind,
      connect(to) { graph.connections += 1; return to; },
      disconnect() {},
      ...extra,
    };
    graph.nodes.push(made);
    return made;
  };
  const source = (kind, extra) => node(kind, {
    start(at) { graph.sources.push({ kind, at, stop: Infinity }); },
    stop(at) {
      const last = [...graph.sources].reverse().find((s) => s.kind === kind);
      if (last) last.stop = at;
    },
    ...extra,
  });
  graph.ctx = {
    get currentTime() { return graph.time; },
    sampleRate: 48000,
    state: 'running',
    destination: { connect() {} },
    resume: async () => {},
    createGain: () => node('gain', { gain: param() }),
    createBiquadFilter: () => node('filter', { frequency: param(), Q: param(), type: 'lowpass' }),
    createDynamicsCompressor: () => node('comp', { threshold: param(), ratio: param() }),
    createWaveShaper: () => node('shaper', { curve: null, oversample: 'none' }),
    createOscillator: () => source('osc', { frequency: param(), detune: param(), type: 'sine' }),
    createBufferSource: () => source('buffer', { buffer: null, loop: false }),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) }),
  };
  graph.count = (kind) => graph.nodes.filter((n) => n.kind === kind).length;
  return graph;
}

function withContext(graph, run_) {
  const realWindow = global.window;
  global.window = { AudioContext: function AudioContext() { return graph.ctx; } };
  try {
    return run_();
  } finally {
    global.window = realWindow;
  }
}

test('singing a syllable builds a throat and a source', () => {
  const graph = fakeContext();
  withContext(graph, () => {
    const engine = new AudioEngine();
    engine.ensure();
    const note = { midi: 62, step: 0, length: 4, syllable: { text: 'strike', phones: ['s', 't', 'r', 'aI', 'k'] } };
    engine.sing(note, 1, 0.5, 0.2, 0, { voice: 'alto', mode: 'sung' });
    // A buzz, a breath, and three formants for them to come out of.
    assert.equal(graph.sources.filter((s) => s.kind === 'osc').length, 2, 'a glottis and a vibrato');
    assert.equal(graph.sources.filter((s) => s.kind === 'buffer').length, 1, 'one breath');
    assert.ok(graph.count('filter') >= 4);
    // Everything is tracked, so stopping the transport stops the singer too.
    assert.ok(engine.voices.length >= 3);
    engine.stop();
    assert.equal(engine.voices.length, 0);
  });
});

test('a syllable with nothing in it sings nothing', () => {
  const graph = fakeContext();
  withContext(graph, () => {
    const engine = new AudioEngine();
    engine.ensure();
    const before = graph.nodes.length;
    engine.sing({ midi: 60, syllable: { phones: [] } }, 1, 0.5);
    engine.sing({ midi: 60 }, 1, 0.5);
    assert.equal(graph.nodes.length, before);
  });
});

test('the vocoder is built once and reused', () => {
  const graph = fakeContext();
  withContext(graph, () => {
    const engine = new AudioEngine();
    engine.ensure();
    assert.ok(engine.canVocode());
    const note = { midi: 62, syllable: { text: 'ash', phones: ['a', 'S'] } };
    engine.sing(note, 1, 0.4, 0.2, 0, { mode: 'vocoder' });
    const afterFirst = graph.nodes.length;
    const rig = engine.vocalRig();
    assert.equal(rig.bands.length, 14);
    // A rectifier per band, and the bands rise from the bottom to the top.
    assert.equal(graph.count('shaper'), 14);
    assert.ok(rig.bands[0] < rig.bands.at(-1));
    engine.sing(note, 2, 0.4, 0.2, 0, { mode: 'vocoder' });
    // The second syllable adds a voice, not another vocoder.
    assert.ok(graph.nodes.length - afterFirst < 30);
    assert.equal(graph.count('shaper'), 14);
  });
});

test('without a wave shaper the voice sings dry rather than failing', () => {
  const graph = fakeContext();
  delete graph.ctx.createWaveShaper;
  withContext(graph, () => {
    const engine = new AudioEngine();
    engine.ensure();
    assert.equal(engine.canVocode(), false);
    engine.sing({ midi: 60, syllable: { text: 'ash', phones: ['a', 'S'] } }, 1, 0.4, 0.2, 0, { mode: 'vocoder' });
    assert.equal(graph.count('shaper'), 0);
    assert.ok(graph.sources.length > 0, 'it still made a sound');
  });
});

test('the transport sings the words on the melody', () => {
  const graph = fakeContext();
  const timers = new Map();
  const realSetTimeout = global.setTimeout;
  const realClearTimeout = global.clearTimeout;
  let id = 1;
  global.setTimeout = (fn) => { timers.set(id, fn); return id++; };
  global.clearTimeout = (key) => timers.delete(key);
  try {
    withContext(graph, () => {
      const engine = new AudioEngine();
      const melody = setLyric(run(4), ['Cold wire'], { seed: 'play' }).notes;
      engine.play({
        tempo: 120,
        melody,
        totalSteps: 16,
        loop: false,
        vocal: { voice: 'android', mode: 'sung', level: 1 },
      });
      const sungBoth = graph.sources.length;
      graph.sources.length = 0;
      graph.nodes.length = 0;
      // The voice is a part of its own: muting the melody keeps the words.
      engine.play({
        tempo: 120,
        melody,
        totalSteps: 16,
        loop: false,
        parts: {
          chords: true, melody: true, bass: true, drums: true, vocal: false,
        },
      });
      assert.ok(graph.sources.length < sungBoth, 'the singer went quiet');
      assert.ok(graph.sources.length > 0, 'the melody did not');
      engine.stop();
    });
  } finally {
    global.setTimeout = realSetTimeout;
    global.clearTimeout = realClearTimeout;
  }
});

test('a composed song deals the lyric out across its sections', async () => {
  const { composeSong } = await import('../src/music/compose.js');
  const lines = ['Ash and iron', 'Cold rain falling', 'The harbour burns', 'Salt on the wire'];
  const song = composeSong({
    settings: { seed: 'sung-song', minutes: 1.5, letters: 3 },
    tempo: 100,
    vocal: { on: true, lines, voice: 'tenor', mode: 'sung' },
  });
  const sung = song.sections.filter((s) => s.music.vocal?.on);
  assert.equal(sung.length, song.sections.length, 'every section got words');
  // Each idea starts somewhere else in the lyric, so the verse and the chorus
  // are not singing the same line.
  const openings = new Set(sung.map((s) => s.music.vocal.lines[0]));
  assert.ok(openings.size > 1, 'the sections all start on the same line');
  for (const section of sung) {
    assert.equal(section.music.vocal.lines.length, lines.length, 'each keeps the whole lyric to fall back on');
    assert.deepEqual([...section.music.vocal.lines].sort(), [...lines].sort());
    assert.equal(section.music.vocal.voice, 'tenor');
  }
  // Composed with the voice off, nothing sings.
  const silent = composeSong({ settings: { seed: 'sung-song', minutes: 1.5, letters: 3 }, tempo: 100 });
  assert.ok(silent.sections.every((s) => !s.music.vocal));
});
