#!/usr/bin/env node
// Builds data/words.<lang>.json from the OpenSubtitles frequency lists
// published by hermitdave/FrequencyWords (CC BY-SA 4.0).
//
//   node tools/build-wordlists.mjs
//
// The output is a plain array of words ordered by descending frequency, so the
// app can treat the array index as a rarity rank (index 0 = most common word).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018';

// How deep into the frequency list we go. Past ~15k the lists get noisy with
// typos and transcription artefacts.
const MAX_RANK = 15000;

// Function words carry no imagery, and a cut-up made of them is just mush.
// They are still useful as connective tissue, so the app keeps its own small
// set of them (see src/cutup.js); they just don't belong in the word bank.
const STOP = {
  en: `a an and are as at be been being but by can cant could did do does doesnt
    doing dont for from get got had has have having he her here hers him his how
    i if in into is it its just like me might must my no not of off on once one
    only or other our out over own said same shall she should so some such than
    that the their them then there these they this those through to too until up
    us very was we were what when where which while who whom why will with would
    you your yours yeah okay ok oh uh um hey hi yes ah eh mm hmm gonna wanna
    gotta lot lots thing things stuff really actually maybe well now then also
    every any all more most much many few both each either neither its im ive id
    ill hes shes theyre were youre thats whats lets dont doesnt didnt cant wont
    isnt arent wasnt werent havent hasnt hadnt shouldnt wouldnt couldnt`,
  nl: `aan af al alle alleen als altijd bij daar dan dat de deze die dit doe doen
    door dus echt een eens en er even ga gaan gaat geen goed haar had heb hebben
    hebt heeft hem het hier hij hoe hun ik in is ja je jij jou jouw jullie kan
    kom komen kun kunnen laat maar me mee meer met mij mijn misschien moet moeten
    naar niet niets nog nou nu of om ons onze ook op over te tegen toch toe toen
    tot uit van veel voor waar wanneer want was wat we weer wel werd wezen wie
    wij wil wilde willen worden wordt zal ze zei zeg zelf zich zij zijn zo zou
    zullen jij hoor hé ha oh eh uh hm hmm nee joh even echt zeker`,
};

const stopSet = (lang) => new Set(STOP[lang].split(/\s+/).filter(Boolean));

const PATTERN = {
  en: /^[a-z]{3,14}$/,
  nl: /^[a-zàáâäçèéêëìíîïñòóôöùúûü]{3,17}$/,
};

async function build(lang) {
  const url = `${BASE}/${lang}/${lang}_50k.txt`;
  process.stdout.write(`fetching ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const raw = await res.text();

  const stop = stopSet(lang);
  const pattern = PATTERN[lang];
  const words = [];
  const seen = new Set();

  let rank = 0;
  for (const line of raw.split('\n')) {
    const word = line.split(' ')[0]?.trim().toLowerCase();
    if (!word) continue;
    if (++rank > MAX_RANK) break;
    if (!pattern.test(word)) continue;
    if (stop.has(word)) continue;
    if (seen.has(word)) continue;
    // Subtitle lists are full of stretched interjections ("noooo", "ahhh").
    if (/(.)\1\1/.test(word)) continue;
    seen.add(word);
    words.push(word);
  }

  const payload = {
    lang,
    count: words.length,
    source: 'hermitdave/FrequencyWords (OpenSubtitles 2018)',
    license: 'CC BY-SA 4.0',
    url: `${BASE}/${lang}/${lang}_50k.txt`,
    note: 'Ordered by descending corpus frequency; the index doubles as a rarity rank.',
    words,
  };

  const out = join(ROOT, 'data', `words.${lang}.json`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload), 'utf8');
  process.stdout.write(`wrote ${out} (${words.length} words)\n`);
}

for (const lang of ['en', 'nl']) {
  await build(lang);
}
