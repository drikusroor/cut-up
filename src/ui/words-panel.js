// The Words tab: source text in, cut-up lines out.

import { $, bindSlider, copyText, download, el, fillSelect, toast } from './dom.js';
import { generateLyrics, METHODS } from '../lyrics.js';
import { loadDictionary } from '../words.js';
import { seedsFor } from '../sources.js';
import { randomSeed } from '../rng.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;

export function initWords(ctx) {
  const { state, save } = ctx;
  const w = state.words;

  const ui = {
    lang: $('#lang'),
    dictStatus: $('#dict-status'),
    text: $('#source-text'),
    text2: $('#source-text-2'),
    seedText: $('#seed-text'),
    clearText: $('#clear-text'),
    method: $('#method'),
    methodHint: $('#method-hint'),
    seed: $('#seed'),
    newSeed: $('#new-seed'),
    cut: $('#cut'),
    reroll: $('#reroll'),
    linesOut: $('#lines-out'),
    titlesOut: $('#titles-out'),
    keepersOut: $('#keepers-out'),
    copyLines: $('#copy-lines'),
    downloadLines: $('#download-lines'),
    copyKeepers: $('#copy-keepers'),
    clearKeepers: $('#clear-keepers'),
    secondWrap: $('#second-text-wrap'),
  };

  const numbers = ['lines', 'minWords', 'maxWords', 'stripMin', 'stripMax'];
  const sliders = ['textWeight', 'dictWeight', 'imageryWeight', 'rarity', 'glue'];

  // --- wiring ---------------------------------------------------------------

  ui.lang.value = w.lang;
  ui.text.value = w.text;
  ui.text2.value = w.secondText;
  ui.seed.value = w.seed;
  $('#capitalize').checked = w.capitalize;
  for (const id of [...numbers, ...sliders]) {
    const input = $(`#${id}`);
    if (input) input.value = w[id];
  }
  for (const id of sliders) bindSlider($(`#${id}`), $(`#out-${id}`), PERCENT);

  ui.method.replaceChildren(
    ...METHODS.map((m) => el('button', {
      type: 'button',
      class: `btn${m.id === w.method ? ' is-on' : ''}`,
      dataset: { method: m.id },
      title: m.hint,
    }, [m.label])),
  );
  ui.method.addEventListener('click', (event) => {
    const button = event.target.closest('[data-method]');
    if (!button) return;
    w.method = button.dataset.method;
    syncMethod();
    generate({ keepSeed: true });
  });

  function syncMethod() {
    for (const button of ui.method.children) {
      button.classList.toggle('is-on', button.dataset.method === w.method);
    }
    const method = METHODS.find((m) => m.id === w.method);
    ui.methodHint.textContent = method ? method.hint : '';
    ui.secondWrap.open = w.method === 'foldin';
  }

  function readControls() {
    w.lang = ui.lang.value;
    w.text = ui.text.value;
    w.secondText = ui.text2.value;
    w.seed = ui.seed.value || randomSeed();
    w.capitalize = $('#capitalize').checked;
    for (const id of numbers) w[id] = Number($(`#${id}`).value);
    for (const id of sliders) w[id] = Number($(`#${id}`).value);
    if (w.maxWords < w.minWords) w.maxWords = w.minWords;
    if (w.stripMax < w.stripMin) w.stripMax = w.stripMin;
  }

  // --- dictionary -----------------------------------------------------------

  let dictionary = [];

  async function refreshDictionary() {
    const lang = ui.lang.value;
    ui.dictStatus.textContent = 'Loading dictionary…';
    try {
      dictionary = await loadDictionary(lang);
      ui.dictStatus.textContent = `${dictionary.length.toLocaleString()} words loaded`;
    } catch (error) {
      dictionary = [];
      ui.dictStatus.textContent = 'Dictionary unavailable — serve this folder over http:// rather than opening the file directly.';
      console.warn(error);
    }
    fillSeedTexts(lang);
  }

  function fillSeedTexts(lang) {
    fillSelect(
      ui.seedText,
      [{ value: '', label: '— none —' }, ...seedsFor(lang).map((s) => ({ value: s.id, label: s.label }))],
      '',
    );
  }

  ui.lang.addEventListener('change', async () => {
    w.lang = ui.lang.value;
    await refreshDictionary();
    save();
  });

  ui.seedText.addEventListener('change', () => {
    const seed = seedsFor(ui.lang.value).find((s) => s.id === ui.seedText.value);
    if (!seed) return;
    // Reflow the hard-wrapped source so it pastes like real copy.
    ui.text.value = seed.text.replace(/\s*\n\s*/g, ' ').trim();
    generate();
  });

  ui.clearText.addEventListener('click', () => {
    ui.text.value = '';
    ui.text2.value = '';
    save();
  });

  // --- generate -------------------------------------------------------------

  function generate({ keepSeed = true } = {}) {
    readControls();
    if (!keepSeed) {
      w.seed = randomSeed();
      ui.seed.value = w.seed;
    }
    const result = generateLyrics({ ...w, dictionary, locked: w.locked });
    w.output = result.lines;
    w.titles = result.titles;
    renderLines();
    save();
    // The Chords tab may be singing these, so it needs to know they changed.
    ctx.onWordsChange?.();
  }

  function renderLines() {
    ui.linesOut.replaceChildren(
      ...w.output.map((line, index) => {
        const locked = Boolean(w.locked[index]);
        return el('li', { class: `line${locked ? ' is-locked' : ''}` }, [
          el('button', {
            type: 'button',
            class: `line-btn${locked ? ' is-on' : ''}`,
            title: locked ? 'Unlock this line' : 'Lock this line so rerolls keep it',
            'aria-pressed': String(locked),
            onclick: () => {
              w.locked[index] = locked ? null : line;
              renderLines();
              save();
            },
          }, [locked ? '🔒' : '🔓']),
          el('span', { class: 'text', text: line }),
          el('button', {
            type: 'button',
            class: 'line-btn',
            title: 'Keep this line',
            onclick: () => keep(line),
          }, ['★']),
        ]);
      }),
    );

    const list = ui.titlesOut.querySelector('ul');
    list.replaceChildren(...w.titles.map((t) => el('li', {}, [t])));
    ui.titlesOut.hidden = w.titles.length === 0;
  }

  // --- keepers --------------------------------------------------------------

  function keep(line) {
    if (!line || w.keepers.includes(line)) return;
    w.keepers.push(line);
    renderKeepers();
    save();
    toast('Kept');
  }

  function renderKeepers() {
    ui.keepersOut.replaceChildren(
      ...w.keepers.map((line, index) => el('li', {}, [
        el('span', { text: line }),
        el('button', {
          type: 'button',
          class: 'line-btn',
          title: 'Remove',
          onclick: () => {
            w.keepers.splice(index, 1);
            renderKeepers();
            save();
          },
        }, ['✕']),
      ])),
    );
  }

  // --- buttons --------------------------------------------------------------

  ui.cut.addEventListener('click', () => generate({ keepSeed: true }));
  ui.reroll.addEventListener('click', () => generate({ keepSeed: false }));
  ui.newSeed.addEventListener('click', () => {
    ui.seed.value = randomSeed();
    generate({ keepSeed: true });
  });

  ui.copyLines.addEventListener('click', () => copyText(w.output.join('\n'), 'Lines copied'));
  ui.downloadLines.addEventListener('click', () => {
    const body = [
      w.titles.length ? `Title ideas: ${w.titles.join(' / ')}\n` : '',
      w.output.join('\n'),
      w.keepers.length ? `\n\n--- keepers ---\n${w.keepers.join('\n')}` : '',
    ].join('');
    download(`cut-up-${w.seed}.txt`, body);
  });
  ui.copyKeepers.addEventListener('click', () => copyText(w.keepers.join('\n'), 'Keepers copied'));
  ui.clearKeepers.addEventListener('click', () => {
    w.keepers.length = 0;
    renderKeepers();
    save();
  });

  for (const id of [...numbers, ...sliders, 'capitalize']) {
    $(`#${id}`)?.addEventListener('change', () => generate({ keepSeed: true }));
  }
  ui.seed.addEventListener('change', () => generate({ keepSeed: true }));

  // --- boot -----------------------------------------------------------------

  syncMethod();
  renderKeepers();
  if (w.output.length) renderLines();

  refreshDictionary().then(() => {
    if (!w.output.length) generate({ keepSeed: true });
  });

  return {
    /**
     * Re-reads state.words after a whole song has been loaded over it. Nothing
     * is cut up again — the lines that came with the song are the lines it was
     * written to, so they are shown rather than replaced.
     */
    applyState() {
      ui.lang.value = w.lang;
      ui.text.value = w.text;
      ui.text2.value = w.secondText;
      ui.seed.value = w.seed;
      $('#capitalize').checked = w.capitalize;
      for (const id of [...numbers, ...sliders]) {
        const input = $(`#${id}`);
        if (input) input.value = w[id];
      }
      for (const id of sliders) $(`#${id}`).dispatchEvent(new Event('input'));
      syncMethod();
      renderKeepers();
      if (w.output.length) renderLines();
    },
  };
}
