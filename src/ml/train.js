// Fitting the model, and — more importantly — refusing to believe it.
//
// Training a net on a few hundred opinions is easy. Training one that has
// actually learned something, rather than memorised the evenings you were in a
// good mood, is the hard part, and almost all of the code below is about
// telling the two apart.
//
// The method:
//
//   1. Every round is re-dealt from its seed, so the features are always
//      computed by today's featurizer rather than read from a stale cache.
//   2. The rounds are split into folds. A round goes into a fold whole — its
//      sections and its join together — because scoring a transition whose two
//      sections the model was trained on is not a held-out test of anything.
//   3. Each fold trains from scratch and is measured on the rounds it never
//      saw. What is measured is *ranking*: given two things you rated
//      differently, does the model put them in the right order? That is the
//      only thing the composer actually asks of it, and it has an honest
//      baseline — a coin gets 50%.
//   4. The folds also say when to stop. Whatever epoch they were best at, on
//      average, is the epoch the final model — fitted to everything — trains to.
//   5. The cross-validated ranking accuracy is written into the model, and the
//      composer weights the model's advice by how far above the coin it got. A
//      model that has learned nothing is therefore harmless, which matters
//      rather a lot on the day you have rated nine rounds and want to see what
//      happens.

import { bce, sigmoid } from './net.js';
import {
  emptyReport, fitScaler, PAIR_HEAD, SECTION_HEADS, TasteModel,
} from './model.js';
import { pairFeatures, sectionFeatures } from '../music/features.js';
import { dealRound } from '../music/compose.js';
import {
  isMark, MARK_WEIGHTS, markJoins, usableJudgements,
} from './judgements.js';
import { makeRng, shuffle } from '../rng.js';

export function defaultTrainOptions() {
  return {
    seed: 'taste',
    folds: 4,
    maxEpochs: 320,
    evalEvery: 8,
    patience: 6,
    rate: 0.03,
    decay: 0.02,
    minRounds: 8,
  };
}

/**
 * Turns judgements into rows the net can eat.
 *
 * The expensive half of training, and the reason it is worth doing once: every
 * round is re-dealt and re-featurized here, and everything after this point is
 * arithmetic on numbers.
 *
 * @param {object[]} judgements
 * @param {(fraction:number, note:string) => void} [onProgress]
 */
export function buildDataset(judgements, onProgress) {
  const usable = usableJudgements(judgements);
  const rounds = [];
  let skipped = 0;
  let marks = 0;

  usable.forEach((record, index) => {
    onProgress?.(index / Math.max(1, usable.length), 'listening back');
    // A mark brought its own music with it, so there is nothing to deal: it is
    // featurized where it stands and joins the pile at whatever weight it says.
    if (isMark(record)) {
      const round = markRound(record);
      if (round) {
        rounds.push(round);
        marks += 1;
      } else skipped += 1;
      return;
    }
    let hand;
    try {
      hand = dealRound({ seed: record.seed, cards: record.cards || 2 });
    } catch {
      skipped += 1;
      return;
    }
    const byName = new Map(hand.cards.map((card) => [card.name, card.section]));
    const features = new Map();
    const featuresFor = (name) => {
      if (!features.has(name)) features.set(name, sectionFeatures(byName.get(name)).values);
      return features.get(name);
    };

    const sections = [];
    for (const [name, heads] of Object.entries(record.sections || {})) {
      if (!byName.has(name)) continue;
      const targets = {};
      for (const head of SECTION_HEADS) {
        if (Number.isFinite(heads[head.id])) targets[head.id] = heads[head.id];
      }
      if (Object.keys(targets).length) sections.push({ name, values: featuresFor(name), targets });
    }

    const pairs = [];
    for (const [join, rating] of Object.entries(record.joins || {})) {
      const [from, to] = join.split('>');
      if (!byName.has(from) || !byName.has(to) || !Number.isFinite(rating)) continue;
      pairs.push({
        join,
        a: featuresFor(from),
        b: featuresFor(to),
        values: pairFeatures(byName.get(from), byName.get(to)).values,
        target: rating,
      });
    }

    if (sections.length || pairs.length) rounds.push({ id: record.id, sections, pairs });
  });

  onProgress?.(1, 'listening back');
  return {
    rounds, marks, skipped, dropped: judgements.length - usable.length,
  };
}

/**
 * A thumb, turned into rows.
 *
 * Only the overall head is taught. A thumb up on a chorus says the chorus
 * works; it does not say which of the tune, the changes and the groove made it
 * work, and guessing on your behalf would put three opinions you never gave
 * into the file. The joins are taught too when the mark covers a running order,
 * because that — this went into that and it was right — is most of what liking
 * a whole song actually means.
 */
function markRound(record) {
  const music = record.music || [];
  const rating = record.rating;
  if (!music.length || !Number.isFinite(rating)) return null;
  const weight = Number.isFinite(record.weight) ? record.weight : MARK_WEIGHTS.section;
  // A song mark is worth less about its parts than about its seams — see
  // MARK_WEIGHTS — so the joins keep more of it than the sections do.
  const joinWeight = music.length > 1 ? Math.max(weight, MARK_WEIGHTS.join) : weight;

  const values = music.map((section) => sectionFeatures(section).values);
  const sections = music.map((section, index) => ({
    name: section.name || `#${index + 1}`,
    values: values[index],
    targets: { overall: rating },
    weight,
  }));
  const pairs = markJoins(record).map(([from, to]) => ({
    join: `${sections[from].name}>${sections[to].name}`,
    a: values[from],
    b: values[to],
    values: pairFeatures(music[from], music[to]).values,
    target: rating,
    weight: joinWeight,
  }));
  return { id: record.id, mark: true, sections, pairs };
}

/** Every section row in a set of rounds, for fitting the scaler. */
function sectionRows(rounds) {
  const rows = [];
  for (const round of rounds) {
    for (const item of round.sections) rows.push(item.values);
    for (const item of round.pairs) rows.push(item.a, item.b);
  }
  return rows;
}

function pairRows(rounds) {
  return rounds.flatMap((round) => round.pairs.map((item) => item.values));
}

/**
 * One pass over the training rounds: forward, backward, step.
 *
 * Full batch rather than minibatch, because the whole dataset fits in a few
 * hundred rows and a full-batch gradient is both faster here and exactly
 * reproducible, which is worth more than the noise a minibatch would add.
 */
function epoch(model, rounds, optimizer) {
  optimizer.zeroGrad();
  let loss = 0;
  let count = 0;

  for (const round of rounds) {
    for (const item of round.sections) {
      // How hard this row is allowed to push. A rated round is a 1; a thumb
      // pressed in passing is a fraction of one, and arrives here as a smaller
      // gradient and a smaller share of the batch — which is exactly what
      // "nudge it a bit in that direction" means in arithmetic.
      const weight = Number.isFinite(item.weight) ? item.weight : 1;
      const embedding = model.embed(item.values);
      const logits = model.headLogits(embedding);
      const gradEmb = new Float64Array(embedding.length);
      for (const head of SECTION_HEADS) {
        const target = item.targets[head.id];
        if (!Number.isFinite(target)) continue;
        const { loss: l, grad } = bce(logits[head.id], target);
        loss += l * weight;
        count += weight;
        const back = model.heads[head.id].backward(Float64Array.from([grad * weight]));
        for (let i = 0; i < gradEmb.length; i++) gradEmb[i] += back[i];
      }
      model.trunk.backward(gradEmb);
    }

    for (const item of round.pairs) {
      const weight = Number.isFinite(item.weight) ? item.weight : 1;
      const embA = model.embed(item.a);
      const embB = model.embed(item.b, { second: true });
      const logit = model.pairLogit(embA, embB, item.values);
      const { loss: l, grad } = bce(logit, item.target);
      loss += l * weight;
      count += weight;

      const back = model.pair.backward(Float64Array.from([grad * weight]));
      const size = embA.length;
      const gradA = new Float64Array(size);
      const gradB = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        // The third block of the pair input is |eA − eB|, whose derivative is
        // the sign of the difference — pushing the two embeddings apart or
        // together depending on which way the join wanted to go.
        const sign = Math.sign(embA[i] - embB[i]);
        gradA[i] = back[i] + sign * back[size * 2 + i];
        gradB[i] = back[size + i] - sign * back[size * 2 + i];
      }
      model.trunk.backward(gradA);
      model.trunkB.backward(gradB);
    }
  }

  if (count) optimizer.apply(count);
  return count ? loss / count : 0;
}

/** Predictions for a set of rounds, grouped by which question they answer. */
function predict(model, rounds) {
  const byHead = new Map();
  const push = (head, predicted, target) => {
    if (!byHead.has(head)) byHead.set(head, []);
    byHead.get(head).push({ predicted, target });
  };

  for (const round of rounds) {
    for (const item of round.sections) {
      const logits = model.headLogits(model.embed(item.values));
      for (const head of SECTION_HEADS) {
        if (Number.isFinite(item.targets[head.id])) push(head.id, sigmoid(logits[head.id]), item.targets[head.id]);
      }
    }
    for (const item of round.pairs) {
      const embA = model.embed(item.a);
      const embB = model.embed(item.b, { second: true });
      push(PAIR_HEAD.id, sigmoid(model.pairLogit(embA, embB, item.values)), item.target);
    }
  }
  return byHead;
}

/**
 * The metric that matters: of every two things you rated differently, how often
 * does the model agree about which one you liked more?
 *
 * Not accuracy against a threshold, because the composer never asks "is this
 * good"; it asks "is this one better than that one", eight times, and keeps the
 * winner. And unlike an error figure, this one has a meaning you can argue
 * with: 0.5 is a coin, 1.0 is telepathy, and 0.62 is a model that is right
 * slightly more often than not — which, applied to eight candidates, is still
 * worth having.
 */
export function rankingAccuracy(samples) {
  let right = 0;
  let comparable = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i];
      const b = samples[j];
      if (a.target === b.target) continue;
      comparable += 1;
      const order = (a.target - b.target) * (a.predicted - b.predicted);
      if (order > 0) right += 1;
      else if (order === 0) right += 0.5;
    }
  }
  return comparable ? { accuracy: right / comparable, comparable } : { accuracy: null, comparable: 0 };
}

function meanError(samples) {
  if (!samples.length) return null;
  return samples.reduce((total, s) => total + Math.abs(s.predicted - s.target), 0) / samples.length;
}

/** Loss on a set of rounds, for early stopping. Same arithmetic, no gradients. */
function validationLoss(model, rounds) {
  let total = 0;
  let count = 0;
  for (const [, samples] of predict(model, rounds)) {
    for (const { predicted, target } of samples) {
      const p = Math.min(1 - 1e-7, Math.max(1e-7, predicted));
      total += -(target * Math.log(p) + (1 - target) * Math.log(1 - p));
      count += 1;
    }
  }
  return count ? total / count : Infinity;
}

/**
 * Trains one model on `train`, stopping when `validate` says it has stopped
 * improving. When there is nothing to validate against — the final fit, over
 * everything — it simply runs for the number of epochs it was told.
 */
function fitOnce(model, train, validate, options) {
  const optimizer = model.optimizer({ rate: options.rate, decay: options.decay });
  let best = { loss: Infinity, epoch: 0, weights: null };
  let since = 0;

  for (let step = 1; step <= options.maxEpochs; step++) {
    epoch(model, train, optimizer);
    if (!validate?.length) continue;
    if (step % options.evalEvery && step !== options.maxEpochs) continue;
    const loss = validationLoss(model, validate);
    if (loss < best.loss - 1e-5) {
      best = { loss, epoch: step, weights: snapshot(model) };
      since = 0;
    } else if (++since >= options.patience) break;
  }

  if (validate?.length && best.weights) restore(model, best.weights);
  return best;
}

function snapshot(model) {
  return model.params().map((param) => Float64Array.from(param.value));
}

function restore(model, weights) {
  model.params().forEach((param, index) => param.value.set(weights[index]));
}

/**
 * The whole business: judgements in, a fitted model and an honest report out.
 *
 * @param {object[]} judgements
 * @param {object} [options] see defaultTrainOptions
 * @param {(fraction:number, note:string) => void} [onProgress]
 * @returns {{model: TasteModel, report: object, dataset: object}}
 */
export function trainTaste(judgements = [], options = {}, onProgress) {
  const opts = { ...defaultTrainOptions(), ...options };
  const dataset = buildDataset(judgements, (f, note) => onProgress?.(f * 0.25, note));

  const report = emptyReport();
  report.judgements = dataset.rounds.length;
  report.marks = dataset.marks;
  report.dropped = dataset.dropped;
  report.answers = dataset.rounds.reduce(
    (total, round) => total + round.sections.reduce((n, s) => n + Object.keys(s.targets).length, 0)
      + round.pairs.length,
    0,
  );
  report.trainedAt = new Date().toISOString();

  // Nothing to learn from yet. A model is still returned — untrained, gated to
  // zero — so every caller downstream has one object to deal with rather than
  // a null to remember about.
  if (dataset.rounds.length < opts.minRounds) {
    const model = new TasteModel({ seed: opts.seed });
    report.note = `needs at least ${opts.minRounds} before it is worth fitting.`;
    model.report = report;
    onProgress?.(1, 'not enough yet');
    return { model, report, dataset };
  }

  // The scalers are fitted on everything. Standardisation is not a parameter
  // the model learns, so there is no leakage worth the complication of fitting
  // one per fold.
  const sectionScaler = fitScaler(sectionRows(dataset.rounds));
  const pairScaler = fitScaler(pairRows(dataset.rounds));

  // Folds are drawn over *rounds*, so a section and the join it took part in
  // never end up on opposite sides of the split.
  const rng = makeRng(`folds:${opts.seed}`);
  const shuffled = shuffle(rng, dataset.rounds);
  const folds = Math.max(2, Math.min(opts.folds, Math.floor(shuffled.length / 3)));
  const assigned = shuffled.map((round, index) => ({ round, fold: index % folds }));

  const heldOut = new Map();
  const epochs = [];

  for (let fold = 0; fold < folds; fold++) {
    onProgress?.(0.25 + (fold / folds) * 0.6, `fold ${fold + 1} of ${folds}`);
    const train = assigned.filter((item) => item.fold !== fold).map((item) => item.round);
    const validate = assigned.filter((item) => item.fold === fold).map((item) => item.round);
    if (!train.length || !validate.length) continue;

    const model = new TasteModel({ seed: `${opts.seed}:${fold}`, sectionScaler, pairScaler });
    const best = fitOnce(model, train, validate, opts);
    epochs.push(best.epoch || opts.maxEpochs);

    for (const [head, samples] of predict(model, validate)) {
      if (!heldOut.has(head)) heldOut.set(head, []);
      heldOut.get(head).push(...samples);
    }
  }

  // What it managed on music it had never been played.
  //
  // Measured question by question and then averaged, rather than by throwing
  // every prediction into one pile. Pooling would let the model score points
  // for knowing that a melody rating and a rhythm rating differ, which is not
  // a question anybody asked it and not one the composer will ever ask; every
  // comparison that counts here is between two answers to the *same* question.
  const perHead = Object.fromEntries([...heldOut].map(([head, samples]) => {
    const { accuracy, comparable } = rankingAccuracy(samples);
    return [head, { ranking: accuracy, comparable, error: meanError(samples), n: samples.length }];
  }));
  const scored = Object.values(perHead).filter((entry) => Number.isFinite(entry.ranking));
  const all = [...heldOut.values()].flat();
  report.holdout = {
    ranking: scored.length ? scored.reduce((total, e) => total + e.ranking, 0) / scored.length : null,
    comparable: scored.reduce((total, e) => total + e.comparable, 0),
    error: meanError(all),
    perHead,
  };

  // And now the one that gets shipped: everything, for as long as the folds
  // said was long enough.
  const stopAt = epochs.length
    ? Math.max(opts.evalEvery, Math.round(epochs.reduce((a, b) => a + b, 0) / epochs.length))
    : opts.maxEpochs;
  onProgress?.(0.9, 'fitting the final model');
  const model = new TasteModel({ seed: opts.seed, sectionScaler, pairScaler });
  fitOnce(model, dataset.rounds, null, { ...opts, maxEpochs: stopAt });

  report.epochs = stopAt;
  report.folds = folds;
  model.report = report;
  onProgress?.(1, 'done');

  // What gets committed is rounded to six places, so the model that reports
  // these numbers is made to be the model that will actually run: it is
  // written out and read back before it leaves here, and any difference the
  // rounding makes has already happened by the time anyone scores anything.
  const shipped = TasteModel.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));
  return { model: shipped, report, dataset };
}

/**
 * A one-line summary of whether the thing is any good, in words rather than
 * decimals — because "0.58" tells you nothing unless you already knew that 0.5
 * was the floor.
 */
export function describeReport(report) {
  const count = report?.judgements || 0;
  if (!count) return 'Never trained — no judgements have been fitted yet.';
  const marked = report?.marks || 0;
  const dealt = count - marked;
  // Marks and rounds are both opinions but they are not the same size of
  // opinion, so the line says which it is made of rather than adding them up
  // and letting you assume an evening at the table.
  const rounds = marked
    ? `${dealt} ${dealt === 1 ? 'round' : 'rounds'} and ${marked} ${marked === 1 ? 'mark' : 'marks'}`
    : `${count} ${count === 1 ? 'round' : 'rounds'}`;
  const ranking = report?.holdout?.ranking;
  if (report?.note) return `${rounds} — ${report.note}`;
  if (!Number.isFinite(ranking)) {
    return `${rounds} — not enough disagreement in them to test the model against.`;
  }
  const percent = `${Math.round(ranking * 100)}%`;
  if (ranking < 0.55) return `${rounds} — it agrees with you ${percent} of the time, which is a coin. Keep going.`;
  if (ranking < 0.62) return `${rounds} — ${percent} agreement on music it hadn't heard. Faintly better than chance.`;
  if (ranking < 0.72) return `${rounds} — ${percent} agreement on held-out music. It has picked up something real.`;
  return `${rounds} — ${percent} agreement on held-out music. It knows what you like.`;
}
