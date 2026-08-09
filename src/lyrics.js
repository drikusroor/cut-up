// Ties the cut-up primitives together into one "give me a verse" call.

import { makeRng, shuffle } from './rng.js';
import {
  assembleLines,
  buildPool,
  cutIntoStrips,
  foldIn,
  suggestTitles,
  toWords,
  verbasize,
} from './cutup.js';
import { IMAGERY, rarityBand } from './words.js';

export const METHODS = [
  { id: 'strips', label: 'Paper strips', hint: 'Cut the source into short strips and shuffle them.' },
  { id: 'words', label: 'Loose words', hint: 'Cut all the way down to single words.' },
  { id: 'verbasizer', label: 'Verbasizer', hint: 'Stack the sentences and read across the columns.' },
  { id: 'foldin', label: 'Fold-in', hint: 'Fold two texts together and read across the seam.' },
];

/**
 * @typedef {object} LyricsOptions
 * @property {string} [text] pasted source text
 * @property {string} [secondText] second source, used by fold-in
 * @property {string[]} [dictionary] frequency-ordered word list
 * @property {'en'|'nl'} [lang]
 * @property {string} [method] one of METHODS
 * @property {number} [lines]
 * @property {number} [minWords]
 * @property {number} [maxWords]
 * @property {number} [stripMin]
 * @property {number} [stripMax]
 * @property {number} [textWeight] 0..1 pull towards the pasted text
 * @property {number} [dictWeight] 0..1 pull towards the dictionary
 * @property {number} [imageryWeight] 0..1 pull towards the imagery bank
 * @property {number} [rarity] 0..1 position in the dictionary's frequency band
 * @property {number} [glue] 0..1 chance of connective words between atoms
 * @property {boolean} [capitalize]
 * @property {string[]} [locked] lines to keep verbatim, by index position
 */

/**
 * Generates a block of lines plus a few title suggestions.
 * @param {LyricsOptions & {seed: string}} opts
 */
export function generateLyrics(opts) {
  const {
    seed = 'cut-up',
    text = '',
    secondText = '',
    dictionary = [],
    lang = 'en',
    method = 'strips',
    lines = 8,
    minWords = 4,
    maxWords = 8,
    stripMin = 2,
    stripMax = 4,
    textWeight = 1,
    dictWeight = 0.25,
    imageryWeight = 0.35,
    rarity = 0.2,
    glue = 0.25,
    capitalize = true,
    locked = [],
  } = opts || {};

  const rng = makeRng(seed);
  const hasText = toWords(text).length > 2;

  let generated;
  if (method === 'verbasizer' && hasText) {
    generated = verbasize(text, rng, { lines, words: maxWords });
    if (capitalize) generated = generated.map(sentenceCase);
  } else if (method === 'foldin' && hasText && toWords(secondText).length > 2) {
    generated = shuffle(rng, foldIn(text, secondText, rng)).slice(0, lines);
    if (capitalize) generated = generated.map(sentenceCase);
  } else {
    const textAtoms = hasText
      ? method === 'words'
        ? toWords(text)
        : cutIntoStrips(text, rng, { min: stripMin, max: stripMax })
      : [];
    const dictAtoms = rarityBand(dictionary, rarity);
    const imageryAtoms = IMAGERY[lang] || IMAGERY.en;

    const pool = buildPool(
      [
        { items: textAtoms, weight: hasText ? textWeight : 0 },
        { items: dictAtoms, weight: dictWeight },
        { items: imageryAtoms, weight: imageryWeight },
      ],
      rng,
      Math.max(64, lines * maxWords * 2),
    );

    generated = assembleLines(pool, rng, {
      lines,
      minWords,
      maxWords,
      glue,
      lang,
      capitalize,
    });
  }

  // Locked lines survive a reroll, holding their original position.
  const out = [];
  for (let i = 0; i < lines; i++) {
    const held = locked[i];
    out.push(held != null && held !== '' ? held : (generated[i] ?? ''));
  }

  const filled = out.filter(Boolean);
  return {
    seed,
    lines: filled,
    titles: suggestTitles(filled, rng, 3),
  };
}

function sentenceCase(line) {
  return line ? line[0].toUpperCase() + line.slice(1) : line;
}
