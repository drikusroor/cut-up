// The transport's two drawers, plus the time signature next to the tempo.
//
// None of this belongs to a tab. A time signature, how tightly the band plays
// and what it is tuned to are properties of the whole thing, the way tempo and
// swing are, so they live down in the transport with them.

import { $, bindSlider, el, fillSelect } from './dom.js';
import { randomSeed } from '../rng.js';
import { HUMANIZE_PARTS, normalizeHumanize, pushLabel } from '../music/humanize.js';
import {
  DIVISION_RANGE,
  normalizeTuning,
  partDetuneCents,
  TUNED_PARTS,
  TUNING_SYSTEMS,
  tuningLabel,
} from '../music/tuning.js';
import { meterInfo, normalizeMeter } from '../music/meter.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;
const CENTS = (v) => `${Math.round(Number(v))}¢`;
/** Cents with a sign, because half the point is which way it is out. */
const SIGNED_CENTS = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}¢`;

/** How each part is named in the tuning drawer, which thinks in instruments. */
const TUNED_LABELS = { lead: 'Melody', harmony: 'Chords', bass: 'Bass' };

/**
 * @param {object} ctx the app shell — state, save, and the callbacks that let a
 *   change here reach the parts it affects
 */
export function initFeel(ctx) {
  const { state, save } = ctx;

  const ui = {
    beats: $('#meter-beats'),
    unit: $('#meter-unit'),
    meterOut: $('#meter-readout'),
    humanize: $('#humanize'),
    humanizeOut: $('#out-humanize'),
    parts: $('#humanize-parts'),
    feelSeed: $('#feel-seed'),
    newFeelSeed: $('#new-feel-seed'),
    system: $('#tuning-system'),
    systemHint: $('#tuning-hint'),
    divisionsField: $('#divisions-field'),
    divisions: $('#tuning-divisions'),
    detune: $('#tuning-detune'),
    drift: $('#tuning-drift'),
    detuneOut: $('#detune-readout'),
    tuningSeed: $('#tuning-seed'),
    newTuningSeed: $('#new-tuning-seed'),
  };

  fillSelect(ui.system, TUNING_SYSTEMS.map((s) => ({ value: s.id, label: s.label })), state.tuning.system);
  bindSlider(ui.humanize, ui.humanizeOut, PERCENT);
  bindSlider(ui.detune, $('#out-detune'), (v) => (Number(v) ? `±${Math.round(Number(v))}¢` : 'in tune'));
  bindSlider(ui.drift, $('#out-drift'), (v) => (Number(v) ? `±${Math.round(Number(v))}¢` : 'steady'));

  // --- humanize ---------------------------------------------------------------

  // One row per player. Built here rather than written out in the markup,
  // because the list of parts belongs to humanize.js.
  const partInputs = new Map();
  ui.parts.replaceChildren(
    el('span', {}),
    el('span', { class: 'head' }, ['Off the grid']),
    el('span', { class: 'head' }, ['Rush ↔ lag']),
    ...HUMANIZE_PARTS.flatMap((part) => {
      const spread = el('input', {
        type: 'range', min: 0, max: 1, step: 0.05, 'aria-label': `${part.label} timing spread`,
      });
      const spreadOut = el('output');
      const push = el('input', {
        type: 'range', min: -1, max: 1, step: 0.05, 'aria-label': `${part.label} rush or lag`,
      });
      const pushOut = el('output');
      partInputs.set(part.id, {
        spread, spreadOut, push, pushOut,
      });
      return [
        el('span', { class: 'part-name' }, [part.label]),
        el('label', { class: 'cell' }, [spread, spreadOut]),
        el('label', { class: 'cell' }, [push, pushOut]),
      ];
    }),
  );

  function renderPartReadouts() {
    for (const [id, row] of partInputs) {
      const settings = state.feel.parts[id];
      row.spreadOut.textContent = PERCENT(settings.spread);
      row.pushOut.textContent = pushLabel(settings.push);
    }
  }

  function readFeel() {
    state.feel = normalizeHumanize({
      amount: Number(ui.humanize.value),
      seed: ui.feelSeed.value.trim() || state.feel.seed,
      parts: Object.fromEntries([...partInputs].map(([id, row]) => [id, {
        spread: Number(row.spread.value),
        push: Number(row.push.value),
      }])),
    });
  }

  /** A change to the feel changes no notes — only when they are struck. */
  function applyFeel({ replay = true } = {}) {
    readFeel();
    renderPartReadouts();
    ui.feelSeed.value = state.feel.seed;
    ctx.syncFeel?.();
    save();
    if (replay) ctx.refreshPlayback?.();
  }

  // --- tuning -----------------------------------------------------------------

  function syncTuning() {
    const tuning = state.tuning;
    const spec = TUNING_SYSTEMS.find((s) => s.id === tuning.system);
    ui.systemHint.textContent = spec ? spec.hint : '';
    ui.divisionsField.hidden = !spec?.divisible;
    ui.detuneOut.textContent = tuning.detune || tuning.drift
      ? `${tuningLabel(tuning)} — ${TUNED_PARTS.map((part) => `${TUNED_LABELS[part] || part} ${SIGNED_CENTS(partDetuneCents(part, tuning))}`).join(', ')}`
      : `${tuningLabel(tuning)} — every instrument perfectly in tune with the next.`;
    ctx.syncFeel?.();
  }

  function applyTuning({ replay = true } = {}) {
    state.tuning = normalizeTuning({
      system: ui.system.value,
      divisions: Number(ui.divisions.value),
      detune: Number(ui.detune.value),
      drift: Number(ui.drift.value),
      seed: ui.tuningSeed.value.trim() || state.tuning.seed,
    });
    ui.divisions.value = String(state.tuning.divisions);
    ui.tuningSeed.value = state.tuning.seed;
    syncTuning();
    save();
    if (replay) ctx.refreshPlayback?.();
  }

  // --- meter ------------------------------------------------------------------

  function syncMeter() {
    const info = meterInfo(state.meter);
    ui.beats.value = String(info.beats);
    ui.unit.value = String(info.unit);
    ui.meterOut.textContent = `${info.stepsPerBar} steps${info.compound ? `, felt in ${info.pulses}` : ''}`;
  }

  function applyMeter() {
    const next = normalizeMeter({ beats: Number(ui.beats.value), unit: Number(ui.unit.value) });
    const changed = next.beats !== state.meter.beats || next.unit !== state.meter.unit;
    state.meter = next;
    syncMeter();
    save();
    // A bar of a different length is a different grid, so the pattern and the
    // parts written against it have to be laid out again.
    if (changed) ctx.onMeterChange?.();
  }

  // --- events -----------------------------------------------------------------

  ui.humanize.addEventListener('input', () => renderPartReadouts());
  ui.humanize.addEventListener('change', () => applyFeel());
  for (const row of partInputs.values()) {
    row.spread.addEventListener('input', () => { readFeel(); renderPartReadouts(); });
    row.push.addEventListener('input', () => { readFeel(); renderPartReadouts(); });
    row.spread.addEventListener('change', () => applyFeel());
    row.push.addEventListener('change', () => applyFeel());
  }
  ui.feelSeed.addEventListener('change', () => applyFeel());
  ui.newFeelSeed.addEventListener('click', () => {
    ui.feelSeed.value = randomSeed();
    applyFeel();
  });

  for (const input of [ui.system, ui.divisions, ui.detune, ui.drift, ui.tuningSeed]) {
    input.addEventListener('change', () => applyTuning());
  }
  ui.newTuningSeed.addEventListener('click', () => {
    ui.tuningSeed.value = randomSeed();
    applyTuning();
  });

  for (const input of [ui.beats, ui.unit]) input.addEventListener('change', applyMeter);

  // --- boot -------------------------------------------------------------------

  /** Writes the stored settings back into the controls. */
  function writeControls() {
    ui.humanize.value = String(state.feel.amount);
    ui.humanize.dispatchEvent(new Event('input'));
    ui.feelSeed.value = state.feel.seed;
    for (const [id, row] of partInputs) {
      row.spread.value = String(state.feel.parts[id].spread);
      row.push.value = String(state.feel.parts[id].push);
    }
    renderPartReadouts();
    ui.system.value = state.tuning.system;
    ui.divisions.value = String(state.tuning.divisions);
    ui.detune.value = String(state.tuning.detune);
    ui.drift.value = String(state.tuning.drift);
    ui.tuningSeed.value = state.tuning.seed;
    for (const input of [ui.detune, ui.drift]) input.dispatchEvent(new Event('input'));
    syncMeter();
    syncTuning();
  }

  ui.divisions.min = String(DIVISION_RANGE[0]);
  ui.divisions.max = String(DIVISION_RANGE[1]);
  writeControls();

  return {
    /** Re-reads the key, so the temperament readout follows the tonic. */
    refresh: syncTuning,
    applyState: writeControls,
  };
}
