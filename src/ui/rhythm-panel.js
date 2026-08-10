// The Rhythm tab: a step grid you can generate, cut up, and edit by hand.

import { $, bindSlider, el, fillSelect } from './dom.js';
import { makeRng, randomSeed } from '../rng.js';
import {
  cutUpPattern,
  generateRhythm,
  randomKitPieces,
  RHYTHM_STYLES,
  TRACKS,
} from '../music/rhythm.js';
import { AUTO, DRUM_KITS, drumKit, instrumentOptions, resolveKit } from '../music/instruments.js';
import { meterInfo } from '../music/meter.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;

export function initRhythm(ctx) {
  const { state, save, audio } = ctx;
  const r = state.rhythm;

  const ui = {
    style: $('#rhythm-style'),
    hint: $('#rhythm-hint'),
    grid: $('#grid-readout'),
    bars: $('#rhythm-bars'),
    density: $('#rhythm-density'),
    variation: $('#variation'),
    picker: $('#track-picker'),
    out: $('#rhythm-out'),
    generate: $('#gen-rhythm'),
    cutup: $('#cutup-rhythm'),
    seed: $('#rhythm-seed'),
    newSeed: $('#new-rhythm-seed'),
    kit: $('#drum-kit'),
    kitHint: $('#kit-hint'),
    surpriseKit: $('#surprise-kit'),
  };

  fillSelect(ui.style, RHYTHM_STYLES.map((s) => ({ value: s.id, label: s.label })), r.style);
  fillSelect(ui.kit, instrumentOptions(DRUM_KITS), r.kit);
  bindSlider(ui.density, $('#out-rdensity'), PERCENT);
  bindSlider(ui.variation, $('#out-variation'), PERCENT);

  /** How the bar is counted: the time signature's business, not this panel's. */
  const grid = () => meterInfo(state.meter);

  /** Writes the stored settings back into the controls. */
  function writeControls() {
    ui.style.value = r.style;
    ui.bars.value = r.bars;
    // Before anything reads the controls, or the stored seed looks like a blank.
    ui.seed.value = r.seed;
    ui.kit.value = r.kit || AUTO;
    ui.density.value = r.density;
    ui.variation.value = r.variation;
    for (const input of [ui.density, ui.variation]) input.dispatchEvent(new Event('input'));
    for (const box of ui.picker.querySelectorAll('input')) {
      box.checked = r.trackIds.includes(box.value);
    }
    syncKit();
    syncGrid();
  }

  /** The bar the sequencer is drawing, in the transport's time signature. */
  function syncGrid() {
    const info = grid();
    ui.grid.textContent = info.compound
      ? `${info.stepsPerBar} steps of ${info.label}, felt in ${info.pulses}`
      : `${info.stepsPerBar} steps of ${info.label}`;
  }

  /** Which kit you actually got — "from the seed" changes under you. */
  function syncKit() {
    const kit = drumKit(resolveKit(r.kit, r.seed));
    ui.kitHint.textContent = r.kit === AUTO
      ? `From this seed: ${kit.label} — ${kit.hint}`
      : kit.hint;
    ctx.syncInstruments?.();
  }

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
    // A seed the user has typed over wins; an empty box means "surprise me".
    r.seed = ui.seed.value.trim() || randomSeed();
    r.kit = ui.kit.value;
    r.style = ui.style.value;
    // The bar length is the time signature's to decide.
    r.steps = grid().stepsPerBar;
    r.bars = Number(ui.bars.value);
    r.density = Number(ui.density.value);
    r.variation = Number(ui.variation.value);
  }

  function generate({ newSeed = true } = {}) {
    readControls();
    if (newSeed) r.seed = randomSeed();
    ui.seed.value = r.seed;
    // A new seed can mean a new kit, so the readout has to keep up.
    syncKit();
    r.pattern = generateRhythm({
      rng: makeRng(`rhythm:${r.seed}`),
      meter: state.meter,
      steps: r.steps,
      bars: r.bars,
      style: r.style,
      density: r.density,
      variation: r.variation,
      trackIds: r.trackIds,
    });
    render();
    // The bass part is written against the kick, so it has to hear about this.
    ctx.onRhythmChange?.();
    save();
  }

  function cutUp() {
    if (!r.pattern) return generate();
    const rng = makeRng(`cutup:${randomSeed()}`);
    // Strips of one felt beat, so a shuffled bar still lands on its beats.
    const stepsPerBeat = grid().pulse;
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
    ctx.onRhythmChange?.();
    save();
    return undefined;
  }

  function render() {
    const pattern = r.pattern;
    if (!pattern) return;
    const stepsPerBeat = grid().pulse;

    ui.out.replaceChildren(
      ...pattern.tracks.map((track) => el('div', { class: 'grid-row', dataset: { track: track.id } }, [
        el('button', {
          type: 'button',
          class: 'label',
          title: `Hear the ${track.label.toLowerCase()}`,
          onclick: () => audio.previewDrum(track.id, resolveKit(r.kit, r.seed)),
        }, [track.label]),
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
            // Hear what you just drew in, the way a drum machine does.
            if (track.pattern[step]) audio.previewDrum(track.id, resolveKit(r.kit, r.seed));
            // Moving the kick moves the bass with it; moving a hat leaves the
            // bass exactly where it was, because it was never listening to it.
            ctx.onRhythmChange?.();
            save();
          },
        })),
      ])),
    );
  }

  ui.generate.addEventListener('click', () => generate({ newSeed: true }));
  ui.cutup.addEventListener('click', cutUp);
  ui.kit.addEventListener('change', () => {
    r.kit = ui.kit.value;
    syncKit();
    save();
    // A kit is a sound, not a pattern — nothing needs regenerating.
    ctx.refreshPlayback?.();
  });
  ui.surpriseKit.addEventListener('click', () => {
    r.trackIds = randomKitPieces(makeRng(`kit:${randomSeed()}`));
    for (const box of ui.picker.querySelectorAll('input')) {
      box.checked = r.trackIds.includes(box.value);
    }
    generate({ newSeed: false });
  });
  // Typing a seed in replays it; the dice roll a fresh one.
  ui.seed.addEventListener('change', () => generate({ newSeed: false }));
  ui.newSeed.addEventListener('click', () => generate({ newSeed: true }));
  ui.style.addEventListener('change', () => { syncStyle(); generate({ newSeed: false }); });
  for (const input of [ui.bars, ui.density, ui.variation]) {
    input.addEventListener('change', () => generate({ newSeed: false }));
  }

  writeControls();
  syncStyle();
  // A pattern stored in a bar of a different length is not this bar's pattern.
  if (r.pattern && r.pattern.steps === grid().stepsPerBar) render();
  else generate({ newSeed: false });

  return {
    /** The bar changed length under it, so the pattern is written again. */
    applyMeter() {
      syncGrid();
      generate({ newSeed: false });
    },
    /** Re-reads state.rhythm after a section has been loaded over it. */
    applyState() {
      writeControls();
      syncStyle();
      if (r.pattern) render();
      else generate({ newSeed: false });
    },
    highlight(step) {
      const total = r.pattern?.tracks?.[0]?.pattern.length ?? 0;
      const now = total && step >= 0 ? step % total : -1;
      for (const row of ui.out.children) {
        for (const cell of row.querySelectorAll('.step')) {
          cell.classList.toggle('is-now', Number(cell.dataset.step) === now);
        }
      }
    },
  };
}
