// Where the model and the opinions live, from the browser's point of view.
//
// The app is a static page, and a static page cannot write to the repository it
// was served from. So there are two modes and the difference between them is a
// single probe at boot:
//
//   npm run taste   a small local server is listening, every answer is appended
//                   to data/taste.jsonl the moment you give it, and "Train the
//                   model" rewrites models/taste.json. Your session is a git
//                   diff. This is the mode the whole feature is designed for.
//
//   npm start,      no server. Judgements are kept in the browser, training
//   GitHub Pages    happens in the tab, and the export button hands you a
//                   .jsonl to drop into data/ yourself. Nothing is lost, but
//                   nothing is saved for you either.
//
// Either way the committed files are the source of truth at boot: the model is
// read from models/taste.json and the judgements already in data/taste.jsonl
// are counted, so a fresh clone opens with everything you have ever taught it.

import { TasteModel, neutralModel } from './model.js';
import {
  makeJudgement, mergeJudgements, parseJudgements, serializeJudgements,
} from './judgements.js';
import { trainTaste } from './train.js';

export const MODEL_URL = 'models/taste.json';
export const JUDGEMENTS_URL = 'data/taste.jsonl';

/** Judgements made in a browser that had nowhere to put them. */
const PENDING_KEY = 'cut-up:taste-pending:v1';

/**
 * Reads the committed model.
 *
 * A model whose feature columns no longer match what features.js produces is
 * refused rather than scored against the wrong numbers — the whole point of
 * shipping the column names inside the file. Refusing means falling back to a
 * neutral model, which is gated to zero, which means the composer carries on
 * exactly as it would have with no model at all. Retraining fixes it.
 */
export async function loadModel() {
  try {
    const response = await fetch(MODEL_URL, { cache: 'no-store' });
    if (!response.ok) return { model: neutralModel(), status: 'none' };
    const model = TasteModel.fromJSON(await response.json());
    if (model.stale) return { model: neutralModel(), status: 'stale' };
    return { model, status: 'ok' };
  } catch {
    return { model: neutralModel(), status: 'none' };
  }
}

/** Is there a local server behind us, or are we read-only? */
export async function probeRecorder() {
  try {
    const response = await fetch('api/status', { cache: 'no-store' });
    if (!response.ok) return { recording: false };
    const info = await response.json();
    return { recording: Boolean(info?.recording), judgements: info?.judgements || 0 };
  } catch {
    return { recording: false };
  }
}

function readPending() {
  try {
    return parseJudgements(localStorage.getItem(PENDING_KEY) || '').judgements;
  } catch {
    return [];
  }
}

function writePending(judgements) {
  try {
    localStorage.setItem(PENDING_KEY, serializeJudgements(judgements));
  } catch {
    // Quota or private mode. The round is still in memory for this session.
  }
}

/** Everything on disk, plus everything this browser has not managed to save. */
export async function loadJudgements() {
  let committed = [];
  try {
    const response = await fetch(JUDGEMENTS_URL, { cache: 'no-store' });
    if (response.ok) committed = parseJudgements(await response.text()).judgements;
  } catch {
    committed = [];
  }
  return { committed, pending: readPending(), all: mergeJudgements(committed, readPending()) };
}

/**
 * The store the Train tab talks to. Holds the current model, the running list
 * of judgements, and the one fact that changes how everything behaves — whether
 * there is anywhere to write.
 */
export class TasteStore {
  constructor() {
    this.model = neutralModel();
    this.status = 'none';
    this.recording = false;
    this.committed = [];
    this.pending = [];
    this.ready = false;
  }

  get judgements() {
    return mergeJudgements(this.committed, this.pending);
  }

  get count() {
    return this.judgements.length;
  }

  async load() {
    const [model, recorder, judgements] = await Promise.all([
      loadModel(), probeRecorder(), loadJudgements(),
    ]);
    this.model = model.model;
    this.status = model.status;
    this.recording = recorder.recording;
    this.committed = judgements.committed;
    // With a server running, anything stranded in this browser from a previous
    // read-only session is pushed through on the way past, so switching from
    // `npm start` to `npm run taste` does not quietly lose an evening.
    this.pending = judgements.pending;
    if (this.recording && this.pending.length) await this.flushPending();
    this.ready = true;
    return this;
  }

  async flushPending() {
    const stranded = [...this.pending];
    const stuck = [];
    // One at a time and in order: the file is appended to, and two of these in
    // flight at once would interleave.
    for (const record of stranded) {
      if (!await this.post(record)) stuck.push(record);
    }
    this.pending = stuck;
    writePending(stuck);
    if (stranded.length !== stuck.length) {
      this.committed = mergeJudgements(this.committed, stranded.filter((r) => !stuck.includes(r)));
    }
    return stranded.length - stuck.length;
  }

  async post(record) {
    try {
      const response = await fetch('api/judgements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(record),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Writes down what you just said. Returns where it went, because the Train
   * tab says so out loud — you should never be in doubt about whether the last
   * twenty minutes are on disk.
   *
   * @returns {Promise<'saved'|'browser'>}
   */
  async record(spec) {
    const record = makeJudgement(spec);
    if (this.recording && await this.post(record)) {
      this.committed = [...this.committed, record];
      return 'saved';
    }
    this.pending = [...this.pending, record];
    writePending(this.pending);
    return 'browser';
  }

  /** Throws away the last thing you said, wherever it went. */
  undo() {
    if (this.pending.length) {
      this.pending = this.pending.slice(0, -1);
      writePending(this.pending);
      return true;
    }
    return false;
  }

  /**
   * Fits a new model. With a server, on the server, and the result is written
   * to models/taste.json ready to commit. Without one, right here in the tab —
   * same code, same numbers, but the weights only live until you export them.
   */
  async train(onProgress) {
    if (this.recording) {
      const response = await fetch('api/train', { method: 'POST' });
      if (response.ok) {
        const result = await response.json();
        this.model = TasteModel.fromJSON(result.model);
        this.status = 'ok';
        return { report: result.report, written: true };
      }
    }
    const { model, report } = trainTaste(this.judgements, {}, onProgress);
    this.model = model;
    this.status = 'ok';
    return { report, written: false };
  }

  /** The whole file, for the download button. */
  exportText() {
    return serializeJudgements(this.judgements);
  }

  /** Merges a file you dropped in — same rule as everywhere, last id wins. */
  async importText(text) {
    const { judgements } = parseJudgements(text);
    const known = new Set(this.judgements.map((record) => record.id));
    const fresh = judgements.filter((record) => !known.has(record.id));
    if (!fresh.length) return 0;
    if (this.recording) {
      for (const record of fresh) {
        await this.post(record);
      }
      this.committed = mergeJudgements(this.committed, fresh);
    } else {
      this.pending = mergeJudgements(this.pending, fresh);
      writePending(this.pending);
    }
    return fresh.length;
  }
}
