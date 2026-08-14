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

/** How many actual opinions are in a record — a skipped round is worth nothing. */
export function answerCount(judgement) {
  const sections = Object.values(judgement?.sections || {})
    .reduce((total, heads) => total + Object.keys(heads).length, 0);
  return sections + Object.keys(judgement?.joins || {}).length;
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
      if (record?.seed && answerCount(record)) judgements.push(record);
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
  return judgements.filter((record) => (record.dealer ?? 0) === DEAL_VERSION);
}
