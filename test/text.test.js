import test from 'node:test';
import assert from 'node:assert/strict';

import { makeRng, pickWeighted, shuffle } from '../src/rng.js';
import {
  assembleLines,
  buildPool,
  cutIntoStrips,
  foldIn,
  suggestTitles,
  toSentences,
  toWords,
  verbasize,
} from '../src/cutup.js';
import { generateLyrics } from '../src/lyrics.js';
import { rarityBand } from '../src/words.js';

const SAMPLE = `The harbour closed on Tuesday. Engineers replaced the sea gate.
Freight was diverted along the coast road. Nobody was injured at all.`;

test('rng is deterministic for a given seed', () => {
  const a = makeRng('ember');
  const b = makeRng('ember');
  const c = makeRng('other');
  const seqA = Array.from({ length: 8 }, a);
  assert.deepEqual(seqA, Array.from({ length: 8 }, b));
  assert.notDeepEqual(seqA, Array.from({ length: 8 }, c));
  assert.ok(seqA.every((n) => n >= 0 && n < 1));
});

test('shuffle keeps every element exactly once', () => {
  const input = Array.from({ length: 50 }, (_, i) => i);
  const out = shuffle(makeRng('x'), input);
  assert.equal(out.length, input.length);
  assert.deepEqual([...out].sort((p, q) => p - q), input);
  assert.notDeepEqual(out, input);
});

test('pickWeighted never returns a zero-weight option', () => {
  const rng = makeRng('weights');
  for (let i = 0; i < 200; i++) {
    const value = pickWeighted(rng, [
      { value: 'never', weight: 0 },
      { value: 'sometimes', weight: 1 },
      { value: 'often', weight: 9 },
    ]);
    assert.notEqual(value, 'never');
  }
});

test('toWords strips punctuation but keeps accents and apostrophes', () => {
  assert.deepEqual(toWords("Don't stop; the café—closed!"), ["Don't", 'stop', 'the', 'café', 'closed']);
  assert.deepEqual(toWords(''), []);
});

test('toSentences splits on terminators and keeps every word', () => {
  const sentences = toSentences('One two. Three four! Five? x');
  assert.deepEqual(sentences, ['One two.', 'Three four!', 'Five?', 'x']);
  assert.deepEqual(toSentences('  '), []);
});

test('cutting into strips keeps every source word, in order', () => {
  const strips = cutIntoStrips(SAMPLE, makeRng('scissors'), { min: 2, max: 4 });
  assert.ok(strips.length > 1);
  assert.deepEqual(strips.join(' ').split(' '), toWords(SAMPLE));
  for (const strip of strips) {
    assert.ok(strip.split(' ').length <= 4, `strip too long: ${strip}`);
  }
});

test('fold-in draws from both texts', () => {
  const lines = foldIn('alpha bravo charlie delta', 'one two three four', makeRng('fold'));
  assert.equal(lines.length, 1);
  const words = lines[0].split(' ');
  assert.ok(words.some((w) => ['alpha', 'bravo', 'charlie', 'delta'].includes(w)));
  assert.ok(words.some((w) => ['one', 'two', 'three', 'four'].includes(w)));
});

test('fold-in falls back to sentences when a text has no line breaks', () => {
  const lines = foldIn(
    'The harbour closed. Engineers replaced the gate. Freight was diverted.',
    'Salt eats the hinges. The wire hums. Nothing happens twice.',
    makeRng('paragraph'),
  );
  assert.equal(lines.length, 3, 'one line per sentence pair, not one line total');
  for (const line of lines) assert.ok(line.split(' ').length >= 2);
});

test('verbasizer only emits words present in the source', () => {
  const vocabulary = new Set(toWords(SAMPLE));
  const lines = verbasize(SAMPLE, makeRng('bowie'), { lines: 5, words: 6 });
  assert.equal(lines.length, 5);
  for (const line of lines) {
    assert.equal(line.split(' ').length, 6);
    for (const word of line.split(' ')) assert.ok(vocabulary.has(word), `${word} is not in the source`);
  }
});

test('buildPool honours source weights', () => {
  const pool = buildPool(
    [
      { items: ['a'], weight: 3 },
      { items: ['b'], weight: 1 },
      { items: ['c'], weight: 0 },
    ],
    makeRng('pool'),
    100,
  );
  const counts = pool.reduce((acc, item) => ({ ...acc, [item]: (acc[item] || 0) + 1 }), {});
  assert.ok(counts.a > counts.b, 'the heavier source should dominate');
  assert.equal(counts.c, undefined, 'a zero-weight source must be excluded');
});

test('assembleLines respects the requested line and word counts', () => {
  const pool = ['red wire', 'harbour', 'slow tide', 'glass'];
  const lines = assembleLines(pool, makeRng('assemble'), {
    lines: 6,
    minWords: 3,
    maxWords: 6,
    glue: 0,
    capitalize: true,
  });
  assert.equal(lines.length, 6);
  for (const line of lines) {
    const count = line.split(' ').length;
    assert.ok(count >= 3 && count <= 8, `unexpected line length ${count}: ${line}`);
    assert.match(line, /^[A-Z]/);
  }
});

test('title suggestions never start or end on a function word', () => {
  const titles = suggestTitles(['the salt of the harbour wire', 'a slow tide of glass'], makeRng('titles'), 5);
  assert.ok(titles.length > 0);
  for (const title of titles) {
    const words = title.toLowerCase().split(' ');
    assert.ok(!['the', 'a', 'of'].includes(words[0]));
    assert.ok(!['the', 'a', 'of'].includes(words[words.length - 1]));
  }
});

test('rarityBand slides through the dictionary', () => {
  const dict = Array.from({ length: 1000 }, (_, i) => `w${i}`);
  const common = rarityBand(dict, 0, 0.2);
  const rare = rarityBand(dict, 1, 0.2);
  assert.equal(common[0], 'w0');
  assert.equal(rare[rare.length - 1], 'w999');
  assert.equal(common.length, rare.length);
  assert.deepEqual(rarityBand([], 0.5), []);
});

test('generateLyrics is reproducible and keeps locked lines', () => {
  const options = {
    seed: 'tuesday',
    text: SAMPLE,
    lang: 'en',
    method: 'strips',
    lines: 5,
    dictionary: ['ember', 'filament', 'harbour'],
  };
  const first = generateLyrics(options);
  const second = generateLyrics(options);
  assert.deepEqual(first.lines, second.lines);
  assert.equal(first.lines.length, 5);

  const locked = generateLyrics({ ...options, seed: 'different', locked: [null, 'HELD LINE'] });
  assert.equal(locked.lines[1], 'HELD LINE');
  assert.notEqual(locked.lines[0], first.lines[0]);
});

test('generateLyrics still works with no pasted text', () => {
  const result = generateLyrics({
    seed: 'empty',
    text: '',
    lang: 'nl',
    lines: 4,
    dictionary: ['zeewier', 'kraan', 'roest'],
  });
  assert.equal(result.lines.length, 4);
  assert.ok(result.lines.every((line) => line.trim().length > 0));
});
