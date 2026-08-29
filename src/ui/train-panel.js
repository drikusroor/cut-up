// The Train tab: a card game you play against your own taste.
//
// The machine deals two or three sections out of the composer's own deck and
// plays them to you. You say what you think — of the tune, of the changes, of
// the groove, of the whole thing, and of whether the two belong in the same
// song. Then it deals again. Do that for twenty minutes and there is a file
// full of your opinions; press Train and there is a model that has read them.
//
// The design constraint is the grind. Nobody is going to rate four hundred
// rounds through a form with a Submit button, so the whole tab is built to be
// played with one hand on the number row: 1 to 5 answers the question the
// cursor is on and moves to the next, Space plays whatever the cursor is
// looking at, Enter deals again. The mouse works, but it is the slow path.
//
// Everything on the table is an ordinary section, so any hand that turns out to
// contain something you actually want can be kept with one button and lands on
// the Song tab like anything else you saved.
//
// This tab is not the only way in, though, and for most people it will not be
// the main one. The 👍 and 👎 on the Song and Library tabs write to the same
// file — see ui/marks.js — and this module owns them, because it owns the store
// they go to. They say much less than a hand does and are weighted to match:
// the point of them is that teaching the model becomes a side effect of using
// the app rather than a separate job of work.

import {
  $, download, el, toast,
} from './dom.js';
import { dealRound } from '../music/compose.js';
import { PAIR_HEAD, SECTION_HEADS } from '../ml/model.js';
import { MARK_RATINGS, RATINGS } from '../ml/judgements.js';
import { describeReport } from '../ml/train.js';
import { TasteStore } from '../ml/store.js';
import { chordSymbol, keyLabel, keyUsesFlats } from '../music/theory.js';
import { meterLabel, stepsPerBar } from '../music/meter.js';
import { sectionSteps } from '../music/sections.js';
import { randomSeed } from '../rng.js';

export function initTrain(ctx) {
  const { state, save } = ctx;
  const store = new TasteStore();

  const ui = {
    table: $('#train-table'),
    status: $('#train-status'),
    verdict: $('#train-verdict'),
    deal: $('#train-deal'),
    skip: $('#train-skip'),
    keep: $('#train-keep'),
    cards: $('#train-cards'),
    train: $('#train-fit'),
    exportBtn: $('#train-export'),
    importBtn: $('#train-import'),
    importFile: $('#train-import-file'),
    strength: $('#train-strength'),
    strengthOut: $('#out-train-strength'),
    detail: $('#train-detail'),
  };

  /** The hand on the table, and what has been said about it so far. */
  let hand = null;
  /** Every question in the hand, in the order the cursor walks them. */
  let questions = [];
  let cursor = 0;
  let rounds = 0;

  // --- dealing --------------------------------------------------------------

  function deal() {
    const cards = Math.random() < 0.25 ? 3 : 2;
    hand = dealRound({ seed: randomSeed(), cards });
    questions = [];
    for (const card of hand.cards) {
      for (const head of SECTION_HEADS) {
        questions.push({ kind: 'section', card: card.name, head: head.id, answer: null });
      }
    }
    for (let i = 1; i < hand.cards.length; i++) {
      questions.push({
        kind: 'join',
        from: hand.cards[i - 1].name,
        to: hand.cards[i].name,
        answer: null,
      });
    }
    cursor = 0;
    render();
  }

  // --- playing --------------------------------------------------------------

  function sectionsNamed(names) {
    return names
      .map((name) => hand?.cards.find((card) => card.name === name)?.section)
      .filter(Boolean);
  }

  function play(names) {
    const sections = sectionsNamed(names);
    if (!sections.length) return;
    ctx.playCards?.(sections, { tempo: hand.tempo, meter: hand.meter });
    highlightPlaying(names.join('>'));
  }

  let playing = null;
  function highlightPlaying(id) {
    playing = id;
    for (const node of ui.table.querySelectorAll('[data-play]')) {
      node.classList.toggle('is-playing', node.dataset.play === id);
    }
  }

  // --- answering ------------------------------------------------------------

  function answer(index, value) {
    const question = questions[index];
    if (!question) return;
    question.answer = value;
    // Straight on to the next unanswered one, so a whole hand is five
    // keystrokes and never a hunt for what is left.
    const next = questions.findIndex((q, i) => i > index && q.answer === null);
    cursor = next === -1 ? Math.min(questions.length - 1, index + 1) : next;
    render();
  }

  function answered() {
    return questions.filter((q) => q.answer !== null).length;
  }

  async function commit({ silent = false } = {}) {
    if (!hand || !answered()) return false;
    const sections = {};
    const joins = {};
    for (const question of questions) {
      if (question.answer === null) continue;
      if (question.kind === 'section') {
        sections[question.card] = { ...sections[question.card], [question.head]: question.answer };
      } else {
        joins[`${question.from}>${question.to}`] = question.answer;
      }
    }
    const where = await store.record({
      seed: hand.seed,
      cards: hand.cards.length,
      sections,
      joins,
      digest: `${hand.key} · ${hand.tempo}bpm · ${meterLabel(hand.meter)} · ${
        hand.cards.map((card) => `${card.name}(${card.relation})`).join(' ')}`,
    });
    rounds += 1;
    if (!silent) {
      toast(where === 'saved'
        ? `Round ${rounds} written to data/taste.jsonl`
        : `Round ${rounds} kept in this browser — export it when you are done`);
    }
    renderStatus();
    return true;
  }

  async function saveAndDeal() {
    if (!answered()) return toast('Nothing answered yet — Skip if you would rather not say');
    await commit();
    deal();
    return undefined;
  }

  /** The hand you liked enough to want. Lands on the Song tab like anything else. */
  function keep() {
    if (!hand) return;
    const kept = hand.cards.map((card) => card.section);
    state.sections.push(...kept);
    if (state.tempo !== hand.tempo) {
      state.tempo = hand.tempo;
      ctx.onTransportChange?.();
    }
    save();
    ctx.onSongChange?.();
    ctx.refreshSections?.();
    toast(`${kept.map((s) => s.name).join(' and ')} saved to the Song tab`);
  }

  // --- drawing the table ----------------------------------------------------

  function questionIndex(match) {
    return questions.findIndex((q) => (match.kind === 'section'
      ? q.kind === 'section' && q.card === match.card && q.head === match.head
      : q.kind === 'join' && q.from === match.from && q.to === match.to));
  }

  /** One row of five buttons. The cursor sits on exactly one row at a time. */
  function scale(index, label) {
    const question = questions[index];
    const active = index === cursor;
    return el('div', { class: `rate-row${active ? ' is-cursor' : ''}` }, [
      el('span', { class: 'rate-label', text: label }),
      el('div', { class: 'rate-buttons' }, RATINGS.map((rating, position) => el('button', {
        type: 'button',
        class: `rate-btn${question?.answer === rating.value ? ' is-on' : ''}`,
        title: `${rating.label} — ${rating.hint} (${position + 1})`,
        'aria-label': `${label}: ${rating.label}`,
        onclick: () => answer(index, rating.value),
      }, [rating.label]))),
    ]);
  }

  function describeCard(card) {
    const music = card.section.music || {};
    const flats = keyUsesFlats(music.rootPc ?? 0, music.scaleId);
    const bar = stepsPerBar(card.section.meter || { beats: 4, unit: 4 });
    return {
      key: keyLabel(music.rootPc ?? 0, music.scaleId),
      chords: (music.chords || []).map((chord) => chordSymbol(chord, flats)).join(' ') || 'no chords',
      notes: (music.melody || []).length,
      bars: Math.round(sectionSteps(card.section) / bar),
    };
  }

  function cardNode(card) {
    const info = describeCard(card);
    return el('div', { class: 'train-card' }, [
      el('div', { class: 'train-card-head' }, [
        el('span', { class: 'train-card-name', text: card.name }),
        el('button', {
          type: 'button',
          class: 'btn ghost train-play',
          dataset: { play: card.name },
          onclick: () => play([card.name]),
        }, ['▶ Play']),
      ]),
      el('div', { class: 'train-card-meta', text: `${info.key} · ${info.bars} bars · ${info.notes} notes` }),
      el('div', { class: 'train-card-chords', text: info.chords }),
      card.traits.length
        ? el('div', { class: 'train-card-traits', text: card.traits.join(' · ') })
        : null,
      el('div', { class: 'rate-block' }, SECTION_HEADS.map((head) => scale(
        questionIndex({ kind: 'section', card: card.name, head: head.id }),
        head.label,
      ))),
    ]);
  }

  function joinNode(from, to) {
    return el('div', { class: 'train-join' }, [
      el('div', { class: 'train-join-head' }, [
        el('span', { class: 'train-join-title', text: `${from} into ${to}` }),
        el('button', {
          type: 'button',
          class: 'btn ghost train-play',
          dataset: { play: `${from}>${to}` },
          onclick: () => play([from, to]),
        }, [`▶ Play ${from} → ${to}`]),
      ]),
      el('div', { class: 'rate-block' }, [
        scale(questionIndex({ kind: 'join', from, to }), PAIR_HEAD.question),
      ]),
    ]);
  }

  function render() {
    if (!hand) {
      ui.table.replaceChildren(el('p', { class: 'hint' }, ['Press Deal to start.']));
      return;
    }
    ui.cards.textContent = `${hand.key} · ${hand.tempo} bpm · ${meterLabel(hand.meter)} · seed ${hand.seed}`;
    const nodes = [el('div', { class: 'train-hand' }, hand.cards.map(cardNode))];
    for (let i = 1; i < hand.cards.length; i++) {
      nodes.push(joinNode(hand.cards[i - 1].name, hand.cards[i].name));
    }
    ui.table.replaceChildren(...nodes);
    highlightPlaying(playing);
    const left = questions.length - answered();
    ui.status.textContent = left
      ? `${answered()} of ${questions.length} answered — 1 to 5 to rate, Space to hear it, Enter to deal again`
      : 'All answered — Enter deals the next hand';
  }

  // --- the model ------------------------------------------------------------

  function renderStatus() {
    const where = store.recording
      ? 'Writing to data/taste.jsonl'
      : 'Read-only — judgements are kept in this browser until you export them';
    const stale = store.status === 'stale'
      ? ' · the committed model was fitted against different features and is being ignored until you retrain'
      : '';
    const marked = store.markCount;
    const dealt = store.count - marked;
    // Rounds and marks are counted apart, because they are not the same size of
    // opinion and a single total would make an afternoon of thumbs look like a
    // fortnight at the table.
    const tally = `${dealt} ${dealt === 1 ? 'round' : 'rounds'}`
      + (marked ? ` and ${marked} ${marked === 1 ? 'mark' : 'marks'}` : '');
    ui.verdict.textContent = `${tally} on file · ${where}${stale}`;
    ui.detail.textContent = describeReport(store.model.report);
  }

  async function fit() {
    if (store.count < 8) return toast('Rate a few more rounds first — it needs at least eight');
    ui.train.disabled = true;
    ui.train.textContent = 'Training…';
    // A tick, so the button repaints before the main thread goes away for a
    // few seconds. In the recording mode the work happens on the server and
    // this costs nothing.
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    try {
      const { report, written } = await store.train();
      renderStatus();
      toast(written ? 'Trained — models/taste.json rewritten, ready to commit' : 'Trained in the browser');
      ui.detail.textContent = describeReport(report);
      ctx.onTasteChange?.(store.model);
    } catch (error) {
      toast(`Training failed: ${error.message}`);
    } finally {
      ui.train.disabled = false;
      ui.train.textContent = 'Train the model';
    }
    return undefined;
  }

  // --- marks ----------------------------------------------------------------

  /**
   * The other way of teaching it, and the one you will actually use.
   *
   * The table is the thorough way: five deliberate answers about music you have
   * never heard, which is the best training data there is and is also twenty
   * minutes of work. Marks are the opposite trade. A thumb on a section in the
   * drawer or a song on the shelf is one click on music you were already
   * listening to for your own reasons, it says only "yes" or "no", and it is
   * weighted accordingly — see MARK_WEIGHTS. Do it for a month and the model
   * has heard a few hundred of your actual decisions without you ever having
   * opened this tab.
   *
   * The Song and Library tabs own the buttons; this owns the store, so this is
   * where the answer goes.
   */
  const marks = {
    /** What you already said about this music, or null. */
    of: (sections, order) => (store.ready ? store.markFor(sections, order) : null),

    /**
     * Says it, or takes it back — pressing the thumb that is already lit is how
     * you change your mind back to having no opinion, which is a thing the model
     * has to be able to be told.
     */
    async set(sections, rating, { name = '', digest = '', order = null } = {}) {
      if (!sections?.length) return null;
      const already = store.markFor(sections, order);
      if (already === rating) {
        store.unmark(sections, order);
        renderStatus();
        ctx.onMarksChange?.();
        toast(`${name || 'That'} — no opinion either way`);
        return null;
      }
      const where = await store.mark(sections, rating, { name, digest, order });
      renderStatus();
      ctx.onMarksChange?.();
      const said = rating >= 0.5 ? 'Good' : 'Not that';
      toast(where === 'saved'
        ? `${said} — written to data/taste.jsonl`
        : `${said} — kept in this browser until you export it`);
      return rating;
    },

    /** For the thumbs to draw themselves the right way round. */
    ratings: MARK_RATINGS,
  };

  // --- wiring ---------------------------------------------------------------

  ui.deal.addEventListener('click', saveAndDeal);
  ui.skip.addEventListener('click', deal);
  ui.keep.addEventListener('click', keep);
  ui.train.addEventListener('click', fit);
  ui.exportBtn.addEventListener('click', () => {
    if (!store.count) return toast('Nothing to export yet');
    download('taste.jsonl', store.exportText(), 'application/x-ndjson');
    return undefined;
  });
  ui.importBtn.addEventListener('click', () => ui.importFile.click());
  ui.importFile.addEventListener('change', async () => {
    const file = ui.importFile.files?.[0];
    if (!file) return;
    const added = await store.importText(await file.text());
    ui.importFile.value = '';
    renderStatus();
    toast(added ? `Merged ${added} rounds` : 'Nothing new in that file');
  });

  ui.strength.value = String(state.tasteStrength ?? 1);
  const renderStrength = () => {
    ui.strengthOut.textContent = `${Math.round(Number(ui.strength.value) * 100)}%`;
  };
  renderStrength();
  ui.strength.addEventListener('input', renderStrength);
  ui.strength.addEventListener('change', () => {
    state.tasteStrength = Number(ui.strength.value);
    save();
  });

  /**
   * The keyboard, which is the whole point. Only while the tab is open, and
   * never while something is being typed into.
   */
  document.addEventListener('keydown', (event) => {
    if (state.tab !== 'train' || !hand) return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) return;

    if (event.key >= '1' && event.key <= '5') {
      event.preventDefault();
      answer(cursor, RATINGS[Number(event.key) - 1].value);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      saveAndDeal();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      event.preventDefault();
      cursor = Math.min(questions.length - 1, cursor + 1);
      render();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      event.preventDefault();
      cursor = Math.max(0, cursor - 1);
      render();
    } else if (event.code === 'Space') {
      // Space plays whatever the cursor is looking at rather than the transport,
      // because on this tab the thing you want to hear is the thing you are
      // about to have an opinion about.
      event.preventDefault();
      const question = questions[cursor];
      play(question.kind === 'section' ? [question.card] : [question.from, question.to]);
    }
  });

  store.load().then(() => {
    renderStatus();
    ctx.onTasteChange?.(store.model);
    // The thumbs on the other tabs cannot know what you have already said until
    // the file has been read, so they are drawn again once it has.
    ctx.onMarksChange?.();
  });
  render();
  renderStatus();

  return {
    deal,
    /** The Song tab asks for this every time it composes. */
    model: () => store.model,
    /** And the Song and Library tabs put their thumbs through this. */
    marks,
    refresh: () => {
      if (!hand) deal();
      renderStatus();
    },
  };
}
