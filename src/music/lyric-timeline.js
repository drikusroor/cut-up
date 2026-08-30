// The words a song is singing, laid back out in time — the subtitles.
//
// vocal.js decides which syllable lands on which note, and then the words
// disappear into the notes: by the time a song is playing there is no lyric
// anywhere, only a melody with syllables stapled to it. This reads that back
// off and puts the lines together again, so the transport can show you which
// line is being sung and which word is in the singer's mouth right now.
//
// A line here is a *phrase*: the words between two breaths. That is exactly
// where setLyric broke the lyric up in the first place — a gap in the tune is
// where a singer breathes, and it is where a subtitle should change.

import { arrange, passSteps } from './arrange.js';
import { PHRASE_GAP } from './vocal.js';

/**
 * Puts the sung notes of one pass back together as lines of words.
 *
 * A word is several syllables and a syllable is sometimes several notes, so
 * this walks the notes and closes a word wherever the setting said the word
 * ended. A held vowel — a melisma — is not a second word; it only makes the
 * one it belongs to last longer, which is why the ribbon keeps a long note lit.
 *
 * @param {Array<{step:number, length:number, syllable?:object}>} notes as arranged
 * @param {{offset?: number, span?: number}} [opts] `offset` is added to every
 *   step, for a block laid down later in the song; `span` is how long one pass
 *   of the tune is, so that a melody repeating under a longer drum pattern
 *   starts a new line each time round rather than running on
 * @returns {Array<{start:number, end:number, text:string,
 *   words:Array<{text:string, start:number, end:number}>}>}
 */
export function lyricLines(notes = [], { offset = 0, span = 0 } = {}) {
  const sung = notes.filter((note) => note.syllable)
    .sort((a, b) => a.step - b.step || (a.midi ?? 0) - (b.midi ?? 0));
  const lines = [];
  let line = null;
  let word = null;
  let previousEnd = null;

  const closeWord = () => {
    if (line && word) line.words.push(word);
    word = null;
  };
  const closeLine = () => {
    closeWord();
    if (line?.words.length) {
      line.text = line.words.map((w) => w.text).join(' ');
      lines.push(line);
    }
    line = null;
  };

  let pass = 0;
  for (const note of sung) {
    const start = note.step + offset;
    const end = start + note.length;
    // A rest long enough to breathe in ends the line, whatever the words were
    // doing — which is the same rule the words were set by. So does coming
    // round again: the tune starting over is a new line even if it does so on
    // the very next step.
    const round = span > 0 ? Math.floor(note.step / span) : 0;
    if (round !== pass) closeLine();
    else if (previousEnd != null && note.step - previousEnd >= PHRASE_GAP) closeLine();
    pass = round;
    previousEnd = Math.max(previousEnd ?? 0, note.step + note.length);

    if (!line) line = { start, end, text: '', words: [] };
    // A word ends where the setting says it ends — but a note whose syllable
    // belongs to a different word has plainly started one, which is what
    // happens when a line runs out mid-word and the next phrase carries on.
    if (word && word.text !== note.syllable.word) closeWord();
    if (!word) word = { text: note.syllable.word, start, end };
    word.end = Math.max(word.end, end);
    line.end = Math.max(line.end, end);
    if (note.syllable.wordEnd) closeWord();
  }
  closeLine();
  return lines;
}

/**
 * Every line the song sings, in order, in the same step positions the
 * transport counts in.
 *
 * Sections are walked the way the arranger walks them — one block at a time,
 * each repeat laid down after the last — rather than read off the flattened
 * result, so a line never runs from the end of one section into the start of
 * the next, and a repeated chorus gets its own subtitle every time round.
 *
 * @param {object} song the same object handed to AudioEngine#play
 * @returns {{lines: Array<object>, totalSteps: number}}
 */
export function lyricTimeline(song) {
  if (Array.isArray(song?.sections) && song.sections.length) {
    const lines = [];
    let offset = 0;
    for (const section of song.sections) {
      const block = arrange({ ...section, sections: undefined });
      const repeats = Math.max(1, Math.round(section.repeats || 1));
      const span = passSteps(section);
      for (let pass = 0; pass < repeats; pass++) {
        lines.push(...lyricLines(block.melody, { offset, span }));
        offset += block.totalSteps;
      }
    }
    return { lines, totalSteps: offset };
  }
  const { melody, totalSteps } = arrange(song || {});
  return { lines: lyricLines(melody, { span: passSteps(song) }), totalSteps };
}

/**
 * Which line has started by `step` — the one a sing-along should be showing.
 *
 * The last line to have begun stays on screen until the next one begins, the
 * way a subtitle does: a line does not blink out the instant the singer stops,
 * because you are still reading it.
 *
 * @returns {number} an index, or -1 before the first line
 */
export function lineAt(lines = [], step = -1) {
  if (!(step >= 0)) return -1;
  let index = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].start > step) break;
    index = i;
  }
  return index;
}

/**
 * Which word of a line is in the singer's mouth at `step`.
 *
 * @returns {number} an index, or -1 before the line has started
 */
export function wordAt(line, step = -1) {
  if (!line || !(step >= 0)) return -1;
  let index = -1;
  for (let i = 0; i < line.words.length; i++) {
    if (line.words[i].start > step) break;
    index = i;
  }
  return index;
}
