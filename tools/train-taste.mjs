#!/usr/bin/env node
// Fits the taste model to everything in data/taste.jsonl and writes
// models/taste.json. Both files are committed; this is what turns one into the
// other, and it is the only thing that should ever write the second one.
//
//   npm run train              fit and write
//   npm run train -- --dry     fit and report, write nothing
//   npm run train -- --folds 6 --epochs 500
//
// It prints what the model managed on rounds it was not trained on, which is
// the number worth reading. Everything else is decoration.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseJudgements, usableJudgements } from '../src/ml/judgements.js';
import { defaultTrainOptions, describeReport, trainTaste } from '../src/ml/train.js';
import { PAIR_HEAD, SECTION_HEADS } from '../src/ml/model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const JUDGEMENTS_PATH = resolve(root, 'data/taste.jsonl');
export const MODEL_PATH = resolve(root, 'models/taste.json');

function parseArgs(argv) {
  const options = { ...defaultTrainOptions(), dry: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry') options.dry = true;
    else if (arg === '--folds') options.folds = Number(argv[++i]);
    else if (arg === '--epochs') options.maxEpochs = Number(argv[++i]);
    else if (arg === '--seed') options.seed = String(argv[++i]);
    else if (arg === '--rate') options.rate = Number(argv[++i]);
    else if (arg === '--decay') options.decay = Number(argv[++i]);
  }
  return options;
}

const bar = (value) => {
  if (!Number.isFinite(value)) return '—'.padEnd(20);
  // Drawn from 0.5, because 0.5 is the floor: a bar that starts at zero makes a
  // coin look like it is halfway to being right.
  const width = Math.round(Math.max(0, (value - 0.5)) * 40);
  return ('█'.repeat(Math.min(20, width)) || '·').padEnd(20);
};

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  let text = '';
  try {
    text = await readFile(JUDGEMENTS_PATH, 'utf8');
  } catch {
    console.error(`No judgements yet at ${JUDGEMENTS_PATH}.`);
    console.error('Run `npm run taste`, open the Train tab and rate a few rounds first.');
    process.exitCode = 1;
    return;
  }

  const { judgements, skipped } = parseJudgements(text);
  const usable = usableJudgements(judgements);
  console.log(`${judgements.length} judgements${skipped ? `, ${skipped} unreadable lines skipped` : ''}`);
  if (usable.length !== judgements.length) {
    console.log(`${judgements.length - usable.length} from an older dealer — kept in the file, not trained on.`);
  }

  let lastNote = '';
  const { model, report } = trainTaste(judgements, options, (fraction, note) => {
    if (note === lastNote) return;
    lastNote = note;
    process.stdout.write(`  ${String(Math.round(fraction * 100)).padStart(3)}%  ${note}\n`);
  });

  console.log(`\n${describeReport(report)}`);
  if (Number.isFinite(report.holdout?.ranking)) {
    console.log('\nAgreement with you, on rounds it was not trained on:');
    const heads = [...SECTION_HEADS, PAIR_HEAD];
    for (const head of heads) {
      const entry = report.holdout.perHead?.[head.id];
      const value = entry?.ranking;
      console.log(`  ${head.label.padEnd(11)} ${bar(value)} ${
        Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'no comparisons'
      }${entry?.n ? `  (${entry.n} answers)` : ''}`);
    }
    console.log(`\n  ${''.padEnd(11)} 0.5 ─────────────── 1.0   (0.5 is a coin)`);
    console.log(`\nHow much say this earns it in the composer: ${(model.confidence * 100).toFixed(0)}%`);
  }

  if (options.dry) {
    console.log('\n--dry: nothing written.');
    return;
  }

  await mkdir(dirname(MODEL_PATH), { recursive: true });
  await writeFile(MODEL_PATH, `${JSON.stringify(model.toJSON(), null, 1)}\n`);
  console.log(`\nWrote ${MODEL_PATH}`);
  console.log('Commit models/taste.json and data/taste.jsonl together — the model is only ever as good as the file it came from.');
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
