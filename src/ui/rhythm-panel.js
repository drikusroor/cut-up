// The Rhythm tab: a step grid you can generate, cut up, and edit by hand.

import { $, bindSlider, el, fillSelect } from './dom.js';
import { makeRng, randomSeed } from '../rng.js';
import { cutUpPattern, generateRhythm, RHYTHM_STYLES, TRACKS } from '../music/rhythm.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;

export function initRhythm(ctx) {
  const { state, save } = ctx;
  const r = state.rhythm;

  const ui = {
    style: $('#rhythm-style'),
    hint: $('#rhythm-hint'),
    steps: $('#steps-per-bar'),
    bars: $('#rhythm-bars'),
    density: $('#rhythm-density'),
    variation: $('#variation'),
    picker: $('#track-picker'),
    out: $('#rhythm-out'),
    generate: $('#gen-rhythm'),
    cutup: $('#cutup-rhythm'),
  };

  fillSelect(ui.style, RHYTHM_STYLES.map((s) => ({ value: s.id, label: s.label })), r.style);
  ui.steps.value = r.steps;
  ui.bars.value = r.bars;
  ui.density.value = r.density;
  ui.variation.value = r.variation;
  bindSlider(ui.density, $('#out-rdensity'), PERCENT);
  bindSlider(ui.variation, $('#out-variation'), PERCENT);

  ui.picker.replaceChildren(
    ...TRACKS.map((track) => el('label', { class: 'check' }, [
      el('input', {
        type: 'checkbox',
        value: track.id,
        checked: r.trackIds.includes(track.id),
        onchange: (event) => {
          const { value, checked } = event.target;
          r.trackIds = checked
            ? [...new Set([...r.trackIds, value])]
            : r.trackIds.filter((id) => id !== value);
          // Keep kit order stable regardless of click order.
          r.trackIds.sort((a, b) => TRACKS.findIndex((t) => t.id === a) - TRACKS.findIndex((t) => t.id === b));
          generate({ newSeed: false });
        },
      }),
      track.label,
    ])),
  );

  function syncStyle() {
    const style = RHYTHM_STYLES.find((s) => s.id === r.style);
    ui.hint.textContent = style ? style.hint : '';
  }

  function readControls() {
    r.style = ui.style.value;
    r.steps = Number(ui.steps.value);
    r.bars = Number(ui.bars.value);
    r.density = Number(ui.density.value);
    r.variation = Number(ui.variation.value);
  }

  function generate({ newSeed = true } = {}) {
    readControls();
    if (newSeed || !r.seed) r.seed = randomSeed();
    r.pattern = generateRhythm({
      rng: makeRng(`rhythm:${r.seed}`),
      steps: r.steps,
      bars: r.bars,
      style: r.style,
      density: r.density,
      variation: r.variation,
      trackIds: r.trackIds,
    });
    render();
    save();
  }

  function cutUp() {
    if (!r.pattern) return generate();
    const rng = makeRng(`cutup:${randomSeed()}`);
    const stepsPerBeat = Math.max(1, Math.round(r.steps / 4));
    r.pattern = {
      ...r.pattern,
      tracks: r.pattern.tracks.map((track) => {
        const pattern = cutUpPattern(track.pattern, rng, stepsPerBeat);
        return {
          ...track,
          pattern,
          // Accents stay tied to the step position, not to the strip, so a
          // shuffled bar still lands hard on its downbeats.
          velocities: pattern.map((on, i) => (on ? track.velocities[i] || 100 : 0)),
        };
      }),
    };
    render();
    save();
    return undefined;
  }

  function render() {
    const pattern = r.pattern;
    if (!pattern) return;
    const stepsPerBeat = Math.max(1, Math.round(pattern.steps / 4));

    ui.out.replaceChildren(
      ...pattern.tracks.map((track) => el('div', { class: 'grid-row', dataset: { track: track.id } }, [
        el('span', { class: 'label', text: track.label }),
        ...track.pattern.map((on, step) => el('button', {
          type: 'button',
          class: [
            'step',
            on ? 'is-on' : '',
            step % stepsPerBeat === 0 ? 'beat' : '',
            step % pattern.steps === 0 ? 'bar-start' : '',
          ].filter(Boolean).join(' '),
          dataset: { step: String(step) },
          'aria-label': `${track.label} step ${step + 1}`,
          'aria-pressed': String(on),
          onclick: (event) => {
            track.pattern[step] = !track.pattern[step];
            track.velocities[step] = track.pattern[step] ? 100 : 0;
            event.currentTarget.classList.toggle('is-on', track.pattern[step]);
            event.currentTarget.setAttribute('aria-pressed', String(track.pattern[step]));
            save();
          },
        })),
      ])),
    );
  }

  ui.generate.addEventListener('click', () => generate({ newSeed: true }));
  ui.cutup.addEventListener('click', cutUp);
  ui.style.addEventListener('change', () => { syncStyle(); generate({ newSeed: false }); });
  for (const input of [ui.steps, ui.bars, ui.density, ui.variation]) {
    input.addEventListener('change', () => generate({ newSeed: false }));
  }

  syncStyle();
  if (r.pattern) render();
  else generate({ newSeed: true });

  return {
    highlight(step) {
      const total = r.pattern?.tracks?.[0]?.pattern.length ?? 0;
      const now = total ? ((step % total) + total) % total : -1;
      for (const row of ui.out.children) {
        for (const cell of row.querySelectorAll('.step')) {
          cell.classList.toggle('is-now', Number(cell.dataset.step) === now);
        }
      }
    },
  };
}
