// The cut-up engine: turn source text into a pile of paper strips, then
// reassemble the strips into lines.
//
// Everything here is pure and seed-driven so the UI can reroll deterministically
// and the unit tests can assert on real output.

import { chance, pick, randInt, shuffle } from './rng.js';

const WORD_RE = /[\p{L}\p{M}'’-]+/gu;

/** Splits text into bare lowercase-preserving words, punctuation stripped. */
export function toWords(text) {
  if (!text) return [];
  return (text.match(WORD_RE) || [])
    .map((w) => w.replace(/^['’-]+|['’-]+$/g, ''))
    .filter((w) => w.length > 0);
}

/**
 * Splits text into sentences. Single-word sentences are kept — the strip
 * cutter works through these, and dropping any would lose source material.
 */
export function toSentences(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.!?…])\s+|\n{2,}/u)
    .map((s) => s.trim())
    .filter((s) => toWords(s).length > 0);
}

/** Splits text into non-empty lines. */
export function toLines(text) {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Cuts text into strips of consecutive words — the literal scissors pass.
 * @param {string} text
 * @param {() => number} rng
 * @param {{min?: number, max?: number}} [opts]
 * @returns {string[]} strips, in source order
 */
export function cutIntoStrips(text, rng, opts = {}) {
  const min = Math.max(1, opts.min ?? 2);
  const max = Math.max(min, opts.max ?? 4);
  const strips = [];
  // Cut sentence by sentence so a strip never straddles a full stop.
  const sentences = toSentences(text);
  for (const sentence of sentences.length ? sentences : [text]) {
    const words = toWords(sentence);
    let i = 0;
    while (i < words.length) {
      const size = randInt(rng, min, max);
      const strip = words.slice(i, i + size);
      if (strip.length) strips.push(strip.join(' '));
      i += size;
    }
  }
  return strips;
}

/**
 * Gysin's fold-in: lay two texts on top of each other and read across the seam.
 * Line n of the result is the head of A's line n plus the tail of B's line n.
 */
export function foldIn(textA, textB, rng) {
  const a = foldRows(textA);
  const b = foldRows(textB);
  if (!a.length || !b.length) return [];
  const out = [];
  const count = Math.max(a.length, b.length);
  for (let i = 0; i < count; i++) {
    const left = a[i % a.length];
    const right = b[i % b.length];
    const cutL = randInt(rng, 1, Math.max(1, left.length - 1));
    const cutR = randInt(rng, 0, Math.max(0, right.length - 1));
    const line = [...left.slice(0, cutL), ...right.slice(cutR)];
    if (line.length) out.push(line.join(' '));
  }
  return out;
}

/**
 * Rows to fold. Pasted prose usually arrives as one long paragraph, which
 * would fold into a single line, so fall back to sentences when there aren't
 * enough line breaks to work with.
 */
function foldRows(text) {
  const lines = toLines(text).map(toWords).filter((w) => w.length);
  if (lines.length > 1) return lines;
  return toSentences(text).map(toWords).filter((w) => w.length);
}

/**
 * Bowie's Verbasizer, roughly: stack the source sentences in a grid and read
 * each output line across a different random row per column. Keeps a ghost of
 * the original grammar while scrambling the content.
 */
export function verbasize(text, rng, { lines = 8, words = 6 } = {}) {
  const grid = toSentences(text)
    .map(toWords)
    .filter((s) => s.length >= 2);
  if (grid.length < 2) return [];
  const out = [];
  for (let i = 0; i < lines; i++) {
    const line = [];
    for (let col = 0; col < words; col++) {
      const row = pick(rng, grid);
      line.push(row[col % row.length]);
    }
    out.push(line.join(' '));
  }
  return out;
}

/**
 * Builds a pool of atoms (single words or multi-word strips) out of every
 * source the user switched on, weighted so one source can dominate.
 *
 * @param {Array<{items: string[], weight: number}>} sources
 * @param {() => number} rng
 * @param {number} size how many atoms to draw
 */
export function buildPool(sources, rng, size) {
  const live = sources.filter((s) => s.items.length > 0 && s.weight > 0);
  if (!live.length) return [];
  const total = live.reduce((sum, s) => sum + s.weight, 0);
  const pool = [];
  for (const source of live) {
    const share = Math.max(1, Math.round((source.weight / total) * size));
    const bag = shuffle(rng, source.items);
    for (let i = 0; i < share; i++) {
      // Reshuffle when we exhaust a small source rather than repeating in order.
      pool.push(bag[i % bag.length]);
    }
  }
  return shuffle(rng, pool);
}

/** Connective tissue, so lines read like language instead of a word salad. */
export const GLUE = {
  en: ['the', 'a', 'and', 'of', 'in', 'on', 'with', 'like', 'through', 'under', 'my', 'your', 'all', 'no'],
  nl: ['de', 'het', 'een', 'en', 'van', 'in', 'op', 'met', 'als', 'door', 'onder', 'mijn', 'jouw', 'geen'],
};

const TITLE_STOP = new Set([...GLUE.en, ...GLUE.nl]);

/**
 * Assembles pool atoms into lines.
 *
 * @param {string[]} pool
 * @param {() => number} rng
 * @param {object} opts
 * @param {number} opts.lines
 * @param {number} opts.minWords
 * @param {number} opts.maxWords
 * @param {number} [opts.glue] 0..1 chance of dropping a connective between atoms
 * @param {'en'|'nl'} [opts.lang]
 * @param {boolean} [opts.capitalize]
 * @returns {string[]}
 */
export function assembleLines(pool, rng, opts) {
  const {
    lines = 8,
    minWords = 4,
    maxWords = 8,
    glue = 0.25,
    lang = 'en',
    capitalize = true,
  } = opts || {};
  if (!pool.length) return [];

  const glueWords = GLUE[lang] || GLUE.en;
  const out = [];
  let cursor = 0;

  for (let i = 0; i < lines; i++) {
    const target = randInt(rng, minWords, Math.max(minWords, maxWords));
    const parts = [];
    let count = 0;
    let guard = 0;
    while (count < target && guard++ < 64) {
      const atom = pool[cursor++ % pool.length];
      if (!atom) break;
      if (parts.length && chance(rng, glue)) parts.push(pick(rng, glueWords));
      parts.push(atom);
      count += atom.split(' ').length;
    }
    let line = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (capitalize && line) line = line[0].toUpperCase() + line.slice(1);
    if (line) out.push(line);
  }
  return out;
}

/**
 * Suggests titles from the generated lines — short, punchy fragments.
 * @param {string[]} lines
 * @param {() => number} rng
 * @param {number} [count]
 */
export function suggestTitles(lines, rng, count = 3) {
  const candidates = [];
  for (const line of lines) {
    const words = toWords(line);
    for (let size = 2; size <= 4; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        const slice = words.slice(i, i + size);
        // A title that opens or closes on "the" or "of" reads like an accident.
        if (TITLE_STOP.has(slice[0].toLowerCase())) continue;
        if (TITLE_STOP.has(slice[slice.length - 1].toLowerCase())) continue;
        candidates.push(slice.map(titleCase).join(' '));
      }
    }
  }
  if (!candidates.length) return [];
  const unique = [...new Set(candidates)];
  return shuffle(rng, unique).slice(0, count);
}

function titleCase(word) {
  return word[0].toUpperCase() + word.slice(1);
}
