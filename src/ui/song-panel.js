// The Song tab: a drawer of saved sections, and the running order you build
// out of them.

import { $, el, fillSelect, toast } from './dom.js';
import {
  buildSongPlan,
  clone,
  forkSection,
  kindLabel,
  makeSection,
  nextSectionName,
  SECTION_KINDS,
  sectionSteps,
} from '../music/sections.js';
import { chordSymbol, keyUsesFlats, noteName } from '../music/theory.js';
import { meterInfo } from '../music/meter.js';
import { melodyEditCount } from '../music/melody.js';
import {
  bassInstrument,
  drumKit,
  harmonyInstrument,
  leadInstrument,
  resolveInstruments,
} from '../music/instruments.js';

/**
 * @param {object} ctx app context
 * @param {{chords: object, rhythm: object}} panels the other tabs, so loading a
 *   section can push its settings back into their controls
 */
export function initSong(ctx, panels) {
  const { state, save } = ctx;

  const ui = {
    name: $('#section-name'),
    kind: $('#section-kind'),
    kindHint: $('#section-kind-hint'),
    status: $('#current-section-status'),
    saveSection: $('#save-section'),
    saveQuick: $('#save-section-quick'),
    updateSection: $('#update-section'),
    forkSection: $('#fork-section'),
    playSong: $('#play-song'),
    exportSong: $('#export-song-midi'),
    autofill: $('#autofill-song'),
    clearSong: $('#clear-song'),
    sections: $('#sections-out'),
    arrangement: $('#arrangement-out'),
    summary: $('#song-summary'),
  };

  fillSelect(ui.kind, SECTION_KINDS.map((k) => ({ value: k.id, label: k.label })), 'main');

  const current = () => state.sections.find((s) => s.id === state.currentSectionId) || null;

  /** Bars, rounded — the unit people actually talk in, in the meter they set. */
  const bars = (steps) => Math.max(1, Math.round(steps / meterInfo(state.meter).stepsPerBar));

  function summarise(section) {
    const music = section.music || {};
    const flats = keyUsesFlats(music.rootPc ?? 0, music.scaleId);
    const sound = resolveInstruments(music, section.rhythm);
    return {
      key: `${noteName(music.rootPc ?? 0, flats)} ${music.scaleId || ''}`.trim(),
      chords: (music.chords || []).map((c) => chordSymbol(c, flats)).join(' '),
      bars: bars(sectionSteps(section)),
      notes: (music.melody || []).length,
      edits: melodyEditCount(music.melodyEdits),
      bass: music.bassOn === false ? 0 : (music.bass || []).length,
      // Sections carry their own voices, so the shelf has to say which.
      voices: [
        leadInstrument(sound.lead).label,
        harmonyInstrument(sound.harmony).label,
        ...(music.bassOn === false ? [] : [bassInstrument(sound.bass).label]),
        drumKit(sound.kit).label,
      ].join(' · '),
    };
  }

  // --- saving and loading ---------------------------------------------------

  function snapshot(name, kind) {
    return makeSection({ name, kind, music: state.music, rhythm: state.rhythm });
  }

  function saveSection({ kind = ui.kind.value, name = ui.name.value.trim() } = {}) {
    if (!state.music.chords.length) return toast('Generate a progression first');
    // The name box shows whichever section is open, so a name that is still the
    // one it came with means "you pick" — otherwise saving A twice gives two As.
    const fresh = !name || name === current()?.name;
    const section = snapshot(fresh ? nextSectionName(state.sections, kind) : name, kind);
    state.sections.push(section);
    state.currentSectionId = section.id;
    // Newly saved sections join the running order, so the song grows as you work.
    state.arrangement.push({ sectionId: section.id, repeats: 1 });
    render();
    save();
    toast(`Saved section ${section.name}`);
    return undefined;
  }

  function updateSection() {
    const section = current();
    if (!section) return;
    Object.assign(section, {
      name: ui.name.value.trim() || section.name,
      kind: ui.kind.value,
      music: clone(state.music),
      rhythm: clone(state.rhythm),
      savedAt: Date.now(),
    });
    render();
    save();
    toast(`Updated ${section.name}`);
  }

  function loadSection(section, { announce = true } = {}) {
    // The panels hold a reference to state.music and state.rhythm, so the
    // snapshot has to be poured into those objects rather than replacing them.
    Object.assign(state.music, clone(section.music));
    Object.assign(state.rhythm, clone(section.rhythm));
    state.currentSectionId = section.id;
    panels.chords.applyState();
    panels.rhythm.applyState();
    render();
    save();
    if (announce) toast(`Editing ${section.name}`);
  }

  function fork(section, { reroll = false } = {}) {
    const copy = forkSection(section, state.sections);
    state.sections.push(copy);
    state.arrangement.push({ sectionId: copy.id, repeats: 1 });
    loadSection(copy, { announce: false });
    // "Fork a variation" is the useful version of a fork: same chords, same
    // settings, a new roll of the melody dice.
    if (reroll) {
      panels.chords.rerollMelody();
      copy.music = clone(state.music);
      copy.rhythm = clone(state.rhythm);
    }
    render();
    save();
    toast(`Forked ${section.name} → ${copy.name}`);
    return copy;
  }

  function removeSection(section) {
    state.sections = state.sections.filter((s) => s.id !== section.id);
    state.arrangement = state.arrangement.filter((item) => item.sectionId !== section.id);
    if (state.currentSectionId === section.id) state.currentSectionId = null;
    render();
    save();
  }

  // --- arrangement ----------------------------------------------------------

  function addToSong(section) {
    state.arrangement.push({ sectionId: section.id, repeats: 1 });
    render();
    save();
  }

  function moveItem(index, delta) {
    const to = index + delta;
    if (to < 0 || to >= state.arrangement.length) return;
    const [item] = state.arrangement.splice(index, 1);
    state.arrangement.splice(to, 0, item);
    render();
    save();
  }

  function setRepeats(index, delta) {
    const item = state.arrangement[index];
    item.repeats = Math.max(1, Math.min(16, (item.repeats || 1) + delta));
    render();
    save();
  }

  function autofill() {
    if (!state.sections.length) return toast('Save a section first');
    const of = (kind) => state.sections.filter((s) => s.kind === kind);
    const order = [
      ...of('intro'),
      ...of('main'),
      ...of('bridge'),
      ...of('outro'),
    ];
    state.arrangement = order.map((s) => ({ sectionId: s.id, repeats: 1 }));
    render();
    save();
    return undefined;
  }

  // --- rendering ------------------------------------------------------------

  function renderSections() {
    if (!state.sections.length) {
      ui.sections.replaceChildren(el('p', { class: 'hint' }, [
        'Nothing saved yet. Build something on the Chords & melody tab, then press “Save as section”.',
      ]));
      return;
    }

    ui.sections.replaceChildren(...state.sections.map((section) => {
      const info = summarise(section);
      const isCurrent = section.id === state.currentSectionId;
      return el('div', {
        class: `section-card kind-${section.kind}${isCurrent ? ' is-current' : ''}`,
      }, [
        el('div', { class: 'section-head' }, [
          el('span', { class: 'section-name', text: section.name }),
          el('span', { class: 'section-kind', text: kindLabel(section.kind) }),
        ]),
        el('div', { class: 'section-meta', text: `${info.key} · ${info.bars} bars · ${info.notes} notes${info.edits ? ` · ${info.edits} hand-edited` : ''}${info.bass ? ` · ${info.bass} on the bass` : ''}` }),
        el('div', { class: 'section-chords', text: info.chords || '—' }),
        el('div', { class: 'section-meta', text: info.voices }),
        el('div', { class: 'section-actions' }, [
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Add it to the running order', onclick: () => addToSong(section),
          }, ['＋ Song']),
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Open it in the other tabs', onclick: () => loadSection(section),
          }, ['Edit']),
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Copy it into a new section', onclick: () => fork(section),
          }, ['Fork']),
          el('button', {
            type: 'button',
            class: 'btn ghost danger',
            title: 'Delete this section',
            onclick: () => removeSection(section),
          }, ['🗑']),
        ]),
      ]);
    }));
  }

  function renderArrangement() {
    const plan = buildSongPlan(state.sections, state.arrangement);

    if (!plan.blocks.length) {
      ui.arrangement.replaceChildren(el('p', { class: 'hint' }, [
        'No running order yet. Add sections with “＋ Song”, or press Auto-arrange.',
      ]));
      ui.summary.textContent = '';
      return plan;
    }

    ui.arrangement.replaceChildren(...plan.blocks.map((block, index) => el('div', {
      class: `song-chip kind-${block.kind}`,
      dataset: { index: String(index) },
    }, [
      el('div', { class: 'chip-head' }, [
        el('button', {
          type: 'button', class: 'chip-btn', title: 'Move earlier', onclick: () => moveItem(index, -1),
        }, ['‹']),
        el('span', { class: 'chip-name', text: block.name }),
        el('button', {
          type: 'button', class: 'chip-btn', title: 'Move later', onclick: () => moveItem(index, 1),
        }, ['›']),
      ]),
      el('div', { class: 'chip-repeats' }, [
        el('button', { type: 'button', class: 'chip-btn', title: 'Fewer repeats', onclick: () => setRepeats(index, -1) }, ['−']),
        el('span', { text: `×${block.repeats}` }),
        el('button', { type: 'button', class: 'chip-btn', title: 'More repeats', onclick: () => setRepeats(index, 1) }, ['+']),
      ]),
      el('div', { class: 'chip-bars', text: `${bars(block.length)} bars` }),
      el('button', {
        type: 'button',
        class: 'chip-remove',
        title: 'Take it out of the song',
        onclick: () => {
          state.arrangement.splice(index, 1);
          render();
          save();
        },
      }, ['✕']),
    ])));

    ui.summary.textContent = `${plan.blocks.length} parts · ${bars(plan.totalSteps)} bars · `
      + `${plan.blocks.map((b) => (b.repeats > 1 ? `${b.name}×${b.repeats}` : b.name)).join(' → ')}`;
    return plan;
  }

  function renderCurrent() {
    const section = current();
    ui.updateSection.disabled = !section;
    ui.forkSection.disabled = !section;
    if (section) {
      ui.status.textContent = `You are editing section ${section.name}. “Update” writes your changes back to it; “Save as section” files a new one and leaves ${section.name} alone.`;
      if (document.activeElement !== ui.name) ui.name.value = section.name;
      ui.kind.value = section.kind;
    } else {
      ui.status.textContent = 'Nothing saved yet — what is open in the other tabs is a loose idea.';
      if (document.activeElement !== ui.name) {
        ui.name.value = '';
        ui.name.placeholder = nextSectionName(state.sections, ui.kind.value);
      }
    }
    ui.kindHint.textContent = SECTION_KINDS.find((k) => k.id === ui.kind.value)?.hint || '';
  }

  function render() {
    renderSections();
    renderArrangement();
    renderCurrent();
    ctx.onSongChange?.();
  }

  // --- events ---------------------------------------------------------------

  ui.saveSection.addEventListener('click', () => saveSection());
  ui.saveQuick.addEventListener('click', () => saveSection({ name: '' }));
  ui.updateSection.addEventListener('click', updateSection);
  ui.forkSection.addEventListener('click', () => {
    const section = current();
    if (section) fork(section, { reroll: true });
  });
  ui.kind.addEventListener('change', () => {
    // Re-labelling the open section is an edit to it, not a new one — otherwise
    // the select would snap straight back on the next render.
    const section = current();
    if (section) {
      section.kind = ui.kind.value;
      save();
      render();
    } else {
      renderCurrent();
    }
  });
  ui.name.addEventListener('change', () => { if (current()) updateSection(); });
  ui.autofill.addEventListener('click', autofill);
  ui.clearSong.addEventListener('click', () => {
    state.arrangement = [];
    render();
    save();
  });
  ui.playSong.addEventListener('click', () => ctx.playSong());
  ui.exportSong.addEventListener('click', () => ctx.exportSong());

  render();

  return {
    render,
    plan: () => buildSongPlan(state.sections, state.arrangement),
    highlight(step) {
      const plan = buildSongPlan(state.sections, state.arrangement);
      const index = step < 0 ? -1 : plan.blocks.findIndex(
        (b) => step >= b.start && step < b.start + b.length,
      );
      for (const chip of ui.arrangement.children) {
        chip.classList?.toggle('is-playing', Number(chip.dataset.index) === index);
      }
    },
  };
}
