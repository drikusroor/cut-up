// The two file formats: a section, and a whole song.
//
// MIDI carries the notes and audio carries the sound, but neither carries the
// *idea* — the seeds, the settings, the hand edits, the mix, the words. That is
// what these are for. They are plain JSON with a header on the front, so a file
// is readable, diffable, mailable and — being nothing but data — safe to open
// from someone else: nothing in here is ever evaluated, only validated.
//
//   .cutsec    one section, or several: an idea to reuse in another song
//   .cutsong   the whole thing: sections, running order, transport, mix, words
//
// Both are versioned. A file from a future version is refused with a sentence
// saying so rather than half-loaded into a song you were working on.

import { clone } from '../music/sections.js';
import { normalizeMix } from '../music/mixer.js';
import { normalizeMeter } from '../music/meter.js';
import { normalizeHumanize } from '../music/humanize.js';
import { normalizeTuning } from '../music/tuning.js';
import { normalizeVocal } from '../music/vocal.js';
import { normalizeComposeSettings } from '../music/compose.js';

export const SECTION_EXT = '.cutsec';
export const SONG_EXT = '.cutsong';
export const SECTION_FORMAT = 'cut-up.section';
export const SONG_FORMAT = 'cut-up.song';

/** Bumped when a file written today would be misread by the code above. */
export const FILE_VERSION = 1;

/** What a file picker should offer, for both the button and the drop target. */
export const FILE_ACCEPT = `${SECTION_EXT},${SONG_EXT},.json`;

/** A file name that will survive a file system: "Section A" → "section-a". */
export function slug(text, fallback = 'cut-up') {
  const cleaned = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

/** How big a thing is once written out, in bytes of UTF-8. */
export function byteSize(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

/** "12 KB", "1.4 MB" — a size you can hold in your head. */
export function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function header(format) {
  return {
    format,
    version: FILE_VERSION,
    app: 'cut-up',
    savedAt: Date.now(),
  };
}

/**
 * One or more sections, wrapped for sending.
 *
 * @param {object|object[]} sections
 * @param {{note?: string}} [meta] a line about what these are, if you like
 */
export function sectionFile(sections, meta = {}) {
  const list = (Array.isArray(sections) ? sections : [sections]).filter(Boolean);
  return {
    ...header(SECTION_FORMAT),
    ...(meta.note ? { note: String(meta.note) } : {}),
    sections: clone(list),
  };
}

/**
 * Everything that makes the song what it is.
 *
 * Deliberately more than the arrangement: the loose idea open in the other
 * tabs, the words that were cut up for it, the desk it was mixed on and what
 * the composer was last asked for. Opening one somewhere else should put you
 * back where you were, not merely play you something.
 *
 * @param {object} state the app state
 * @param {{name?: string, note?: string}} [meta]
 */
export function songSnapshot(state, meta = {}) {
  return {
    name: String(meta.name || 'Untitled').slice(0, 120),
    ...(meta.note ? { note: String(meta.note) } : {}),
    tempo: state.tempo,
    swing: state.swing,
    meter: clone(state.meter),
    feel: clone(state.feel),
    tuning: clone(state.tuning),
    mix: clone(state.mix),
    parts: clone(state.parts),
    // The idea open in the other tabs, which is often the one you were in the
    // middle of when you saved.
    music: clone(state.music),
    rhythm: clone(state.rhythm),
    sections: clone(state.sections || []),
    arrangement: clone(state.arrangement || []),
    currentSectionId: state.currentSectionId || null,
    compose: clone(state.compose),
    // The words are half the point of this program, so they travel with it.
    words: clone(state.words),
  };
}

export function songFile(state, meta = {}) {
  return {
    ...header(SONG_FORMAT),
    song: songSnapshot(state, meta),
  };
}

/** JSON with newlines in it, because a file people might read is a file. */
export function serialize(file) {
  return `${JSON.stringify(file, null, 2)}\n`;
}

function fail(message) {
  throw new Error(message);
}

/** A section from a file: shaped like one, or it is not one. */
function readSection(value) {
  if (!value || typeof value !== 'object') fail('That file does not contain a section.');
  if (!value.music || typeof value.music !== 'object') fail('That section has no music in it.');
  const section = clone(value);
  section.id = String(section.id || `sec${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);
  section.name = String(section.name || 'Section').slice(0, 60);
  section.kind = ['intro', 'main', 'bridge', 'outro'].includes(section.kind) ? section.kind : 'main';
  section.music.vocal = section.music.vocal ? normalizeVocal(section.music.vocal) : undefined;
  if (!section.music.vocal) delete section.music.vocal;
  if (section.meter) section.meter = normalizeMeter(section.meter);
  section.savedAt = Number(section.savedAt) || Date.now();
  return section;
}

/**
 * Reads a file someone handed you.
 *
 * Everything is checked and clamped on the way in — a mix with a fader at a
 * hundred, a meter of nought over nought, a section with no music — because the
 * whole point of a shareable file is that it came from somewhere else.
 *
 * @param {string|object} input the text of a file, or the parsed object
 * @returns {{kind: 'section'|'song', sections?: object[], song?: object}}
 */
export function parseFile(input) {
  let data = input;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch {
      fail('That is not a Cut-Up file — it is not even JSON.');
    }
  }
  if (!data || typeof data !== 'object') fail('That file is empty.');

  const version = Number(data.version) || 1;
  if (version > FILE_VERSION) {
    fail(`That file was written by a newer version of Cut-Up (v${version}). Update, then open it again.`);
  }

  if (data.format === SECTION_FORMAT || (Array.isArray(data.sections) && !data.song)) {
    const list = (data.sections || []).map(readSection);
    if (!list.length) fail('That file has no sections in it.');
    return { kind: 'section', sections: list, note: data.note || '' };
  }

  if (data.format === SONG_FORMAT || data.song) {
    const song = data.song;
    if (!song || typeof song !== 'object') fail('That file has no song in it.');
    return { kind: 'song', song: readSong(song), note: data.note || '' };
  }

  return fail('That file is not a Cut-Up section or song.');
}

/** A song from a file, with every setting put back inside its own range. */
export function readSong(song) {
  const sections = (Array.isArray(song.sections) ? song.sections : []).map(readSection);
  const ids = new Set(sections.map((section) => section.id));
  return {
    name: String(song.name || 'Untitled').slice(0, 120),
    ...(song.note ? { note: String(song.note) } : {}),
    tempo: clampNumber(song.tempo, 40, 220, 96),
    swing: clampNumber(song.swing, 0, 0.75, 0),
    meter: normalizeMeter(song.meter || {}),
    feel: normalizeHumanize(song.feel || {}),
    tuning: normalizeTuning(song.tuning || {}),
    mix: normalizeMix(song.mix || {}),
    parts: {
      chords: song.parts?.chords !== false,
      melody: song.parts?.melody !== false,
      vocal: song.parts?.vocal !== false,
      bass: song.parts?.bass !== false,
      drums: song.parts?.drums !== false,
    },
    music: song.music && typeof song.music === 'object' ? clone(song.music) : null,
    rhythm: song.rhythm && typeof song.rhythm === 'object' ? clone(song.rhythm) : null,
    sections,
    // An entry pointing at a section the file does not carry would be a hole in
    // the running order, so it is dropped rather than kept as a mystery.
    arrangement: (Array.isArray(song.arrangement) ? song.arrangement : [])
      .filter((item) => item && ids.has(item.sectionId))
      .map((item) => ({
        sectionId: item.sectionId,
        repeats: Math.max(1, Math.min(16, Math.round(Number(item.repeats) || 1))),
        ...(item.fade ? { fade: clone(item.fade) } : {}),
      })),
    currentSectionId: ids.has(song.currentSectionId) ? song.currentSectionId : null,
    compose: normalizeComposeSettings(song.compose || {}),
    words: song.words && typeof song.words === 'object' ? clone(song.words) : null,
  };
}

function clampNumber(value, low, high, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(high, Math.max(low, number));
}

/**
 * Pours a song read from a file back into the running app.
 *
 * The panels hold references to `state.music` and `state.rhythm`, so those two
 * are filled rather than replaced — the same reason loading a section does.
 *
 * @param {object} state
 * @param {object} song from parseFile
 */
export function applySong(state, song) {
  state.tempo = song.tempo;
  state.swing = song.swing;
  state.meter = clone(song.meter);
  state.feel = clone(song.feel);
  state.tuning = clone(song.tuning);
  state.mix = clone(song.mix);
  state.parts = { ...state.parts, ...song.parts };
  if (song.music) Object.assign(state.music, clone(song.music));
  if (song.rhythm) Object.assign(state.rhythm, clone(song.rhythm));
  state.music.vocal = normalizeVocal(state.music.vocal);
  state.sections = clone(song.sections);
  state.arrangement = clone(song.arrangement);
  state.currentSectionId = song.currentSectionId;
  state.compose = clone(song.compose);
  if (song.words) state.words = { ...state.words, ...clone(song.words) };
  return state;
}

/** What to call the file when it lands in someone's downloads folder. */
export function sectionFilename(section) {
  return `cut-up-${slug(section?.name, 'section')}${SECTION_EXT}`;
}

export function songFilename(name) {
  return `cut-up-${slug(name, 'song')}${SONG_EXT}`;
}
