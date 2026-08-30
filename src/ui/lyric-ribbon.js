// The lichtkrant: the words going past, lit as they are sung.
//
// A vocoder is not a diction coach, and a synthesised voice singing a cut-up is
// hard to follow even when you wrote the cut-up. So the transport carries a
// strip of the lyric: the line being sung now, with the word in the singer's
// mouth lit up, and the line after it waiting underneath. It is the same
// information the piano roll has, read at a distance and in time.
//
// Nothing here decides anything. The words, the lines and their positions all
// come out of music/lyric-timeline.js, which reads them off the song that is
// actually playing — so the ribbon cannot disagree with what you are hearing.

import { $, el } from './dom.js';
import { lineAt, lyricTimeline, wordAt } from '../music/lyric-timeline.js';

export function initLyricRibbon(ctx) {
  const { state, save } = ctx;

  const ui = {
    wrap: $('#lyric-ribbon'),
    now: $('#lyric-now'),
    next: $('#lyric-next'),
    toggle: $('#lyric-toggle'),
  };

  /** The lines of whatever the transport is set to play, and where they fall. */
  let lines = [];
  /** What is on screen, so a frame that changes nothing touches no DOM. */
  let shown = { line: -2, word: -2 };

  const on = () => state.subtitles !== false;

  function syncToggle() {
    ui.toggle.setAttribute('aria-pressed', String(on()));
    ui.toggle.classList.toggle('is-on', on());
    ui.toggle.title = on()
      ? 'Hide the words while it plays'
      : 'Show the words as they are sung';
  }

  /** The ribbon is only worth the room it takes when there is a word in it. */
  function syncVisible() {
    const visible = on() && lines.length > 0;
    ui.wrap.hidden = !visible;
    document.body.classList.toggle('with-ribbon', visible);
  }

  /**
   * One line in a row. The line being sung is laid out word by word so each can
   * be lit on its own; the one underneath is only ever read, so it is one span.
   */
  function drawLine(node, line, { live = false } = {}) {
    node.disabled = !line;
    node.scrollLeft = 0;
    node.dataset.step = String(line?.start ?? 0);
    if (!line) {
      node.replaceChildren();
      return;
    }
    // Real spaces between the words rather than a gap made of padding, so the
    // line reads as a line to a screen reader and copies as one to a clipboard.
    node.replaceChildren(...(live
      ? line.words.flatMap((word, i) => [
        ...(i ? [' '] : []),
        el('span', { class: 'lyric-word', text: word.text }),
      ])
      : [el('span', { class: 'lyric-word', text: line.text })]));
  }

  /**
   * Draws the two rows for a position in the song.
   *
   * A line that has started stays on screen until the next one starts, the way
   * a subtitle does — you are still reading it after the singer has stopped.
   * Before the first line, and while the transport is stopped, the top row
   * shows what is coming rather than going blank.
   */
  function drawLines(index) {
    const pending = index < 0;
    const at = pending ? 0 : index;
    ui.wrap.classList.toggle('is-pending', pending);
    drawLine(ui.now, lines[at] || null, { live: !pending });
    drawLine(ui.next, lines[at + 1] || null);
  }

  /** Keeps the lit word in view when a line is longer than the bar is wide. */
  function scrollTo(span) {
    if (!span || ui.now.scrollWidth <= ui.now.clientWidth) return;
    const left = span.offsetLeft - (ui.now.clientWidth - span.offsetWidth) / 2;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ui.now.scrollTo({ left: Math.max(0, left), behavior: still ? 'auto' : 'smooth' });
  }

  /** Clicking a line plays from it — the words double as a way about the song. */
  function seek(node) {
    const step = Number(node.dataset.step);
    if (Number.isFinite(step)) ctx.seekTo?.(step);
  }

  for (const row of [ui.now, ui.next]) row.addEventListener('click', () => seek(row));

  ui.toggle.addEventListener('click', () => {
    state.subtitles = !on();
    // Turned off, the ribbon stops being told where the song has got to, so
    // what it is showing when it comes back on is out of date.
    shown = { line: -2, word: -2 };
    syncToggle();
    syncVisible();
    save();
  });

  syncToggle();
  syncVisible();

  return {
    /**
     * The transport is about to play this. The song is the same object the
     * audio engine is given, so the ribbon is reading the take you will hear —
     * muted parts and all, because a muted voice sings nothing.
     */
    setSong(song) {
      lines = song && song.parts?.vocal !== false ? lyricTimeline(song).lines : [];
      shown = { line: -2, word: -2 };
      syncVisible();
      if (lines.length) drawLines(-1);
    },

    /**
     * Where the playhead is, in steps — fractional, because a word is lit for a
     * fraction of a beat and the eye notices the difference. Below zero means
     * the transport is stopped, and the ribbon goes back to the top.
     */
    highlight(step) {
      if (!on() || !lines.length) return;
      const index = lineAt(lines, step);
      if (index !== shown.line) {
        shown.line = index;
        shown.word = -2;
        drawLines(index);
      }
      const word = wordAt(lines[index], step);
      if (word === shown.word) return;
      shown.word = word;
      const spans = ui.now.children;
      for (let i = 0; i < spans.length; i++) {
        spans[i].classList.toggle('is-sung', i < word);
        spans[i].classList.toggle('is-singing', i === word);
      }
      scrollTo(spans[word]);
    },
  };
}
