// The advanced half of the regenerate button.
//
// The left half of the button on a section card rolls everything and asks
// nothing; this is what the right half opens. It is the same call underneath —
// see music/regenerate.js — with the aspects, the key, the bar, the composer's
// own variations and the seed exposed, so "keep these chords but write me
// another tune over them, a fourth up, with no bass and played at 80%" is a
// handful of clicks rather than a rebuild.
//
// The variations are the interesting half. Everything in music/variations.js is
// drawn here, and each row knows what the section is currently doing: a section
// with no bass opens with "no bass" already ticked, and unticking it gives it one
// back. A move that cannot apply to this section — the tune an octave up, on a
// section with no tune — is shown greyed with the reason, rather than silently
// doing nothing when it is asked for.

import { $, el, fillSelect } from './dom.js';
import {
  allAspects, describeAspects, REGEN_ASPECTS,
} from '../music/regenerate.js';
import {
  DIALS, KEY_MOVES, keyMove, MOVES, SWITCHES, VARIATION_GROUPS, variationApplies,
} from '../music/variations.js';
import { keyLabel, SCALES, SHARP_NAMES } from '../music/theory.js';
import { METER_UNITS, meterLabel, normalizeMeter } from '../music/meter.js';
import { randomSeed } from '../rng.js';

const DEFAULT_METER = { beats: 4, unit: 4 };

/**
 * @param {(section: object, options: object) => void} onRegenerate what to do
 *   with the answer — the Song tab writes it back into the drawer
 */
export function initRegenerateDialog(onRegenerate) {
  const ui = {
    dialog: $('#regenerate-dialog'),
    scope: $('#regen-scope'),
    aspects: $('#regen-aspects'),
    root: $('#regen-root'),
    scale: $('#regen-scale'),
    keyMoves: $('#regen-key-moves'),
    keyHint: $('#regen-key-hint'),
    beats: $('#regen-meter-beats'),
    unit: $('#regen-meter-unit'),
    meterReset: $('#regen-meter-reset'),
    meterHint: $('#regen-meter-hint'),
    variations: $('#regen-variations'),
    seed: $('#regen-seed'),
    newSeed: $('#regen-new-seed'),
    fork: $('#regen-fork'),
    summary: $('#regen-summary'),
    close: $('#regen-close'),
    go: $('#regen-go'),
  };

  /** Which section is open in here. */
  let section = null;
  /** The bar it was written in, which is what "leave the bar alone" means. */
  let homeMeter = { ...DEFAULT_METER };

  const boxes = new Map();
  ui.aspects.replaceChildren(...REGEN_ASPECTS.map((aspect) => {
    const box = el('input', { type: 'checkbox', checked: true });
    boxes.set(aspect.id, box);
    box.addEventListener('change', renderSummary);
    return el('label', { class: 'regen-aspect' }, [
      el('span', { class: 'check' }, [box, ` ${aspect.label}`]),
      el('small', { class: 'hint', text: aspect.hint }),
    ]);
  }));

  fillSelect(ui.root, SHARP_NAMES.map((name, pc) => ({ value: pc, label: name })), 0);
  fillSelect(ui.scale, SCALES.map((scale) => ({ value: scale.id, label: scale.label })), 'minor');

  // The key shortcuts. Each one simply fills in the two selects above, because
  // "the relative major of the key I am in" is a thing worth having a button
  // for and not a thing worth a second way of changing the key.
  ui.keyMoves.replaceChildren(...KEY_MOVES.map((move) => el('button', {
    type: 'button',
    class: 'btn ghost small',
    title: move.hint,
    onclick: () => {
      const next = keyMove(move.id, {
        rootPc: Number(ui.root.value),
        scaleId: ui.scale.value,
      });
      ui.root.value = String(next.rootPc);
      ui.scale.value = next.scaleId;
      renderSummary();
    },
  }, [move.label])));

  fillSelect(ui.unit, METER_UNITS.map((unit) => ({ value: unit, label: String(unit) })), 4);

  // --- the variations -------------------------------------------------------

  /** id → the control that holds its answer. */
  const switchBoxes = new Map();
  const moveBoxes = new Map();
  const dialInputs = new Map();
  const dialOutputs = new Map();

  function variationRow(variation) {
    if (variation.kind === 'dial') {
      const input = el('input', {
        type: 'range',
        min: String(variation.min),
        max: String(variation.max),
        step: String(variation.step),
        value: '1',
      });
      const output = el('output', {});
      input.addEventListener('input', () => {
        output.textContent = `${Math.round(Number(input.value) * 100)}%`;
        renderSummary();
      });
      dialInputs.set(variation.id, input);
      dialOutputs.set(variation.id, output);
      return el('label', { class: 'regen-variation is-dial' }, [
        el('span', { class: 'regen-variation-label' }, [`${variation.label} `, output]),
        input,
        el('small', { class: 'hint', text: variation.hint }),
      ]);
    }

    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', renderSummary);
    (variation.kind === 'switch' ? switchBoxes : moveBoxes).set(variation.id, box);
    return el('label', { class: `regen-variation is-${variation.kind}` }, [
      el('span', { class: 'check' }, [box, ` ${variation.label}`]),
      el('small', { class: 'hint', text: variation.hint }),
    ]);
  }

  ui.variations.replaceChildren(...VARIATION_GROUPS.map((group) => {
    const rows = [...SWITCHES, ...MOVES, ...DIALS]
      .filter((variation) => variation.group === group.id)
      .map(variationRow);
    return rows.length
      ? el('div', { class: 'regen-group' }, [
        el('h4', { class: 'regen-group-label', text: group.label }),
        ...rows,
      ])
      : null;
  }).filter(Boolean));

  const chosen = () => REGEN_ASPECTS.filter((a) => boxes.get(a.id).checked).map((a) => a.id);
  const chosenMoves = () => MOVES.filter((m) => moveBoxes.get(m.id).checked).map((m) => m.id);

  /** The bar the two controls are currently asking for. */
  function readMeter() {
    return normalizeMeter({ beats: Number(ui.beats.value), unit: Number(ui.unit.value) });
  }

  function meterMoved() {
    const meter = readMeter();
    return meter.beats !== homeMeter.beats || meter.unit !== homeMeter.unit;
  }

  /**
   * What the dialog is about to ask for. Switches are always sent — they are a
   * state, and the answer to "should this have bass" is yes or no rather than
   * yes or nothing. Dials are sent only when they have been moved, so a move
   * that quietens a section is not immediately undone by a slider you never
   * touched.
   */
  function readVariationEdit() {
    const switches = {};
    for (const variation of SWITCHES) switches[variation.id] = switchBoxes.get(variation.id).checked;
    const dials = {};
    for (const variation of DIALS) {
      const input = dialInputs.get(variation.id);
      const value = Number(input.value);
      if (Number.isFinite(value) && value !== Number(input.dataset.was)) dials[variation.id] = value;
    }
    return { switches, dials, moves: chosenMoves() };
  }

  /** Whether any of it would actually change the section. */
  function variationsMoved(edit) {
    return edit.moves.length
      || Object.keys(edit.dials).length
      || SWITCHES.some((variation) => edit.switches[variation.id] !== variation.read(section));
  }

  function renderSummary() {
    if (!section) return;
    const aspects = chosen();
    const rootPc = Number(ui.root.value);
    const scaleId = ui.scale.value;
    const wasKey = keyLabel(section.music.rootPc ?? 0, section.music.scaleId);
    const nowKey = keyLabel(rootPc, scaleId);
    const modeChanged = scaleId !== section.music.scaleId;
    const moved = rootPc !== section.music.rootPc || modeChanged;

    ui.keyHint.textContent = !moved
      ? `Left where it is, in ${wasKey}.`
      : (modeChanged
        ? `${wasKey} → ${nowKey}. A change of mode is a different set of chords, so the chords are rewritten whatever the boxes above say.`
        : `${wasKey} → ${nowKey}. With the chords left alone the whole section is simply moved there, notes and all.`);

    ui.meterHint.textContent = meterMoved()
      ? `${meterLabel(homeMeter)} → ${meterLabel(readMeter())}. The parts are re-cut onto the new bar; `
        + 'nothing is rewritten.'
      : `Counted in ${meterLabel(homeMeter)}, the way it was written.`;

    const edit = readVariationEdit();
    const rolling = aspects.length ? `Rolling ${describeAspects(aspects)}.` : 'Rolling nothing.';
    const keeping = aspects.length === REGEN_ASPECTS.length
      ? '' : ' Everything else is left exactly as it is.';
    const varied = variationsMoved(edit)
      ? ' The variations you have set are applied first, and anything they disturb is written again.'
      : '';
    ui.summary.textContent = `${rolling}${keeping}${varied}`
      + (ui.fork.checked ? ` ${section.name} is left alone; the result is filed beside it.` : '');
    ui.go.disabled = !aspects.length && !moved && !meterMoved() && !variationsMoved(edit);
  }

  for (const input of [ui.root, ui.scale, ui.fork, ui.seed, ui.beats, ui.unit]) {
    input.addEventListener('change', renderSummary);
  }
  ui.meterReset.addEventListener('click', () => {
    ui.beats.value = String(homeMeter.beats);
    ui.unit.value = String(homeMeter.unit);
    renderSummary();
  });
  ui.newSeed.addEventListener('click', () => {
    ui.seed.value = randomSeed();
    renderSummary();
  });
  ui.close.addEventListener('click', () => ui.dialog.close());
  ui.go.addEventListener('click', () => {
    if (!section) return;
    const options = {
      aspects: chosen(),
      rootPc: Number(ui.root.value),
      scaleId: ui.scale.value,
      variations: readVariationEdit(),
      seed: ui.seed.value.trim(),
      fork: ui.fork.checked,
      ...(meterMoved() ? { meter: readMeter() } : {}),
    };
    ui.dialog.close();
    onRegenerate(section, options);
  });

  return {
    /** Opens it on one section, with its own key, bar and variations filled in. */
    open(target) {
      section = target;
      for (const box of boxes.values()) box.checked = true;
      ui.root.value = String(section.music.rootPc ?? 0);
      ui.scale.value = section.music.scaleId || 'minor';
      homeMeter = normalizeMeter(section.meter || DEFAULT_METER);
      ui.beats.value = String(homeMeter.beats);
      ui.unit.value = String(homeMeter.unit);

      // The switches show what is true now; the moves start empty, because a
      // move is something you ask for rather than something that is the case.
      for (const variation of SWITCHES) {
        switchBoxes.get(variation.id).checked = variation.read(section);
      }
      for (const variation of MOVES) {
        const box = moveBoxes.get(variation.id);
        box.checked = false;
        const usable = variationApplies(variation, section);
        box.disabled = !usable;
        box.closest('.regen-variation').classList.toggle('is-unavailable', !usable);
      }
      for (const variation of DIALS) {
        const input = dialInputs.get(variation.id);
        const value = variation.read(section);
        input.value = String(value);
        // Read back rather than stored: a range input snaps to its own step, and
        // remembering where it actually landed is what lets the dialog tell a
        // dial you moved from one you merely looked at.
        input.dataset.was = input.value;
        dialOutputs.get(variation.id).textContent = `${Math.round(Number(input.value) * 100)}%`;
      }

      ui.fork.checked = false;
      ui.scope.textContent = `Section ${section.name} — ${keyLabel(section.music.rootPc ?? 0, section.music.scaleId)}. `
        + 'Everything you leave unticked survives untouched.';
      renderSummary();
      ui.dialog.showModal();
    },
    /** Everything, which is what the left half of the button asks for. */
    everything: () => allAspects(),
  };
}
