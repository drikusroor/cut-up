// Singing the cut-up back at you.
//
// Two halves. The first is *setting*: deciding which syllable lands on which
// note, which is the oldest job in songwriting and mostly a matter of counting.
// The second is *timing*: how long inside one note each sound gets, because
// "strike" is a note with four consonants stapled to one vowel and only the
// vowel is allowed to be long.
//
// Both are pure functions over data. The noise itself is made in audio.js,
// which reads what this file decided.

import { makeRng } from '../rng.js';
import { lineSyllables, phoneInfo, isVowel } from './phonemes.js';

/**
 * How the voice is made to sound. Formants are scaled — a soprano's throat is
 * shorter than a bass's, and that is nearly the whole difference between them.
 */
export const VOCAL_VOICES = [
  {
    id: 'alto',
    label: 'Alto',
    hint: 'Middle of the range, plain and clear. The safe one.',
    formant: 1.06,
    tilt: 3000,
    breath: 0.1,
    vibrato: { rate: 5.1, depth: 22, delay: 0.28 },
  },
  {
    id: 'soprano',
    label: 'Soprano',
    hint: 'Bright and forward, formants pushed up. Sings high well.',
    formant: 1.22,
    tilt: 4200,
    breath: 0.12,
    vibrato: { rate: 5.8, depth: 32, delay: 0.22 },
  },
  {
    id: 'tenor',
    label: 'Tenor',
    hint: 'Warmer, a little further back in the throat.',
    formant: 0.98,
    tilt: 2600,
    breath: 0.1,
    vibrato: { rate: 4.9, depth: 20, delay: 0.3 },
  },
  {
    id: 'bass',
    label: 'Bass',
    hint: 'Long throat, dark vowels. Wants the bottom of the range.',
    formant: 0.86,
    tilt: 2000,
    breath: 0.08,
    vibrato: { rate: 4.4, depth: 16, delay: 0.35 },
  },
  {
    id: 'child',
    label: 'Small voice',
    hint: 'Short throat, everything up. Uncanny, on purpose.',
    formant: 1.38,
    tilt: 5000,
    breath: 0.14,
    vibrato: { rate: 6.2, depth: 26, delay: 0.2 },
  },
  {
    id: 'whisper',
    label: 'Breath',
    hint: 'Almost no voice at all — the words on air. Sits under a loud band.',
    formant: 1.08,
    tilt: 5200,
    breath: 0.85,
    voicing: 0.22,
    vibrato: { rate: 4.6, depth: 10, delay: 0.4 },
  },
  {
    id: 'android',
    label: 'Android',
    hint: 'No vibrato, no drift, formants dead centre. A machine reading.',
    formant: 1,
    tilt: 3400,
    breath: 0.05,
    vibrato: null,
    steady: true,
  },
];

/**
 * What the voice is played *through*.
 *
 * `sung` is the synthesiser on its own: a buzzing glottal source through the
 * formant filters, which is a singing voice made out of three bandpasses.
 *
 * The other two are vocoders, and they are the real thing rather than an
 * imitation of one — the synthesised speech is the modulator, its energy is
 * measured band by band, and those measurements open the same bands of a
 * carrier. In `vocoder` the carrier is a sawtooth on the melody note; in
 * `talkbox` it is whatever instrument the melody is already playing, which is
 * what a tube in the corner of your mouth does to a guitar amp.
 */
export const VOCAL_MODES = [
  { id: 'sung', label: 'Sung', hint: 'The voice on its own — formants over a glottal buzz.' },
  { id: 'vocoder', label: 'Vocoder', hint: 'The words through a synth on the melody note. The robot choir.' },
  { id: 'talkbox', label: 'Talk box', hint: 'The words through the melody instrument itself.' },
];

/** Where the words come from. */
export const VOCAL_SOURCES = [
  { id: 'output', label: 'The lines on the Words tab' },
  { id: 'keepers', label: 'The Keepers' },
  { id: 'own', label: 'My own words' },
];

export function vocalVoice(id) {
  return VOCAL_VOICES.find((voice) => voice.id === id) || VOCAL_VOICES[0];
}

export function vocalMode(id) {
  return VOCAL_MODES.find((mode) => mode.id === id) || VOCAL_MODES[0];
}

/** What the Voice box says before you have touched it. */
export function defaultVocal() {
  return {
    on: false,
    source: 'output',
    text: '',
    voice: 'alto',
    mode: 'sung',
    level: 0.8,
    melisma: 0.4,
    lang: 'en',
    // The words themselves, frozen. The Words tab is where they come from, but
    // a section that is sung has to keep the lines it was sung with — otherwise
    // rerolling the lyrics would rewrite every song you had already saved.
    lines: [],
  };
}

export function normalizeVocal(vocal) {
  const base = defaultVocal();
  const v = { ...base, ...(vocal || {}) };
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    on: Boolean(v.on),
    source: VOCAL_SOURCES.some((s) => s.id === v.source) ? v.source : base.source,
    text: typeof v.text === 'string' ? v.text : '',
    voice: vocalVoice(v.voice).id,
    mode: vocalMode(v.mode).id,
    level: Math.min(1, Math.max(0, num(v.level, base.level))),
    melisma: Math.min(1, Math.max(0, num(v.melisma, base.melisma))),
    lang: v.lang === 'nl' ? 'nl' : 'en',
    lines: Array.isArray(v.lines) ? v.lines.map((line) => String(line ?? '')) : [],
  };
}

/** The same lines, starting from a different one. */
export function rotateLines(lines = [], by = 0) {
  if (!lines.length) return [];
  const at = ((Math.round(by) % lines.length) + lines.length) % lines.length;
  return [...lines.slice(at), ...lines.slice(0, at)];
}

/**
 * One idea's share of a lyric.
 *
 * A song does not sing the same line in the verse and the chorus, so each idea
 * starts further down the words than the one before it — and, because setting
 * wraps round when it runs out, a song longer than its lyric comes back to the
 * top, which is what a chorus is.
 *
 * @param {object} vocal
 * @param {number} index which idea this is
 * @param {number} total how many there are
 */
export function dealLyric(vocal, index, total) {
  if (!vocal?.lines?.length) return vocal;
  const chunk = Math.max(1, Math.ceil(vocal.lines.length / Math.max(1, total)));
  return { ...vocal, lines: rotateLines(vocal.lines, index * chunk) };
}

/**
 * A melody with the words on it, ready to be played or exported.
 *
 * Every sung note also carries how it is to be sung, the way every note
 * already carries which instrument to play it on — so a song strung together
 * out of sections can change singer halfway through, and a section keeps the
 * voice it was saved with.
 *
 * @param {{melody?: Array<object>, vocal?: object, melodySeed?: string}} music
 * @returns {{notes: Array<object>, vocal: object, stats: object|null}}
 */
export function singMelody(music = {}) {
  const vocal = normalizeVocal(music.vocal);
  const melody = music.melody || [];
  if (!vocal.on || !vocal.lines.length || !melody.length) {
    return { notes: melody, vocal, stats: null };
  }
  const stats = setLyric(melody, vocal.lines, {
    lang: vocal.lang,
    melisma: vocal.melisma,
    seed: music.melodySeed || 'voice',
  });
  const badge = { voice: vocal.voice, mode: vocal.mode, level: vocal.level };
  return {
    notes: stats.notes.map((note) => (note.syllable ? { ...note, vocal: badge } : note)),
    vocal,
    stats,
  };
}

// --- setting the words to the tune ------------------------------------------

/** A gap of this many steps or more is a breath, and so a new phrase. */
const PHRASE_GAP = 3;
/** A note has to be at least this long before two syllables will fit on it. */
const SPLITTABLE = 2;

/**
 * Cuts a melody into phrases at its rests.
 *
 * A singer breathes where the tune stops, and a line of words goes between two
 * breaths. So the phrasing is read off the melody rather than imposed on it:
 * wherever there is a gap of a beat or more, that is where the line ends.
 *
 * @param {Array<{step: number, length: number}>} notes
 * @returns {number[][]} indices into `notes`, one array per phrase
 */
export function phraseMelody(notes, gap = PHRASE_GAP) {
  const order = notes.map((_, index) => index)
    .sort((a, b) => notes[a].step - notes[b].step || notes[a].midi - notes[b].midi);
  const phrases = [];
  let current = [];
  let previousEnd = null;
  for (const index of order) {
    const note = notes[index];
    if (previousEnd != null && note.step - previousEnd >= gap && current.length) {
      phrases.push(current);
      current = [];
    }
    current.push(index);
    previousEnd = Math.max(previousEnd ?? 0, note.step + note.length);
  }
  if (current.length) phrases.push(current);
  return phrases;
}

/**
 * Hands out the notes of one phrase to the syllables of one line.
 *
 * More notes than syllables and somebody has to hold a vowel across several of
 * them — a melisma, and the reason "Gloria" can last eight bars. Which syllable
 * gets it is not random: it goes to the end of a word, and preferentially to
 * the end of the line, because that is where a singer has breath to spare.
 *
 * @param {number} notes how many notes the phrase has
 * @param {Array<{wordEnd: boolean}>} syllables
 * @param {{melisma?: number, rng?: () => number}} [opts]
 * @returns {number[]} how many notes each syllable takes, in order
 */
export function spreadSyllables(notes, syllables, { melisma = 0.4, rng = () => 0.5 } = {}) {
  const count = syllables.length;
  if (!count || notes <= 0) return [];
  const spread = new Array(count).fill(1);
  let extra = notes - count;
  if (extra <= 0) return spread;

  // Every syllable could in principle be held; these are the odds it is picked
  // when there is a spare note going.
  const appetite = syllables.map((syllable, index) => {
    const last = index === count - 1 ? 1 : 0;
    const word = syllable.wordEnd ? 0.55 : 0.12;
    return last + (word + rng() * 0.12) * (0.2 + melisma);
  });

  while (extra > 0) {
    let best = 0;
    for (let i = 1; i < count; i++) if (appetite[i] > appetite[best]) best = i;
    spread[best] += 1;
    // Held once, less hungry — otherwise one syllable eats the whole phrase.
    appetite[best] *= 0.45 + melisma * 0.3;
    extra -= 1;
  }
  return spread;
}

/**
 * Writes the words onto the melody.
 *
 * Nothing is mutated: the melody comes back as a new array, with a `syllable`
 * hung off every note that has words on it. A note whose syllable is a
 * continuation carries `tie: true` and only the vowel, which is how a held
 * vowel sounds like one long note rather than the word said twice.
 *
 * When a line has more syllables than the phrase has notes, the long notes are
 * split in two and the words keep going; when it still will not fit, the rest
 * of the line moves on to the next phrase rather than being thrown away.
 *
 * @param {Array<{midi:number, step:number, length:number}>} melody
 * @param {string[]} lines
 * @param {{lang?: 'en'|'nl', melisma?: number, seed?: string}} [opts]
 * @returns {{notes: Array<object>, syllables: number, sung: number, phrases: number,
 *   melismas: number, splits: number, unsung: number}}
 */
export function setLyric(melody = [], lines = [], opts = {}) {
  const { lang = 'en', melisma = 0.4, seed = 'voice' } = opts;
  const rng = makeRng(`${seed}:lyric`);
  const notes = melody.map((note) => ({ ...note }));
  const stats = {
    notes, syllables: 0, sung: 0, phrases: 0, melismas: 0, splits: 0, unsung: 0,
  };

  const text = lines.filter((line) => String(line || '').trim());
  if (!notes.length || !text.length) return stats;

  const phrases = phraseMelody(notes);
  stats.phrases = phrases.length;

  /** The words, a line at a time, refilled from the top when they run out. */
  let lineIndex = 0;
  let pending = [];
  const nextLine = () => {
    const line = text[lineIndex % text.length];
    lineIndex += 1;
    return lineSyllables(line, lang);
  };

  for (const phrase of phrases) {
    if (!pending.length) pending = nextLine();
    if (!pending.length) continue;

    // Only as much of the line as this phrase can hold. A note carrying two
    // syllables has to be long enough to be worth dividing.
    let room = phrase.length;
    for (const index of phrase) {
      const extra = Math.floor(notes[index].length / SPLITTABLE) - 1;
      if (extra > 0) room += extra;
    }
    const taken = pending.slice(0, Math.max(1, Math.min(pending.length, room)));
    pending = pending.slice(taken.length);
    stats.syllables += taken.length;

    // Cut long notes up until there is a note for every syllable, longest
    // first, so a held minim becomes two crotchets before a quaver is touched.
    const slots = phrase.map((index) => ({ index, parts: 1 }));
    let needed = taken.length - slots.length;
    while (needed > 0) {
      let best = null;
      let longest = 0;
      for (const slot of slots) {
        const per = notes[slot.index].length / (slot.parts + 1);
        // Never below one step: two syllables on a semiquaver is a stutter.
        if (per >= 1 && per > longest) {
          longest = per;
          best = slot;
        }
      }
      if (!best) break;
      best.parts += 1;
      needed -= 1;
      stats.splits += 1;
    }

    // Every playable slot, in time order — a divided note counts once per part.
    const seats = [];
    for (const slot of slots) {
      const note = notes[slot.index];
      const per = note.length / slot.parts;
      for (let part = 0; part < slot.parts; part++) {
        seats.push({
          index: slot.index,
          part,
          parts: slot.parts,
          step: note.step + part * per,
          length: per,
        });
      }
    }
    seats.sort((a, b) => a.step - b.step);

    const spread = spreadSyllables(seats.length, taken, { melisma, rng });
    let seat = 0;
    let previous = null;
    taken.forEach((syllable, order) => {
      const held = spread[order] ?? 1;
      for (let n = 0; n < held && seat < seats.length; n++, seat++) {
        const at = seats[seat];
        const tie = n > 0;
        const phones = tie ? syllable.phones.filter(isVowel) : syllable.phones;
        const sung = {
          ...notes[at.index],
          step: at.step,
          length: at.length,
          syllable: {
            text: syllable.text,
            word: syllable.word,
            phones: phones.length ? phones : syllable.phones,
            tie,
            // The last note of a word gets to finish its consonants properly;
            // one in the middle runs straight into the next.
            wordEnd: syllable.wordEnd && n === held - 1,
            stressed: syllable.stressed && !tie,
          },
        };
        // A held vowel slides up to its next note rather than restriking it,
        // which is the difference between a melisma and a repeated word.
        if (tie && previous) sung.syllable.slideFrom = previous.midi;
        if (at.parts > 1) sung.id = `${notes[at.index].id ?? at.index}+${at.part}`;
        if (at.part === 0) {
          notes[at.index] = sung;
        } else {
          notes.push(sung);
        }
        previous = sung;
        if (tie) stats.melismas += 1;
        stats.sung += 1;
      }
    });
  }

  stats.unsung = pending.length;
  notes.sort((a, b) => a.step - b.step);
  return stats;
}

// --- timing the sounds inside one note --------------------------------------

/** A consonant never gets more than this share of a short note. */
const CONSONANT_SHARE = 0.45;
/** How far in front of the beat a singer puts the consonants, at most. */
const MAX_LEAD = 0.07;

/**
 * Lays the sounds of one syllable out across the length of its note.
 *
 * A syllable is consonants, then a vowel, then more consonants, and only the
 * vowel is elastic. So the consonants are given the time they need — a plosive
 * is fifty milliseconds whatever the tempo — and the vowel gets what is left.
 * Part of the onset is sung *early*, the way a singer puts the "str" of
 * "strike" in front of the beat so the vowel lands on it.
 *
 * @param {string[]} phones
 * @param {number} duration how long the note is, in seconds
 * @returns {{segments: Array<{p: string, at: number, dur: number}>, vowelAt: number,
 *   lead: number}} `at` is relative to the note's own start; `lead` is how far
 *   before that the first sound has to begin
 */
export function phoneSchedule(phones = [], duration = 0.4) {
  const list = phones.filter((p) => phoneInfo(p));
  const nucleus = list.findIndex(isVowel);
  const onset = nucleus === -1 ? list : list.slice(0, nucleus);
  const rest = nucleus === -1 ? [] : list.slice(nucleus);
  const vowel = rest[0] || null;
  const coda = rest.slice(1);

  const lengthOf = (p) => {
    const info = phoneInfo(p);
    return (info?.dur ?? 0.05) + (info?.closure ?? 0);
  };

  // Consonants are squeezed rather than dropped when the note is very short.
  const onsetWanted = onset.reduce((total, p) => total + lengthOf(p), 0);
  const codaWanted = coda.reduce((total, p) => total + lengthOf(p), 0);
  const budget = Math.max(0.04, duration * CONSONANT_SHARE);
  const onsetScale = onsetWanted > budget ? budget / onsetWanted : 1;
  const codaScale = codaWanted > budget ? budget / codaWanted : 1;
  const onsetFor = onsetWanted * onsetScale;
  const codaFor = codaWanted * codaScale;

  const lead = Math.min(onsetFor, MAX_LEAD);
  const vowelAt = onsetFor - lead;

  const segments = [];
  let at = -lead;
  for (const p of onset) {
    const dur = lengthOf(p) * onsetScale;
    segments.push({ p, at, dur });
    at += dur;
  }
  if (vowel) {
    const dur = Math.max(0.03, duration - vowelAt - codaFor);
    segments.push({ p: vowel, at: vowelAt, dur });
    at = vowelAt + dur;
  }
  for (const p of coda) {
    const dur = lengthOf(p) * codaScale;
    segments.push({ p, at, dur });
    at += dur;
  }

  return { segments, vowelAt, lead };
}

/**
 * The words a set melody is actually singing, as one string per phrase — for
 * showing back to you under the piano roll.
 *
 * @param {Array<{syllable?: object, step: number}>} notes
 */
export function sungText(notes = []) {
  const sung = notes.filter((note) => note.syllable && !note.syllable.tie)
    .sort((a, b) => a.step - b.step);
  const out = [];
  let word = null;
  for (const note of sung) {
    if (note.syllable.word !== word || out.length === 0) {
      out.push(note.syllable.word);
      word = note.syllable.word;
    }
  }
  return out.join(' ');
}
