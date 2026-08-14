// The taste model: a small net that has been told what you think.
//
// It does not write music. It listens to music that has already been written
// and guesses how you would have rated it — which, given a generator that can
// produce a thousand candidates a second, turns out to be the more useful half
// of the job. Ask for a section, get eight, keep the one the model likes: that
// is how a few hundred opinions become a composer that sounds like you, without
// ever needing the millions of examples a generative model would want.
//
// The shape of it:
//
//        section features (83)                  section features (83)
//                 │                                      │
//            ┌────┴────┐  the same weights, twice   ┌────┴────┐
//            │  trunk  │ ◀──────── shared ────────▶ │  trunk  │
//            └────┬────┘                            └────┬───┘
//              embedding                              embedding
//         ┌────┬─┴──┬────┐                                │
//      overall mel harm rhy          ┌─────────────────────┴──────┐
//                                    │ [eA, eB, |eA−eB|, join(29)] │
//                                    └─────────────┬──────────────┘
//                                              do they go together
//
// One trunk, four opinions about a section and one about a join. The point of
// sharing is that every time you say "that melody is lovely" you also teach the
// half of the model that judges transitions, because both are looking through
// the same ears. With a training set this small that is not an optimisation, it
// is the difference between working and not.

import {
  Adam, bce, Linear, Sequential, sigmoid, Tanh, uniqueParams,
} from './net.js';
import { makeRng } from '../rng.js';
import {
  FEATURE_VERSION, pairFeatureNames, pairFeatures, sectionFeatureNames, sectionFeatures,
} from '../music/features.js';

/** The four things you are asked about a section, in the order the net says them. */
export const SECTION_HEADS = [
  { id: 'overall', label: 'As a whole', question: 'Is this a good section?' },
  { id: 'melody', label: 'The tune', question: 'Is the melody any good?' },
  { id: 'harmony', label: 'The chords', question: 'Do the chord changes work?' },
  { id: 'rhythm', label: 'The groove', question: 'Is the rhythm any good?' },
];

/** And the one you are asked about two of them. */
export const PAIR_HEAD = { id: 'fit', label: 'Together', question: 'Do these belong in the same song?' };

export function defaultArchitecture() {
  return {
    hidden: 12,
    embed: 5,
    pairHidden: 8,
  };
}

/**
 * Standardisation. Every feature is already roughly 0..1, but "roughly" is not
 * good enough: a column that is 0.98 in every section carries no information
 * and a column that swings from 0.1 to 0.9 carries a lot, and gradient descent
 * cannot tell the difference until they are on the same scale. The mean and
 * spread are measured once over the training set and shipped inside the model,
 * because a model standardised against data it can no longer see is a model
 * that scores nonsense.
 */
export function fitScaler(rows) {
  const dims = rows[0]?.length || 0;
  const mean = new Float64Array(dims);
  const std = new Float64Array(dims).fill(1);
  if (!rows.length) return { mean: [...mean], std: [...std] };
  for (const row of rows) for (let i = 0; i < dims; i++) mean[i] += row[i] / rows.length;
  for (let i = 0; i < dims; i++) {
    let sum = 0;
    for (const row of rows) sum += (row[i] - mean[i]) ** 2;
    // A column that never moves gets a spread of 1, which standardises it to a
    // flat zero rather than to infinity.
    std[i] = Math.max(0.05, Math.sqrt(sum / rows.length));
  }
  return { mean: [...mean], std: [...std] };
}

function standardise(values, scaler) {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = (values[i] - scaler.mean[i]) / scaler.std[i];
  return out;
}

/**
 * The model. Build it fresh with `new TasteModel()`, or bring one back from
 * disk with `TasteModel.fromJSON`.
 */
export class TasteModel {
  constructor({ seed = 'taste', arch = defaultArchitecture(), sectionScaler, pairScaler } = {}) {
    const rng = makeRng(`model:${seed}`);
    this.arch = { ...defaultArchitecture(), ...arch };
    this.sectionNames = sectionFeatureNames();
    this.pairNames = pairFeatureNames();
    this.featureVersion = FEATURE_VERSION;

    const dims = this.sectionNames.length;
    const { hidden, embed, pairHidden } = this.arch;

    this.trunk = new Sequential([
      new Linear(dims, hidden, rng), new Tanh(),
      new Linear(hidden, embed, rng), new Tanh(),
    ]);
    // The second set of ears for the second card. Same weights, own caches.
    this.trunkB = this.trunk.share();

    this.heads = {};
    for (const head of SECTION_HEADS) this.heads[head.id] = new Linear(embed, 1, rng);

    this.pair = new Sequential([
      new Linear(embed * 3 + this.pairNames.length, pairHidden, rng), new Tanh(),
      new Linear(pairHidden, 1, rng),
    ]);

    // Filled in by the trainer. An unfitted model standardises to a no-op,
    // which is harmless because an unfitted model is gated to zero anyway.
    this.sectionScaler = sectionScaler || {
      mean: new Array(dims).fill(0), std: new Array(dims).fill(1),
    };
    this.pairScaler = pairScaler || {
      mean: new Array(this.pairNames.length).fill(0), std: new Array(this.pairNames.length).fill(1),
    };

    this.report = emptyReport();
  }

  params() {
    return uniqueParams(
      this.trunk.params(),
      ...SECTION_HEADS.map((head) => this.heads[head.id].params()),
      this.pair.params(),
    );
  }

  optimizer(options) {
    return new Adam(this.params(), options);
  }

  // --- forward passes -------------------------------------------------------

  /** The embedding of a section: what the model heard, before it has an opinion. */
  embed(values, { second = false } = {}) {
    const trunk = second ? this.trunkB : this.trunk;
    return trunk.forward(standardise(values, this.sectionScaler));
  }

  /** Raw logits for the four section questions, given an embedding. */
  headLogits(embedding) {
    const out = {};
    for (const head of SECTION_HEADS) out[head.id] = this.heads[head.id].forward(embedding)[0];
    return out;
  }

  /** The join, given both embeddings and the features of the seam between them. */
  pairLogit(embA, embB, pairValues) {
    const scaled = standardise(pairValues, this.pairScaler);
    const input = new Float64Array(embA.length * 3 + scaled.length);
    input.set(embA, 0);
    input.set(embB, embA.length);
    for (let i = 0; i < embA.length; i++) input[embA.length * 2 + i] = Math.abs(embA[i] - embB[i]);
    input.set(scaled, embA.length * 3);
    return this.pair.forward(input)[0];
  }

  // --- what everything else calls -------------------------------------------

  /**
   * What the model thinks of one section: four numbers in 0..1, where 0.5 is
   * "no opinion".
   *
   * @param {object} section
   * @returns {{overall:number, melody:number, harmony:number, rhythm:number}}
   */
  scoreSection(section) {
    const logits = this.headLogits(this.embed(sectionFeatures(section).values));
    const out = {};
    for (const head of SECTION_HEADS) out[head.id] = sigmoid(logits[head.id]);
    return out;
  }

  /**
   * What it thinks of the join from `a` into `b`. Not symmetric, and should not
   * be: a verse into a chorus is a different move from a chorus into a verse.
   */
  scorePair(a, b) {
    const embA = this.embed(sectionFeatures(a).values);
    const embB = this.embed(sectionFeatures(b).values, { second: true });
    return sigmoid(this.pairLogit(embA, embB, pairFeatures(a, b).values));
  }

  /**
   * One number for a whole running order: how much it thinks you would like it.
   *
   * The sections carry it and the joins temper it — a song of five good
   * sections that do not belong together is not a good song, but nor is a
   * flawless set of transitions between five dull ideas. Two parts sections,
   * one part joins.
   *
   * @param {object[]} sections in the order they are heard
   */
  scoreSong(sections = []) {
    if (!sections.length) return 0.5;
    const parts = sections.map((section) => this.scoreSection(section).overall);
    const joins = [];
    for (let i = 1; i < sections.length; i++) joins.push(this.scorePair(sections[i - 1], sections[i]));
    const avg = (list) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0.5);
    return avg(parts) * (2 / 3) + avg(joins) * (1 / 3);
  }

  /**
   * How much anyone downstream should listen to it, 0..1.
   *
   * This is the honest bit. A model fitted to nine judgements will happily
   * return confident-looking numbers, and they will be noise. So the gate is
   * not "how many opinions do I have", it is "how well did I predict the
   * opinions I was not shown" — held-out ranking accuracy, measured against the
   * 50% a coin would get. A model that cannot beat the coin is worth nothing
   * and is weighted at nothing, and the composer carries on as it always did.
   */
  get confidence() {
    const accuracy = this.report?.holdout?.ranking;
    if (!Number.isFinite(accuracy)) return 0;
    const edge = (accuracy - 0.5) * 2;
    // A handful of examples can beat the coin by luck, so the count tempers it
    // until there is enough data for the accuracy to mean anything.
    const enough = Math.min(1, (this.report?.judgements || 0) / 120);
    return Math.max(0, Math.min(1, edge * 1.6)) * enough;
  }

  /** True when the featurizer has moved on and this model is measuring columns that no longer exist. */
  get stale() {
    const names = sectionFeatureNames();
    return this.featureVersion !== FEATURE_VERSION
      || this.sectionNames.length !== names.length
      || this.sectionNames.some((name, i) => name !== names[i]);
  }

  // --- storage --------------------------------------------------------------

  toJSON() {
    return {
      kind: 'cut-up.taste',
      version: 1,
      featureVersion: this.featureVersion,
      arch: this.arch,
      sectionNames: this.sectionNames,
      pairNames: this.pairNames,
      sectionScaler: {
        mean: this.sectionScaler.mean.map(round), std: this.sectionScaler.std.map(round),
      },
      pairScaler: {
        mean: this.pairScaler.mean.map(round), std: this.pairScaler.std.map(round),
      },
      trunk: this.trunk.layers.map((layer) => (layer.toJSON ? layer.toJSON() : null)),
      heads: Object.fromEntries(SECTION_HEADS.map((head) => [head.id, this.heads[head.id].toJSON()])),
      pair: this.pair.layers.map((layer) => (layer.toJSON ? layer.toJSON() : null)),
      report: this.report,
    };
  }

  static fromJSON(json) {
    if (!json || json.kind !== 'cut-up.taste') throw new Error('not a taste model');
    const model = Object.create(TasteModel.prototype);
    model.arch = { ...defaultArchitecture(), ...(json.arch || {}) };
    model.sectionNames = json.sectionNames || [];
    model.pairNames = json.pairNames || [];
    model.featureVersion = json.featureVersion ?? 0;
    model.sectionScaler = json.sectionScaler;
    model.pairScaler = json.pairScaler;
    const rebuild = (list) => new Sequential(
      list.map((entry) => (entry ? Linear.fromJSON(entry) : new Tanh())),
    );
    model.trunk = rebuild(json.trunk);
    model.trunkB = model.trunk.share();
    model.heads = {};
    for (const head of SECTION_HEADS) {
      model.heads[head.id] = Linear.fromJSON(json.heads[head.id]);
    }
    model.pair = rebuild(json.pair);
    model.report = json.report || emptyReport();
    return model;
  }
}

export function emptyReport() {
  return {
    judgements: 0,
    trainedAt: null,
    epochs: 0,
    holdout: { ranking: null, error: null, perHead: {} },
  };
}

function round(value) {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The model a fresh checkout has: no opinions, no confidence, no effect. Every
 * caller can then treat "no model yet" and "a model that has not earned its
 * keep" as the same case, which is the only way the composer stays sane on day
 * one.
 */
export function neutralModel() {
  return new TasteModel({ seed: 'neutral' });
}
