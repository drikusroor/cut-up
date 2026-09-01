import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURE_VERSION, pairFeatureNames, pairFeatures, sectionFeatureNames, sectionFeatures,
} from '../src/music/features.js';
import {
  Adam, bce, Linear, Sequential, sigmoid, Tanh, uniqueParams,
} from '../src/ml/net.js';
import {
  fitScaler, neutralModel, PAIR_HEAD, SECTION_HEADS, TasteModel,
} from '../src/ml/model.js';
import {
  answerCount, isJudgement, isMark, makeJudgement, makeMark, MARK_WEIGHTS, markDigest,
  markJoins, mergeJudgements, parseJudgements, serializeJudgements, trimForMark,
  usableJudgements,
} from '../src/ml/judgements.js';
import {
  buildDataset, describeReport, rankingAccuracy, trainTaste,
} from '../src/ml/train.js';
import { composeSong, dealRound, DEAL_VERSION } from '../src/music/compose.js';
import { generateRhythm } from '../src/music/rhythm.js';
import { makeRng } from '../src/rng.js';

/** A feature by name, so a test says what it means rather than which column. */
function feature(section, name) {
  const { names, values } = sectionFeatures(section);
  const index = names.indexOf(name);
  assert.notEqual(index, -1, `no such feature: ${name}`);
  return values[index];
}

function pairFeature(a, b, name) {
  const { names, values } = pairFeatures(a, b);
  const index = names.indexOf(name);
  assert.notEqual(index, -1, `no such pair feature: ${name}`);
  return values[index];
}

const hand = (seed, cards = 2) => dealRound({ seed, cards });

// --- the ear ----------------------------------------------------------------

test('every section measures to the same fixed row of numbers', () => {
  const names = sectionFeatureNames();
  assert.ok(names.length > 40, 'a section is described by more than a handful of numbers');
  assert.equal(new Set(names).size, names.length, 'no two columns share a name');

  for (const seed of ['a', 'b', 'c']) {
    for (const card of hand(seed, 3).cards) {
      const { names: got, values } = sectionFeatures(card.section);
      assert.deepEqual(got, names, 'the columns never move');
      assert.equal(values.length, names.length);
    }
  }
});

test('nothing a section can be makes a feature NaN or an outlier', () => {
  const cards = ['x', 'y', 'z', 'w'].flatMap((seed) => hand(seed, 3).cards);
  // Plus the degenerate ones the featurizer has to survive: nothing at all, and
  // a section stripped of every part in turn.
  const stripped = [
    null,
    {},
    { music: {}, rhythm: {} },
    { ...cards[0].section, music: { ...cards[0].section.music, melody: [], chords: [] } },
    { ...cards[0].section, rhythm: { ...cards[0].section.rhythm, pattern: { tracks: [] } } },
  ];
  for (const section of [...cards.map((card) => card.section), ...stripped]) {
    const { names, values } = sectionFeatures(section);
    values.forEach((value, index) => {
      assert.ok(Number.isFinite(value), `${names[index]} is not a number`);
      assert.ok(value >= 0 && value <= 1, `${names[index]} is ${value}, outside 0..1`);
    });
  }
});

test('the numbers mean what they are called', () => {
  const grid = { meter: { beats: 4, unit: 4 }, steps: 16, bars: 1 };
  const backbeat = {
    meter: grid.meter,
    music: {},
    rhythm: {
      pattern: generateRhythm({
        rng: makeRng('backbeat'), ...grid, style: 'backbeat', density: 0.5, variation: 0,
        trackIds: ['kick', 'snare', 'hat'],
      }),
      trackIds: ['kick', 'snare', 'hat'],
    },
  };
  assert.ok(feature(backbeat, 'rhy.onTheTwoAndFour') > 0.9, 'a backbeat puts the snare on two and four');
  assert.ok(feature(backbeat, 'rhy.present') === 1);

  // A tune that walks up a scale is stepwise; one built of sevenths is not.
  const tune = (intervals) => ({
    meter: grid.meter,
    music: {
      rootPc: 0,
      scaleId: 'major',
      stepsPerChord: 16,
      melody: intervals.map((midi, i) => ({ midi, step: i * 2, length: 2, velocity: 90 })),
    },
    rhythm: {},
  });
  const steps = tune([60, 62, 64, 65, 67, 69, 71, 72]);
  const leaps = tune([60, 70, 59, 71, 58, 72, 57, 73]);
  assert.ok(feature(steps, 'mel.stepwise') > 0.9, 'a scale is stepwise');
  assert.equal(feature(steps, 'mel.leaps'), 0, 'and has no leaps in it');
  assert.ok(feature(leaps, 'mel.leaps') > 0.9, 'sevenths are leaps');
  assert.ok(feature(leaps, 'mel.maxLeap') > feature(steps, 'mel.maxLeap'));
  assert.equal(feature(steps, 'mel.endsHome'), 1, 'it lands on the tonic');
});

test('a join is measured on the seam, not on the two halves', () => {
  const names = pairFeatureNames();
  assert.equal(new Set(names).size, names.length);

  const inKey = (rootPc, scaleId) => ({
    meter: { beats: 4, unit: 4 },
    music: {
      rootPc, scaleId, stepsPerChord: 16, chords: [], melody: [],
    },
    rhythm: {},
  });
  // C to G is one step round the circle of fifths; C to F# is as far as it goes.
  assert.ok(
    pairFeature(inKey(0, 'major'), inKey(7, 'major'), 'to.fifthsDistance')
    < pairFeature(inKey(0, 'major'), inKey(6, 'major'), 'to.fifthsDistance'),
    'a fifth is nearer than a tritone, whatever the semitones say',
  );
  assert.equal(pairFeature(inKey(0, 'major'), inKey(0, 'major'), 'to.sameKey'), 1);
  assert.equal(pairFeature(inKey(0, 'major'), inKey(1, 'major'), 'to.upSemitone'), 1);
  assert.equal(pairFeature(inKey(0, 'major'), inKey(9, 'minor'), 'to.relative'), 1);
  assert.equal(pairFeature(inKey(0, 'major'), inKey(0, 'minor'), 'to.modeFlip'), 1);

  // A section against itself is the smallest possible distance.
  const card = hand('join').cards[0].section;
  assert.ok(pairFeature(card, card, 'to.distance') < 0.01);
});

// --- the arithmetic ---------------------------------------------------------

test('the backward pass is wired the right way round', () => {
  // XOR is the smallest problem a linear model cannot do, so a net that learns
  // it has a working hidden layer and a working chain rule.
  const rng = makeRng('xor');
  const net = new Sequential([new Linear(2, 8, rng), new Tanh(), new Linear(8, 1, rng)]);
  const optimizer = new Adam(net.params(), { rate: 0.08 });
  const data = [[[0, 0], 0], [[0, 1], 1], [[1, 0], 1], [[1, 1], 0]];

  for (let step = 0; step < 600; step++) {
    optimizer.zeroGrad();
    for (const [x, y] of data) {
      const out = net.forward(Float64Array.from(x));
      net.backward(Float64Array.from([bce(out[0], y).grad]));
    }
    optimizer.apply(data.length);
  }
  for (const [x, y] of data) {
    const p = sigmoid(net.forward(Float64Array.from(x))[0]);
    assert.ok(Math.abs(p - y) < 0.1, `XOR${JSON.stringify(x)} came out ${p.toFixed(3)}, wanted ${y}`);
  }
});

test('a shared layer is one layer with two memories', () => {
  const rng = makeRng('share');
  const layer = new Linear(3, 2, rng);
  const twin = layer.share();
  assert.equal(uniqueParams(layer.params(), twin.params()).length, 2, 'the weights are counted once');

  // Both remember their own input, and both push into the same gradient.
  layer.forward(Float64Array.from([1, 0, 0]));
  twin.forward(Float64Array.from([0, 0, 1]));
  layer.backward(Float64Array.from([1, 0]));
  twin.backward(Float64Array.from([1, 0]));
  assert.equal(layer.b.grad[0], 2, 'both passes accumulate');
  assert.ok(layer.w.grad[0] === 1 && layer.w.grad[2] === 1, 'and each against its own input');
});

test('a model survives the round trip to disk', () => {
  const model = new TasteModel();
  const card = hand('trip').cards[0].section;
  const other = hand('trip', 2).cards[1].section;
  const back = TasteModel.fromJSON(JSON.parse(JSON.stringify(model.toJSON())));

  const before = model.scoreSection(card);
  const after = back.scoreSection(card);
  for (const head of SECTION_HEADS) {
    assert.ok(Math.abs(before[head.id] - after[head.id]) < 1e-4, `${head.id} survived`);
  }
  assert.ok(Math.abs(model.scorePair(card, other) - back.scorePair(card, other)) < 1e-4);
  assert.equal(back.stale, false);
  assert.equal(back.featureVersion, FEATURE_VERSION);
});

test('a model fitted against columns that no longer exist knows it is stale', () => {
  const json = new TasteModel().toJSON();
  json.sectionNames = [...json.sectionNames.slice(0, -1), 'harm.somethingWeRenamed'];
  assert.equal(TasteModel.fromJSON(json).stale, true);
  json.featureVersion = FEATURE_VERSION + 1;
  assert.equal(TasteModel.fromJSON(json).stale, true);
});

test('a model that has been told nothing has no confidence', () => {
  assert.equal(neutralModel().confidence, 0);
  const model = new TasteModel();
  model.report = { judgements: 500, holdout: { ranking: 0.5 } };
  assert.equal(model.confidence, 0, 'a coin is worth nothing');
  model.report = { judgements: 500, holdout: { ranking: 0.42 } };
  assert.equal(model.confidence, 0, 'and worse than a coin is not worth less than nothing');
  model.report = { judgements: 500, holdout: { ranking: 0.9 } };
  assert.ok(model.confidence > 0.8, 'a model that is usually right gets a say');
  model.report = { judgements: 12, holdout: { ranking: 0.9 } };
  assert.ok(model.confidence < 0.2, 'twelve rounds of luck do not');
});

test('standardising a column that never moves does not divide by zero', () => {
  const scaler = fitScaler([[1, 0.5], [1, 0.9], [1, 0.1]]);
  assert.equal(scaler.mean[0], 1);
  assert.ok(scaler.std[0] >= 0.05 && Number.isFinite(scaler.std[0]));
});

// --- what you said ----------------------------------------------------------

test('a judgement records the seed, not the music', () => {
  const record = makeJudgement({
    seed: 'abc',
    cards: 2,
    sections: { A: { overall: 1, melody: 0.5 }, B: {} },
    joins: { 'A>B': 0.25 },
    digest: 'C major',
  });
  assert.equal(record.seed, 'abc');
  assert.equal(record.dealer, DEAL_VERSION);
  assert.ok(!JSON.stringify(record).includes('midi'), 'no notes are stored');
  assert.ok(JSON.stringify(record).length < 400, 'a round costs a couple of hundred bytes');
  assert.equal(record.sections.B, undefined, 'a card you said nothing about is not in the file');
  assert.equal(answerCount(record), 3);
});

test('a question you skipped is silence, not a zero', () => {
  const record = makeJudgement({
    seed: 's', cards: 2, sections: { A: { overall: 0, melody: null, harmony: undefined } },
  });
  assert.deepEqual(record.sections.A, { overall: 0 });
  assert.equal(answerCount(record), 1);
});

test('the file reads back, comments and damage included', () => {
  const records = [
    makeJudgement({ seed: 'one', cards: 2, sections: { A: { overall: 1 } } }),
    makeJudgement({ seed: 'two', cards: 2, sections: { A: { overall: 0 } } }),
  ];
  const text = `# a note to self\n\n${serializeJudgements(records)}{ this is not json\n`;
  const { judgements, skipped } = parseJudgements(text);
  assert.equal(judgements.length, 2);
  assert.equal(skipped, 1, 'the broken line is skipped, not fatal');
  assert.deepEqual(judgements.map((r) => r.seed), ['one', 'two']);
});

test('merging two machines does not double-count an opinion', () => {
  const a = makeJudgement({ seed: 'x', cards: 2, sections: { A: { overall: 1 } } });
  const b = makeJudgement({ seed: 'y', cards: 2, sections: { A: { overall: 0 } } });
  assert.equal(mergeJudgements([a, b], [a]).length, 2);
  assert.equal(mergeJudgements([a], [b], [a, b]).length, 2);
});

test('a judgement from a dealer that no longer exists is kept but not trained on', () => {
  const current = makeJudgement({ seed: 'now', cards: 2, sections: { A: { overall: 1 } } });
  const old = { ...makeJudgement({ seed: 'then', cards: 2, sections: { A: { overall: 1 } } }), dealer: 0 };
  assert.equal(usableJudgements([current, old]).length, 1);
});

// --- the deck ---------------------------------------------------------------

test('the same seed deals the same hand', () => {
  const strip = (round) => JSON.stringify(round)
    .replace(/"id":"[^"]+"/g, '').replace(/"savedAt":\d+/g, '');
  assert.equal(strip(hand('same')), strip(hand('same')));
  assert.notEqual(strip(hand('same')), strip(hand('different')));
});

test('a hand is two or three ordinary sections', () => {
  for (const cards of [2, 3]) {
    const round = hand(`deal${cards}`, cards);
    assert.equal(round.cards.length, cards);
    assert.equal(round.dealer, DEAL_VERSION);
    for (const card of round.cards) {
      assert.ok(card.section.id && card.section.name && card.section.music);
      assert.ok(card.section.music.melody.length || card.section.music.chords.length === 0);
    }
    assert.equal(round.cards[0].relation, 'home');
  }
  // Clamped, not trusted.
  assert.equal(hand('clamp', 9).cards.length, 3);
  assert.equal(hand('clamp', 1).cards.length, 2);
});

test('the deck covers the range rather than the middle of it', () => {
  const relations = new Set();
  const keys = new Set();
  for (let i = 0; i < 60; i++) {
    const round = hand(`cover${i}`, 3);
    for (const card of round.cards) relations.add(card.relation);
    keys.add(round.key);
  }
  for (const wanted of ['contrast', 'bridge', 'variant', 'stranger']) {
    assert.ok(relations.has(wanted), `the trainer never deals a ${wanted}`);
  }
  assert.ok(keys.size > 8, 'and it does not always deal in the same key');
});

// --- learning ---------------------------------------------------------------

test('ranking accuracy is 0.5 for a coin and 1 for perfect agreement', () => {
  const perfect = [{ predicted: 0.1, target: 0 }, { predicted: 0.9, target: 1 }];
  assert.equal(rankingAccuracy(perfect).accuracy, 1);
  const backwards = [{ predicted: 0.9, target: 0 }, { predicted: 0.1, target: 1 }];
  assert.equal(rankingAccuracy(backwards).accuracy, 0);
  const flat = [{ predicted: 0.5, target: 0 }, { predicted: 0.5, target: 1 }];
  assert.equal(rankingAccuracy(flat).accuracy, 0.5, 'no opinion is a coin');
  assert.equal(rankingAccuracy([{ predicted: 0.2, target: 1 }, { predicted: 0.8, target: 1 }]).accuracy, null,
    'two answers that agree cannot test anything');
});

/**
 * An imaginary songwriter with opinions we can check against: likes a motif and
 * a backbeat, dislikes wide leaps and a syncopated kit. If the trainer can find
 * that in a few dozen rounds, it can find a real one in a few hundred.
 */
function simulate(count, { random = false, seed = 'sim' } = {}) {
  const rng = makeRng(seed);
  const bucket = (value) => Math.max(0, Math.min(1, Math.round(value * 4) / 4));
  const judgements = [];
  for (let i = 0; i < count; i++) {
    const key = `${seed}${i}`;
    const round = hand(key, rng() < 0.3 ? 3 : 2);
    const sections = {};
    const joins = {};
    for (const card of round.cards) {
      const g = (name) => feature(card.section, name);
      const melody = random ? rng() : 0.5 + 0.9 * g('mel.motif') - 0.9 * g('mel.leaps');
      const rhythm = random ? rng() : 0.25 + 0.9 * g('rhy.onTheTwoAndFour') - 0.7 * g('rhy.syncopation');
      const harmony = random ? rng() : 0.3 + 0.8 * g('harm.motion.fourth') - 0.6 * g('harm.borrowed');
      sections[card.name] = {
        melody: bucket(melody), rhythm: bucket(rhythm), harmony: bucket(harmony),
        overall: bucket((melody + rhythm + harmony) / 3),
      };
    }
    for (let c = 1; c < round.cards.length; c++) {
      const from = round.cards[c - 1].section;
      const to = round.cards[c].section;
      const fit = random ? rng()
        : 0.7 - 0.8 * pairFeature(from, to, 'to.fifthsDistance');
      joins[`${round.cards[c - 1].name}>${round.cards[c].name}`] = bucket(fit);
    }
    judgements.push(makeJudgement({
      seed: key, cards: round.cards.length, sections, joins,
    }));
  }
  return judgements;
}

test('a round is turned back into music without storing any', () => {
  const judgements = simulate(6);
  const { rounds, skipped, dropped } = buildDataset(judgements);
  assert.equal(rounds.length, 6);
  assert.equal(skipped, 0);
  assert.equal(dropped, 0);
  const dims = sectionFeatureNames().length;
  for (const round of rounds) {
    for (const item of round.sections) assert.equal(item.values.length, dims);
    for (const item of round.pairs) assert.equal(item.values.length, pairFeatureNames().length);
  }
});

test('it learns an opinion it is shown consistently', () => {
  const { model, report } = trainTaste(simulate(70), { maxEpochs: 200 });
  assert.ok(report.holdout.ranking > 0.65,
    `only ${report.holdout.ranking?.toFixed(3)} agreement on held-out rounds`);
  assert.ok(model.confidence > 0.3, 'and it is allowed a say');
  // Every question was asked, so every question should have been learned.
  for (const head of [...SECTION_HEADS, PAIR_HEAD]) {
    assert.ok(report.holdout.perHead[head.id], `nothing measured for ${head.label}`);
  }
  assert.match(describeReport(report), /agreement/);
});

test('it does not learn an opinion that was never there', () => {
  // The honest half. Ratings made at random must produce a model that scores
  // like a coin and is therefore weighted at nothing — a model that claimed
  // otherwise would quietly steer the composer with noise.
  const { model, report } = trainTaste(simulate(70, { random: true, seed: 'noise' }), { maxEpochs: 200 });
  assert.ok(Math.abs(report.holdout.ranking - 0.5) < 0.12,
    `random answers scored ${report.holdout.ranking?.toFixed(3)}, which is suspiciously not a coin`);
  assert.ok(model.confidence < 0.35, `a coin was given ${model.confidence.toFixed(2)} say`);
});

test('too few rounds to say anything, and it says so', () => {
  const { model, report } = trainTaste(simulate(3));
  assert.equal(model.confidence, 0);
  assert.equal(report.holdout.ranking, null);
  assert.match(describeReport(report), /at least/);
});

// --- composing with it ------------------------------------------------------

test('without a model the composer is exactly what it always was', () => {
  const settings = { seed: 'unchanged', minutes: 2 };
  const plain = composeSong({ settings, rootPc: 9, scaleId: 'minor', tempo: 96 });
  for (const taste of [null, undefined, {}]) {
    const again = composeSong({
      settings, rootPc: 9, scaleId: 'minor', tempo: 96, taste,
    });
    assert.equal(again.summary, plain.summary);
    assert.deepEqual(
      again.sections.map((s) => s.music.chords.map((c) => c.roman)),
      plain.sections.map((s) => s.music.chords.map((c) => c.roman)),
    );
    assert.equal(again.taste, null);
  }
});

test('a model that has not earned a say does not get one', () => {
  const settings = { seed: 'gated', minutes: 2 };
  const plain = composeSong({ settings, rootPc: 9, scaleId: 'minor', tempo: 96 });
  const gated = composeSong({
    settings, rootPc: 9, scaleId: 'minor', tempo: 96, taste: neutralModel(),
  });
  assert.equal(gated.summary, plain.summary, 'an unfitted model changes nothing');
  assert.equal(gated.taste, null);

  // Nor does a good model turned all the way down.
  const { model } = trainTaste(simulate(40), { maxEpochs: 120 });
  const off = composeSong({
    settings, rootPc: 9, scaleId: 'minor', tempo: 96, taste: model, tasteStrength: 0,
  });
  assert.equal(off.summary, plain.summary);
});

test('with a model it auditions, and still writes the same song from the same seed', () => {
  const { model } = trainTaste(simulate(40), { maxEpochs: 120 });
  const options = {
    settings: { seed: 'steered', minutes: 2 },
    rootPc: 9,
    scaleId: 'minor',
    tempo: 96,
    taste: model,
    tasteStrength: 1,
  };
  const a = composeSong(options);
  const b = composeSong(options);
  assert.equal(a.summary, b.summary, 'a model does not make the composer random');
  assert.deepEqual(
    a.sections.map((s) => s.music.chords.map((c) => c.roman)),
    b.sections.map((s) => s.music.chords.map((c) => c.roman)),
  );
  assert.ok(a.taste, 'and it says that it had a say');
  assert.ok(a.taste.auditioned >= 2, 'every idea was picked out of a handful');
  assert.ok(a.taste.scores.length >= 1);
  for (const entry of a.taste.scores) {
    assert.ok(entry.score >= 0 && entry.score <= 1);
    assert.ok(entry.rank >= 1 && entry.rank <= a.taste.auditioned);
  }
  // And what comes out is still an ordinary, playable song.
  const ids = new Set(a.sections.map((section) => section.id));
  for (const item of a.arrangement) assert.ok(ids.has(item.sectionId));
});

// --- the thumbs -------------------------------------------------------------

/** Whatever the composer wrote from this seed, as ordinary sections. */
function songSections(seed = 'marks', minutes = 1.5) {
  return composeSong({ settings: { seed, minutes } }).sections;
}

test('a mark carries the music, because there is no seed to point at', () => {
  const [section] = songSections();
  const mark = makeMark({ sections: [section], rating: 1, name: section.name });

  assert.ok(isMark(mark));
  assert.ok(isJudgement(mark));
  assert.equal(mark.rating, 1);
  assert.equal(mark.weight, MARK_WEIGHTS.section);
  assert.equal(mark.music.length, 1);
  // Enough of it for the ear to work on...
  assert.deepEqual(mark.music[0].music.chords, section.music.chords);
  assert.deepEqual(mark.music[0].rhythm.pattern, section.rhythm.pattern);
  assert.equal(sectionFeatures(mark.music[0]).values.length, sectionFeatureNames().length);
  // ...and none of what it never looks at, the words above all.
  assert.equal(mark.music[0].music.vocal, undefined);
  assert.equal(mark.music[0].music.melodyBase, undefined);
  assert.equal(mark.music[0].music.melodyEdits, undefined);
});

test('a mark is named by the music, so changing your mind replaces it', () => {
  const [section] = songSections();
  const up = makeMark({ sections: [section], rating: 1 });
  const down = makeMark({ sections: [section], rating: 0 });
  assert.equal(up.id, down.id, 'the same music is the same opinion to overwrite');

  // Last one in wins, which is what merging is for.
  const merged = mergeJudgements([up], [down]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].rating, 0);

  // Different music is a different opinion, and the name it is filed under is
  // not part of the music.
  const other = songSections('elsewhere')[0];
  assert.notEqual(markDigest([section]), markDigest([other]));
  assert.equal(markDigest([section]), markDigest([{ ...section, name: 'Something else' }]));
});

test('a song mark stores its shape rather than five copies of the chorus', () => {
  const sections = songSections().slice(0, 3);
  const mark = makeMark({ sections, order: [0, 1, 0, 1, 2, 1], rating: 1 });
  assert.equal(mark.music.length, 3);
  assert.deepEqual(mark.order, [0, 1, 0, 1, 2, 1]);
  assert.equal(mark.weight, MARK_WEIGHTS.song, 'a whole song says less about each part');
  // Every distinct seam, once. A section into itself is a repeat, not a join.
  assert.deepEqual(markJoins(mark), [[0, 1], [1, 0], [1, 2], [2, 1]]);
  assert.equal(answerCount(mark), 3 + 4);

  // One section is one opinion and no seams at all.
  const single = makeMark({ sections: [sections[0]], rating: 0 });
  assert.equal(single.order, undefined);
  assert.deepEqual(markJoins(single), []);
  assert.equal(answerCount(single), 1);
});

test('marks survive the file, and outlive the dealer', () => {
  const sections = songSections().slice(0, 2);
  const records = [
    makeJudgement({ seed: 'abc', cards: 2, sections: { A: { overall: 1 } } }),
    makeMark({ sections: [sections[0]], rating: 1, name: 'A' }),
    makeMark({ sections, order: [0, 1, 0], rating: 0, name: 'The song' }),
  ];
  const { judgements, skipped } = parseJudgements(serializeJudgements(records));
  assert.equal(judgements.length, 3);
  assert.equal(skipped, 0);
  assert.deepEqual(judgements[1].music[0].music.chords, trimForMark(sections[0]).music.chords);

  // A round from an older dealer is kept in the file but not trained on; a mark
  // brought its own music, so there is no dealer for it to be out of step with.
  const stale = [...records.map((record) => ({ ...record })), { ...records[0], id: 'old', dealer: 0 }];
  const usable = usableJudgements(stale);
  assert.equal(usable.length, 3);
  assert.ok(usable.every((record) => record.id !== 'old'));
});

test('a mark becomes rows the trainer can eat, weighted below a rated round', () => {
  const sections = songSections().slice(0, 3);
  const records = [
    makeMark({ sections: [sections[0]], rating: 1 }),
    makeMark({ sections, order: [0, 1, 2], rating: 0 }),
  ];
  const dataset = buildDataset(records);
  assert.equal(dataset.rounds.length, 2);
  assert.equal(dataset.marks, 2);

  const [one, song] = dataset.rounds;
  // Only the overall head. A thumb never said which of the tune, the chords and
  // the groove it meant, and inventing three opinions from one would be a lie.
  assert.deepEqual(Object.keys(one.sections[0].targets), ['overall']);
  assert.equal(one.sections[0].targets.overall, 1);
  assert.equal(one.sections[0].weight, MARK_WEIGHTS.section);
  assert.ok(one.sections[0].weight < 1, 'a thumb pushes less than a rated hand');
  assert.deepEqual(one.pairs, []);

  assert.equal(song.sections.length, 3);
  assert.equal(song.pairs.length, 2);
  assert.equal(song.sections[0].weight, MARK_WEIGHTS.song);
  assert.equal(song.pairs[0].weight, MARK_WEIGHTS.join);
  assert.ok(song.pairs[0].weight > song.sections[0].weight,
    'what a song mark really says is that the order worked');
});

/** A card per seed, and whether it is in a minor-ish key — a learnable opinion. */
function thumbCards(count, prefix = 'thumb') {
  const cards = [];
  for (let i = 0; i < count; i++) {
    const [card] = dealRound({ seed: `${prefix}${i}` }).cards;
    const minorish = ['minor', 'dorian', 'phrygian', 'harmonicMinor', 'blues']
      .includes(card.section.music.scaleId);
    cards.push({ section: card.section, likes: minorish ? 1 : 0 });
  }
  return cards;
}

test('when two opinions disagree, the heavier one wins', () => {
  // The honest statement of what a weight is. Adam divides the batch by the sum
  // of the weights, so making *everything* lighter changes nothing — a file of
  // nothing but thumbs is learned from at full strength, which is right, since
  // it is all you have said. A weight only ever means "against the other rows",
  // and this is that: the same music, told two contradictory things, and the
  // model ends up agreeing with whichever was said louder.
  const cards = thumbCards(40, 'argue');
  const half = Math.floor(cards.length / 2);
  // The first half is always the loud one. What changes between the two runs is
  // which of them is telling the truth about the rule underneath.
  const records = (loudIsRight) => cards.map((card, index) => {
    const loud = index < half;
    const truthful = loud === loudIsRight;
    return makeMark({
      sections: [card.section],
      rating: truthful ? card.likes : 1 - card.likes,
      weight: loud ? 1 : 0.15,
    });
  });
  const lean = (model) => {
    const wanted = cards.filter((card) => card.likes === 1);
    const rest = cards.filter((card) => card.likes === 0);
    const mean = (list) => list.reduce(
      (total, card) => total + model.scoreSection(card.section).overall, 0,
    ) / Math.max(1, list.length);
    return mean(wanted) - mean(rest);
  };

  const agrees = trainTaste(records(true), { minRounds: 4, folds: 2, maxEpochs: 120 }).model;
  const disagrees = trainTaste(records(false), { minRounds: 4, folds: 2, maxEpochs: 120 }).model;
  assert.ok(lean(agrees) > 0, `the heavy half was ignored: ${lean(agrees).toFixed(3)}`);
  assert.ok(lean(disagrees) < 0, `the light half won: ${lean(disagrees).toFixed(3)}`);
});

test('thumbs alone can teach it something, and noise still cannot', () => {
  const rng = makeRng('thumb-noise');
  const cards = thumbCards(70);
  const records = (random) => cards.map((card) => makeMark({
    sections: [card.section],
    rating: random ? Math.round(rng()) : card.likes,
  }));

  const taught = trainTaste(records(false), { maxEpochs: 200 });
  assert.equal(taught.report.marks, taught.report.judgements);
  assert.ok(taught.report.holdout.ranking > 0.62,
    `thumbs only managed ${taught.report.holdout.ranking?.toFixed(3)}`);
  assert.match(describeReport(taught.report), /0 rounds and \d+ marks/);

  const noise = trainTaste(records(true), { maxEpochs: 200 });
  assert.ok(noise.model.confidence < 0.35,
    `random thumbs were given ${noise.model.confidence.toFixed(2)} say`);
});

test('marks and rated rounds train together', () => {
  const rounds = simulate(40);
  const marks = thumbCards(20, 'both')
    .map((card) => makeMark({ sections: [card.section], rating: card.likes }));
  const { report } = trainTaste([...rounds, ...marks], { maxEpochs: 160 });
  assert.equal(report.judgements, 60);
  assert.equal(report.marks, 20);
  assert.match(describeReport(report), /40 rounds and 20 marks/);
});

test('a trained model prefers the songs it steered', () => {
  const { model } = trainTaste(simulate(80), { maxEpochs: 200 });
  let plain = 0;
  let steered = 0;
  const runs = 12;
  for (let i = 0; i < runs; i++) {
    const options = {
      settings: { seed: `lift${i}`, minutes: 2 }, rootPc: 9, scaleId: 'minor', tempo: 96,
    };
    plain += model.scoreSong(composeSong(options).sections);
    steered += model.scoreSong(composeSong({ ...options, taste: model, tasteStrength: 1 }).sections);
  }
  assert.ok(steered > plain,
    `steering scored ${(steered / runs).toFixed(3)} against ${(plain / runs).toFixed(3)}`);
});
