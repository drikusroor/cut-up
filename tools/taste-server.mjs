#!/usr/bin/env node
// The app, plus somewhere to put your answers.
//
//   npm run taste     →  http://localhost:8000
//
// `npm start` serves the same static files and is all you need for everything
// except training: the Train tab works there too, but it can only keep your
// judgements in the browser and hand them back as a download. Run this instead
// and every answer goes straight into data/taste.jsonl as you give it, so the
// session you just did is a `git diff` rather than a thing to remember to
// export.
//
// Deliberately tiny, and deliberately local-only: it binds to the loopback
// interface, serves one directory, and has exactly three routes. It is a
// convenience for the person who owns the repository, not a service.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import {
  appendFile, mkdir, readFile, stat, writeFile,
} from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { answerCount, parseJudgements, toLine } from '../src/ml/judgements.js';
import { describeReport, trainTaste } from '../src/ml/train.js';
import { JUDGEMENTS_PATH, MODEL_PATH } from './train-taste.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(payload);
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('too much');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadJudgements() {
  try {
    return parseJudgements(await readFile(JUDGEMENTS_PATH, 'utf8')).judgements;
  } catch {
    return [];
  }
}

/** POST /api/judgements — one round, appended. */
async function recordJudgement(req, res) {
  const record = JSON.parse(await readBody(req));
  if (!record?.seed || !answerCount(record)) return send(res, 400, { error: 'nothing answered' });
  await mkdir(dirname(JUDGEMENTS_PATH), { recursive: true });
  // Appending rather than rewriting is what makes this safe to run while you
  // have the file open, and what makes two sessions on two machines merge by
  // concatenation rather than by argument.
  await appendFile(JUDGEMENTS_PATH, `${toLine(record)}\n`);
  const judgements = await loadJudgements();
  return send(res, 200, { ok: true, judgements: judgements.length });
}

/** POST /api/train — fit, write the model, hand back the report. */
async function train(req, res) {
  const judgements = await loadJudgements();
  const { model, report } = trainTaste(judgements);
  await mkdir(dirname(MODEL_PATH), { recursive: true });
  await writeFile(MODEL_PATH, `${JSON.stringify(model.toJSON(), null, 1)}\n`);
  console.log(`  trained: ${describeReport(report)}`);
  return send(res, 200, { ok: true, report, summary: describeReport(report), model: model.toJSON() });
}

async function serveStatic(req, res, pathname) {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = join(root, relative === '/' ? 'index.html' : relative);
  // Nothing outside the repository, whatever the path says.
  if (!file.startsWith(root)) return send(res, 403, { error: 'no' });
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    res.writeHead(200, {
      'content-type': TYPES[extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    return createReadStream(target).pipe(res);
  } catch {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${port}`);
  try {
    // The Train tab probes this to find out whether it can save anything. On
    // GitHub Pages it 404s, the tab says so, and falls back to the browser's
    // own storage plus an export button.
    if (pathname === '/api/status') {
      const judgements = await loadJudgements();
      return send(res, 200, { ok: true, recording: true, judgements: judgements.length });
    }
    if (pathname === '/api/judgements' && req.method === 'POST') return await recordJudgement(req, res);
    if (pathname === '/api/train' && req.method === 'POST') return await train(req, res);
    return await serveStatic(req, res, pathname);
  } catch (error) {
    return send(res, 500, { error: String(error?.message || error) });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Cut-Up on http://localhost:${port}`);
  console.log(`Recording judgements to ${JUDGEMENTS_PATH}`);
  console.log('Open the Train tab, rate a few rounds, then press Train the model.');
});
