// What you said, written down.
//
// This is the valuable file in the whole feature. Weights can be thrown away
// and refitted in ten seconds; an evening of you listening to pairs of sections
// and saying which ones worked cannot be got back. So the judgements are the
// thing that is stored, and the model is treated as a derived artefact — the
// way source is stored and a binary is built.
//
// A judgement does not contain any music. It contains the *seed the music came
// from*, because `dealRound` is deterministic: twelve characters is enough to
// put the exact same two sections back in front of you, note for note, a year
// from now. That is what keeps a thousand rounds of training data down to a
// couple of hundred kilobytes and, more usefully, what lets the featurizer
// change without invalidating a single opinion you ever gave.
//
// The format is JSON Lines: one record per line, append-only, no rewriting.
// Two people can add rounds on two machines and the merge is a concatenation.
//
// There are two kinds of record in the file, and the difference is where the
// music comes from.
//
//   a round   dealt by the Train tab. Stores a seed and nothing else, because
//             `dealRound` is deterministic and the seed *is* the music.
//   a mark    a thumb up or down on something you actually made — a section in
//             the drawer, a song on the shelf. There is no seed to point at, so
//             the record carries the music itself, trimmed to what the ear in
//             features.js looks at.
//
// A mark is a coarser opinion than a round, which is the point of it: rating a
// hand is twenty seconds of listening and five deliberate answers, whereas
// pressing 👍 on a chorus is one click made in passing. So a mark says how hard
// it should push, and it pushes less — see MARK_WEIGHTS. The intent is a nudge,
// not a vote that outweighs an evening at the table.

import { DEAL_VERSION } from '../music/compose.js';

/** The five buttons, and what they are worth to the model. */
export const RATINGS = [
  { value: 0, label: 'No', hint: 'Actively bad' },
  { value: 0.25, label: 'Meh', hint: 'Not really' },
  { value: 0.5, label: 'Fine', hint: 'Neither here nor there' },
  { value: 0.75, label: 'Good', hint: 'Yes, that works' },
  { value: 1, label: 'Love it', hint: 'Keep that' },
];

let counter = 0;

/**
 * @param {object} spec
 * @param {string} spec.seed the seed the round was dealt from
 * @param {number} spec.cards how many sections were on the table
 * @param {Record<string, Record<string, number>>} spec.sections name → head → 0..1
 * @param {Record<string, number>} [spec.joins] "A>B" → 0..1
 * @param {string} [spec.digest] a human-readable line, so the file can be read
 * @param {string} [spec.note] anything you wanted to say about it
 */
export function makeJudgement({
  seed, cards, sections = {}, joins = {}, digest = '', note = '',
}) {
  counter += 1;
  return {
    id: `j${Date.now().toString(36)}${counter.toString(36)}`,
    at: new Date().toISOString(),
    dealer: DEAL_VERSION,
    seed: String(seed),
    cards,
    sections: prune(sections),
    joins: prune(joins),
    ...(digest ? { digest } : {}),
    ...(note ? { note } : {}),
  };
}

/**
 * Drops anything unanswered. A question you skipped is not a zero and it is not
 * a 0.5 — it is silence, and the trainer has to be able to tell the difference
 * between "this melody is bad" and "I didn't say".
 */
function prune(record) {
  const out = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = clamp(value);
      continue;
    }
    const inner = {};
    for (const [head, rating] of Object.entries(value || {})) {
      if (Number.isFinite(rating)) inner[head] = clamp(rating);
    }
    if (Object.keys(inner).length) out[key] = inner;
  }
  return out;
}

function clamp(value) {
  return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000));
}

// --- marks ------------------------------------------------------------------

/**
 * How hard a thumb pushes, against a round rated at the table being 1.
 *
 * A section you marked is one opinion about one piece of music you were already
 * listening to, so it is worth a good deal but not everything. A song is worth
 * less *per section*: liking a song is not the same as liking each part of it,
 * and treating it that way would teach the model that every section of every
 * song you kept is a good section, which is exactly the mush it is here to
 * avoid. What a song mark really carries is the joins — the order worked — and
 * that is the half of it that survives at nearly full strength.
 *
 * One thing these numbers do *not* mean, and it is worth being exact about it:
 * the trainer divides each batch by the sum of its weights, so making every row
 * lighter changes nothing at all. A weight is only ever a ratio against the
 * other rows in the same file. Teach it entirely with thumbs and it learns
 * from them at full strength, which is right — they are everything you have
 * said. Mix them with rated hands and the hands lead, which is also right.
 */
export const MARK_WEIGHTS = { section: 0.6, song: 0.3, join: 0.5 };

/** What a thumb is worth as a rating, on the same 0..1 scale as the buttons. */
export const MARK_RATINGS = { good: 1, bad: 0 };

/**
 * Everything about a section the featurizer does not read, dropped.
 *
 * A mark has to carry its own music, and a section is a few kilobytes of it.
 * Most of that is the generator's working — the melody before you dragged it,
 * the deltas you dragged, the words on it — none of which the ear looks at, and
 * the words in particular have no business being copied into a file you may
 * commit. What is left is what a model would hear.
 */
export function trimForMark(section) {
  if (!section) return null;
  const {
    vocal, melodyBase, melodyEdits, ownChords, locked, ...music
  } = section.music || {};
  return {
    name: section.name,
    kind: section.kind,
    music,
    rhythm: section.rhythm || {},
    ...(section.meter ? { meter: section.meter } : {}),
    ...(Number.isFinite(section.dynamics) ? { dynamics: section.dynamics } : {}),
    ...(Number.isFinite(section.tempoScale) ? { tempoScale: section.tempoScale } : {}),
  };
}

/**
 * A stable name for a piece of music.
 *
 * Marks are identified by what they are about rather than by when they were
 * made, which does two useful things: changing your mind about a section
 * replaces your old opinion of it instead of arguing with it, and marking the
 * same chorus twice — once in the drawer, once off the library shelf — is one
 * opinion, not two. Roll the section again and it is different music with a
 * different name, so the mark you gave the take before it stays true of the
 * take before it.
 *
 * FNV-1a, twice, over the trimmed music. Not a cryptographic hash and does not
 * need to be: the worst a collision can do is merge two opinions.
 */
export function markDigest(sections = [], order = null) {
  const text = JSON.stringify([sections.map((section) => {
    const { name, ...rest } = trimForMark(section) || {};
    return rest;
  }), order || null]);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

/**
 * A thumb, up or down, on one section or on a whole running order.
 *
 * @param {object} spec
 * @param {object[]} spec.sections the distinct music it is about
 * @param {number[]} [spec.order] which of them is heard when, so a running order
 *   is stored as its shape rather than as five copies of the chorus. Defaults to
 *   each section once, in the order given.
 * @param {number} spec.rating 0..1 — 0 is a thumb down, 1 is a thumb up
 * @param {string} [spec.name] what it is called, for reading the file by eye
 * @param {string} [spec.digest] a human-readable line about it
 * @param {number} [spec.weight] how hard it pushes; defaults by what it is about
 */
export function makeMark({
  sections = [], order = null, rating = 1, name = '', digest = '', weight,
}) {
  const music = sections.map(trimForMark).filter(Boolean);
  const shape = normalizeOrder(order, music.length);
  const song = shape.length > 1;
  return {
    id: `mark:${markDigest(sections, order)}`,
    at: new Date().toISOString(),
    kind: 'mark',
    rating: clamp(rating),
    weight: Number.isFinite(weight)
      ? clamp(weight)
      : (song ? MARK_WEIGHTS.song : MARK_WEIGHTS.section),
    ...(name ? { name } : {}),
    ...(digest ? { digest } : {}),
    music,
    // Only worth writing down when it is not simply "each of these once".
    ...(isPlainOrder(shape) ? {} : { order: shape }),
  };
}

/** The running order as indices into `music`, with anything nonsensical dropped. */
export function normalizeOrder(order, length) {
  const list = (Array.isArray(order) ? order : [])
    .map((index) => Math.round(Number(index)))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < length);
  return list.length ? list : Array.from({ length }, (unused, index) => index);
}

function isPlainOrder(order) {
  return order.every((index, position) => index === position);
}

/** The seams in a mark: every distinct join, in the order they are first heard. */
export function markJoins(record) {
  const order = normalizeOrder(record?.order, (record?.music || []).length);
  const seen = new Set();
  const joins = [];
  for (let i = 1; i < order.length; i++) {
    const key = `${order[i - 1]}>${order[i]}`;
    // A section into itself is a repeat, not a join, and nobody has an opinion
    // about whether a chorus goes with a chorus.
    if (order[i - 1] === order[i] || seen.has(key)) continue;
    seen.add(key);
    joins.push([order[i - 1], order[i]]);
  }
  return joins;
}

export function isMark(record) {
  return record?.kind === 'mark' && Array.isArray(record.music) && record.music.length > 0;
}

/** How many actual opinions are in a record — a skipped round is worth nothing. */
export function answerCount(judgement) {
  // A mark is one opinion per section it covers, plus one per seam between two
  // of them: a song marked good says its parts worked *and* that the order did.
  if (isMark(judgement)) return judgement.music.length + markJoins(judgement).length;
  const sections = Object.values(judgement?.sections || {})
    .reduce((total, heads) => total + Object.keys(heads).length, 0);
  return sections + Object.keys(judgement?.joins || {}).length;
}

/** Whether a line off disk is a record the trainer could do anything with. */
export function isJudgement(record) {
  if (!record || typeof record !== 'object') return false;
  if (isMark(record)) return true;
  return Boolean(record.seed) && answerCount(record) > 0;
}

/** One record, one line. */
export function toLine(judgement) {
  return JSON.stringify(judgement);
}

/**
 * Reads a .jsonl file. Blank lines and `#` comments are allowed so the file can
 * be annotated by hand, and a corrupt line is skipped rather than fatal —
 * losing one round beats losing the session.
 *
 * @returns {{judgements: object[], skipped: number}}
 */
export function parseJudgements(text = '') {
  const judgements = [];
  let skipped = 0;
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const record = JSON.parse(line);
      if (isJudgement(record)) judgements.push(record);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { judgements, skipped };
}

export function serializeJudgements(judgements) {
  return judgements.map(toLine).join('\n') + (judgements.length ? '\n' : '');
}

/**
 * Last one wins, by id — so re-importing a file you have already got, or
 * merging two machines' worth, does not double-count anybody's opinion.
 */
export function mergeJudgements(...lists) {
  const byId = new Map();
  for (const list of lists) for (const record of list || []) byId.set(record.id || record.seed, record);
  return [...byId.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * The ones this build of the dealer can still put music behind. A judgement
 * from an older dealer is kept in the file — it is a record of what you thought
 * and it may become usable again — but it is not trained on, because the seed
 * no longer points at the bars you heard.
 */
export function usableJudgements(judgements) {
  // A mark carries its own music, so there is no dealer for it to be out of
  // step with: it is as usable in ten years as it was the day it was made.
  return judgements.filter((record) => isMark(record) || (record.dealer ?? 0) === DEAL_VERSION);
}

/** The marks in a list, by what they are about — for "have I already said?" */
export function marksByDigest(judgements = []) {
  const out = new Map();
  for (const record of judgements) if (isMark(record)) out.set(record.id, record);
  return out;
}
