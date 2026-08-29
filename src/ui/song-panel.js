// The Song tab: a drawer of saved sections, and the running order you build
// out of them.

import {
  $, bindSlider, el, fillSelect, toast,
} from './dom.js';
import {
  buildSongPlan,
  clone,
  forkSection,
  kindLabel,
  clockTime,
  makeSection,
  nextSectionName,
  planSeconds,
  SECTION_KINDS,
  sectionSteps,
} from '../music/sections.js';
import {
  composeSong,
  FORMS,
  formsFor,
  LETTER_RANGE,
  normalizeComposeSettings,
} from '../music/compose.js';
import { allAspects, describeAspects, regenerateSection } from '../music/regenerate.js';
import { initRegenerateDialog } from './regenerate-dialog.js';
import { randomSeed } from '../rng.js';
import { chordSymbol, keyLabel, keyUsesFlats } from '../music/theory.js';
import { meterInfo, meterLabel } from '../music/meter.js';
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
    exportSongAudio: $('#export-song-audio'),
    prevSection: $('#prev-section'),
    nextSection: $('#next-section'),
    autofill: $('#autofill-song'),
    clearSong: $('#clear-song'),
    sections: $('#sections-out'),
    arrangement: $('#arrangement-out'),
    summary: $('#song-summary'),
    compose: $('#compose-song'),
    letters: $('#compose-letters'),
    minutes: $('#compose-minutes'),
    form: $('#compose-form'),
    formHint: $('#compose-form-hint'),
    contrast: $('#compose-contrast'),
    variation: $('#compose-variation'),
    intro: $('#compose-intro'),
    outro: $('#compose-outro'),
    fade: $('#compose-fade'),
    modulate: $('#compose-modulate'),
    meterShifts: $('#compose-meter'),
    tempoShifts: $('#compose-tempo-shifts'),
    pickTempo: $('#compose-pick-tempo'),
    composeSeed: $('#compose-seed'),
    sing: $('#compose-sing'),
    singHint: $('#compose-sing-hint'),
    newComposeSeed: $('#new-compose-seed'),
    replace: $('#compose-replace'),
    composeSummary: $('#compose-summary'),
  };

  fillSelect(ui.kind, SECTION_KINDS.map((k) => ({ value: k.id, label: k.label })), 'main');

  const current = () => state.sections.find((s) => s.id === state.currentSectionId) || null;

  /** Bars, rounded — the unit people actually talk in, in the meter they set. */
  const bars = (steps, meter) => Math.max(1, Math.round(steps / meterInfo(meter || state.meter).stepsPerBar));

  /** How long the arrangement lasts, sections taken at their own tempo. */
  const songSeconds = (plan) => planSeconds(plan, state.tempo);

  function summarise(section) {
    const music = section.music || {};
    const flats = keyUsesFlats(music.rootPc ?? 0, music.scaleId);
    const sound = resolveInstruments(music, section.rhythm);
    return {
      key: keyLabel(music.rootPc ?? 0, music.scaleId),
      chords: (music.chords || []).map((c) => chordSymbol(c, flats)).join(' '),
      bars: bars(sectionSteps(section), section.meter),
      // Only worth saying when the section brought its own bar with it.
      meter: section.meter ? ` of ${meterLabel(section.meter)}` : '',
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
    // The time signature is global, but a saved idea is not: a section written
    // in 7/8 is still in 7/8 after the transport has moved on.
    return makeSection({
      name, kind, music: state.music, rhythm: state.rhythm, meter: state.meter,
    });
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
      // Whatever bar it is being counted in now is the bar it was written in.
      meter: { ...state.meter },
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
    // A section counted in another bar brings its bar with it, or the panels
    // would draw its parts on a grid they were never written for. The parts
    // themselves are left exactly as they are — this is opening a section, not
    // recounting it.
    const changed = section.meter && (section.meter.beats !== state.meter.beats
      || section.meter.unit !== state.meter.unit);
    if (changed) state.meter = { ...section.meter };
    panels.chords.applyState();
    panels.rhythm.applyState();
    if (changed) ctx.onTransportChange?.();
    render();
    save();
    if (announce) {
      toast(changed
        ? `Editing ${section.name} — counted in ${meterLabel(section.meter)}`
        : `Editing ${section.name}`);
    }
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

  /**
   * Rolls a section again — the button on every card.
   *
   * The section keeps its id, so it keeps its place in the running order and
   * every repeat of it changes together: rolling the chorus rolls all four
   * choruses, which is what you meant. Asking for a fork instead files the new
   * take beside the old one, which is what you meant when you were not sure.
   */
  function regenerate(section, options = {}) {
    const { fork: asFork = false, ...rest } = options;
    const aspects = rest.aspects || allAspects();
    const rolled = regenerateSection(section, rest);

    if (asFork) {
      const copy = forkSection(rolled, state.sections);
      state.sections.push(copy);
      state.arrangement.push({ sectionId: copy.id, repeats: 1 });
      render();
      save();
      toast(`Rolled ${describeAspects(aspects)} → ${copy.name}`);
      ctx.refreshPlayback?.();
      return copy;
    }

    const index = state.sections.findIndex((s) => s.id === section.id);
    if (index < 0) return null;
    state.sections[index] = rolled;
    // The tabs are showing this section, so they have to be shown the new one.
    if (state.currentSectionId === rolled.id) loadSection(rolled, { announce: false });
    render();
    save();
    toast(`${rolled.name}: rolled ${describeAspects(aspects)}`);
    ctx.refreshPlayback?.();
    return rolled;
  }

  const regenDialog = initRegenerateDialog((section, options) => regenerate(section, options));

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
    // Re-laying the running order should not quietly undo what a section was
    // already doing in it — how many times it went round, and whether it faded.
    const before = new Map(state.arrangement.map((item) => [item.sectionId, item]));
    state.arrangement = order.map((s) => ({
      sectionId: s.id,
      repeats: before.get(s.id)?.repeats || 1,
      ...(before.get(s.id)?.fade ? { fade: before.get(s.id).fade } : {}),
    }));
    render();
    save();
    return undefined;
  }

  // --- composing ------------------------------------------------------------

  fillSelect(ui.letters, [
    { value: 0, label: '🎲 Let the seed decide' },
    ...Array.from({ length: LETTER_RANGE[1] - LETTER_RANGE[0] + 1 }, (_, i) => {
      const count = LETTER_RANGE[0] + i;
      return { value: count, label: `${count} sections` };
    }),
  ], state.compose.letters);
  bindSlider(ui.contrast, $('#out-compose-contrast'), (v) => `${Math.round(Number(v) * 100)}%`);
  bindSlider(ui.variation, $('#out-compose-variation'), (v) => `${Math.round(Number(v) * 100)}%`);

  /** The shapes you can ask for, which depend on how many ideas you want. */
  function syncForms() {
    const letters = Number(ui.letters.value);
    const options = letters ? formsFor(letters) : FORMS;
    fillSelect(ui.form, [
      { value: 'auto', label: '🎲 Let the seed decide' },
      ...options.map((form) => ({ value: form.id, label: form.label })),
    ], state.compose.form);
    const chosen = FORMS.find((form) => form.id === ui.form.value);
    const spelled = chosen?.shape.map((index) => String.fromCharCode(65 + index)).join(' ');
    ui.formHint.textContent = chosen
      ? `${spelled} — before the intro, the coda and any repeats.`
      : 'A shape is picked to suit the number of ideas: AABA, ABABCB, a rondo.';
  }

  /** What the controls currently say, normalised the way the composer wants it. */
  function readCompose() {
    return normalizeComposeSettings({
      seed: ui.composeSeed.value.trim(),
      letters: Number(ui.letters.value),
      form: ui.form.value,
      minutes: Number(ui.minutes.value),
      intro: ui.intro.checked,
      outro: ui.outro.checked,
      fade: ui.fade.checked,
      contrast: Number(ui.contrast.value),
      variation: Number(ui.variation.value),
      modulate: ui.modulate.checked,
      meterShifts: ui.meterShifts.checked,
      tempoShifts: ui.tempoShifts.checked,
      pickTempo: ui.pickTempo.checked,
    });
  }

  function writeCompose() {
    const settings = state.compose;
    ui.letters.value = String(settings.letters);
    ui.minutes.value = String(settings.minutes);
    ui.contrast.value = String(settings.contrast);
    ui.variation.value = String(settings.variation);
    for (const [box, value] of [
      [ui.intro, settings.intro], [ui.outro, settings.outro], [ui.fade, settings.fade],
      [ui.modulate, settings.modulate], [ui.meterShifts, settings.meterShifts],
      [ui.tempoShifts, settings.tempoShifts], [ui.pickTempo, settings.pickTempo],
    ]) box.checked = value;
    ui.composeSeed.value = settings.seed;
    for (const slider of [ui.contrast, ui.variation]) slider.dispatchEvent(new Event('input'));
    syncForms();
    syncSing();
  }

  /**
   * The Voice box lives on the Chords tab, next to the melody it sings and the
   * piano roll that shows the words on it — but composing happens here, and a
   * switch you cannot see is a feature you do not know about. So this is the
   * same switch, shown where it is needed, and it says what it is going to do.
   */
  function syncSing() {
    const vocal = state.music.vocal || {};
    ui.sing.checked = Boolean(vocal.on);
    const lines = (vocal.lines || []).filter(Boolean).length;
    if (!vocal.on) {
      ui.singHint.textContent = 'Off — it writes an instrumental. '
        + 'The singer, the words and the vocoder are on the Chords tab.';
    } else if (!lines) {
      ui.singHint.textContent = 'On, but there are no words yet — '
        + 'cut some up on the Words tab first.';
    } else {
      ui.singHint.textContent = `Each idea gets its own share of the ${lines} `
        + `line${lines === 1 ? '' : 's'} you have, and the words are frozen into it.`;
    }
  }

  /**
   * Writes a whole song. What comes back is an ordinary drawer of sections and
   * an ordinary running order — the composer has no privileged state — so every
   * part of it can be opened, rolled again, dragged about or thrown away.
   */
  function compose() {
    const settings = readCompose();
    const result = composeSong({
      settings,
      tempo: state.tempo,
      meter: state.meter,
      // It starts where you are: the key on the Chords tab is the home key.
      rootPc: state.music.rootPc,
      scaleId: state.music.scaleId,
      // And it writes with whatever ears have been trained on the Train tab.
      // A model that has not beaten a coin gates itself to nothing, so on a
      // fresh checkout this line changes precisely nothing.
      taste: ctx.taste?.(),
      tasteStrength: state.tasteStrength ?? 1,
      // And it sings, if the Voice box is on — a share of the lyric per idea.
      vocal: state.music.vocal,
    });

    if (ui.replace.checked) {
      state.sections = [];
      state.arrangement = [];
      state.currentSectionId = null;
    }
    state.sections.push(...result.sections);
    state.arrangement.push(...result.arrangement);
    state.tempo = result.tempo;
    // The seed of the song you just heard, so it can be typed back in.
    state.compose = { ...settings, seed: result.seed };
    ui.composeSeed.value = result.seed;
    ctx.onTransportChange?.();
    lastTaste = result.taste;
    render();
    save();
    toast(`${result.summary} — ${clockTime(result.seconds)}`);
  }

  /** What the trained model did to the last song, if it had any say in it. */
  let lastTaste = null;

  function describeComposition() {
    const plan = buildSongPlan(state.sections, state.arrangement);
    if (!plan.blocks.length) {
      ui.composeSummary.textContent = 'Nothing composed yet — it starts from the key '
        + 'you have open on the Chords tab.';
      return;
    }
    // A model that had a say should say so: an audition that happened silently
    // is indistinguishable from a Train tab that is not plugged in.
    const ears = lastTaste
      ? ` · each idea picked from ${lastTaste.auditioned}, at ${Math.round(lastTaste.weight * 100)}% say`
      : '';
    ui.composeSummary.textContent = `${clockTime(songSeconds(plan))} · ${plan.blocks.length} parts`
      + `${state.compose.seed ? ` · seed ${state.compose.seed}` : ''}${ears}`;
  }

  // --- rendering ------------------------------------------------------------

  /** The line under a composed card: what it is, and how it is played. */
  function sectionTraits(section) {
    const traits = [...(section.traits || [])];
    const percent = (value) => `${Math.round(value * 100)}%`;
    const dynamics = section.dynamics ?? 1;
    if (dynamics < 0.98 || dynamics > 1.02) traits.push(`played at ${percent(dynamics)}`);
    const tempoScale = section.tempoScale ?? 1;
    if (tempoScale !== 1) traits.push(`taken at ${percent(tempoScale)} of the tempo`);
    return traits;
  }

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
        el('div', { class: 'section-meta', text: `${info.key} · ${info.bars} bars${info.meter} · `
          + `${info.notes} notes${info.edits ? ` · ${info.edits} hand-edited` : ''}`
          + `${info.bass ? ` · ${info.bass} on the bass` : ''}` }),
        el('div', { class: 'section-chords', text: info.chords || '—' }),
        el('div', { class: 'section-meta', text: info.voices }),
        // A composed section says what makes it different from the others.
        section.traits?.length
          ? el('div', { class: 'section-traits', text: sectionTraits(section).join(' · ') })
          : null,
        el('div', { class: 'section-actions' }, [
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Play just this section', onclick: () => ctx.playCards?.([section], { meter: section.meter }),
          }, ['▶']),
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Add it to the running order', onclick: () => addToSong(section),
          }, ['＋ Song']),
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Open it in the other tabs', onclick: () => loadSection(section),
          }, ['Edit']),
          el('button', {
            type: 'button', class: 'btn ghost', title: 'Copy it into a new section', onclick: () => fork(section),
          }, ['Fork']),
          // Two halves: roll the lot, or say what to roll. The second is the
          // one you reach for once you like something about what you have.
          el('div', { class: 'split-btn' }, [
            el('button', {
              type: 'button',
              class: 'btn ghost split-main',
              title: 'Roll the whole thing again — new chords, tune, bass, drums and voices',
              onclick: () => regenerate(section, { aspects: allAspects() }),
            }, ['↻ Regenerate']),
            el('button', {
              type: 'button',
              class: 'btn ghost split-more',
              title: 'Choose what to roll — and the key to roll it into',
              'aria-label': `Choose what to regenerate in section ${section.name}`,
              onclick: () => regenDialog.open(section),
            }, ['▾']),
          ]),
          el('button', {
            type: 'button',
            class: 'btn ghost',
            title: 'Render this section on its own as an audio file',
            onclick: () => ctx.exportSectionAudio?.(section),
          }, ['⤓ Audio']),
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
    ui.prevSection.disabled = !plan.blocks.length;
    ui.nextSection.disabled = !plan.blocks.length;

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
      el('div', {
        class: 'chip-bars',
        text: `${bars(block.length, block.meter)} bars${block.fade ? ' · fades' : ''}`,
      }),
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

    ui.summary.textContent = `${plan.blocks.length} parts · ${clockTime(songSeconds(plan))} · `
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
    describeComposition();
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
  ui.compose.addEventListener('click', compose);
  ui.letters.addEventListener('change', () => {
    state.compose = readCompose();
    // A shape needs as many ideas as it has letters, so the list is rebuilt.
    state.compose.form = 'auto';
    syncForms();
    save();
  });
  ui.form.addEventListener('change', () => {
    state.compose = readCompose();
    syncForms();
    save();
  });
  for (const input of [
    ui.minutes, ui.contrast, ui.variation, ui.intro, ui.outro, ui.fade,
    ui.modulate, ui.meterShifts, ui.tempoShifts, ui.pickTempo, ui.composeSeed,
  ]) {
    input.addEventListener('change', () => {
      state.compose = readCompose();
      save();
    });
  }
  ui.newComposeSeed.addEventListener('click', () => {
    ui.composeSeed.value = randomSeed();
    state.compose = readCompose();
    save();
  });
  ui.playSong.addEventListener('click', () => ctx.playSong());
  ui.exportSong.addEventListener('click', () => ctx.exportSong());
  ui.exportSongAudio.addEventListener('click', () => ctx.exportSongAudio());
  ui.prevSection.addEventListener('click', () => ctx.skipSection(-1));
  ui.nextSection.addEventListener('click', () => ctx.skipSection(1));

  ui.sing.addEventListener('change', () => {
    state.music.vocal = { ...state.music.vocal, on: ui.sing.checked };
    syncSing();
    save();
    // The Chords tab owns this control; it has to be told its own box moved.
    ctx.onVocalChange?.();
    ctx.refreshPlayback?.();
  });

  writeCompose();
  render();

  return {
    render,
    /** The Chords tab's Voice box changed; this tab shows the same switch. */
    syncSing,
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
