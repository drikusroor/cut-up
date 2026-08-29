// The advanced half of the regenerate button.
//
// The left half of the button on a section card rolls everything and asks
// nothing; this is what the right half opens. It is the same call underneath —
// see music/regenerate.js — with the aspects, the key and the seed exposed, so
// "keep these chords but write me another tune over them, a fourth up" is two
// clicks rather than a rebuild.

import { $, el, fillSelect } from './dom.js';
import {
  allAspects, describeAspects, REGEN_ASPECTS,
} from '../music/regenerate.js';
import { keyLabel, SCALES, SHARP_NAMES } from '../music/theory.js';
import { randomSeed } from '../rng.js';

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
    keyHint: $('#regen-key-hint'),
    seed: $('#regen-seed'),
    newSeed: $('#regen-new-seed'),
    fork: $('#regen-fork'),
    summary: $('#regen-summary'),
    close: $('#regen-close'),
    go: $('#regen-go'),
  };

  /** Which section is open in here. */
  let section = null;

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

  const chosen = () => REGEN_ASPECTS.filter((a) => boxes.get(a.id).checked).map((a) => a.id);

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

    const rolling = aspects.length ? `Rolling ${describeAspects(aspects)}.` : 'Rolling nothing.';
    const keeping = aspects.length === REGEN_ASPECTS.length
      ? '' : ' Everything else is left exactly as it is.';
    ui.summary.textContent = `${rolling}${keeping}`
      + (ui.fork.checked ? ` ${section.name} is left alone; the result is filed beside it.` : '');
    ui.go.disabled = !aspects.length && !moved;
  }

  for (const input of [ui.root, ui.scale, ui.fork, ui.seed]) {
    input.addEventListener('change', renderSummary);
  }
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
      seed: ui.seed.value.trim(),
      fork: ui.fork.checked,
    };
    ui.dialog.close();
    onRegenerate(section, options);
  });

  return {
    /** Opens it on one section, with its own key already filled in. */
    open(target) {
      section = target;
      for (const box of boxes.values()) box.checked = true;
      ui.root.value = String(section.music.rootPc ?? 0);
      ui.scale.value = section.music.scaleId || 'minor';
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
