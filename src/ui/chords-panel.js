// The Chords & melody tab.

import { $, bindSlider, copyText, el, fillSelect } from './dom.js';
import { makeRng, randomSeed } from '../rng.js';
import {
  chordSymbol,
  generateProgression,
  keyUsesFlats,
  noteName,
  parseChords,
  PROGRESSION_MODES,
  SCALES,
  voiceProgression,
} from '../music/theory.js';
import { generateMelody, MELODY_SHAPES, MELODY_TRANSFORMS, transformMelody } from '../music/melody.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;

export function initChords(ctx) {
  const { state, save, audio } = ctx;
  const m = state.music;

  const ui = {
    root: $('#root'),
    scale: $('#scale'),
    mode: $('#prog-mode'),
    hint: $('#prog-hint'),
    ownWrap: $('#own-chords-wrap'),
    own: $('#own-chords'),
    length: $('#prog-length'),
    barsPerChord: $('#bars-per-chord'),
    shape: $('#melody-shape'),
    rangeLow: $('#range-low'),
    rangeHigh: $('#range-high'),
    transforms: $('#melody-transforms'),
    out: $('#chords-out'),
    roll: $('#piano-roll'),
    genChords: $('#gen-chords'),
    genMelody: $('#gen-melody'),
    copy: $('#copy-chords'),
    chordSeed: $('#chord-seed'),
    melodySeed: $('#melody-seed'),
    newChordSeed: $('#new-chord-seed'),
    newMelodySeed: $('#new-melody-seed'),
  };

  const sliders = ['sevenths', 'spice'];
  const melodySliders = [
    ['mel-density', 'density'],
    ['chordTones', 'chordTones'],
    ['restiness', 'restiness'],
  ];

  // --- populate selects -----------------------------------------------------

  fillSelect(ui.root, Array.from({ length: 12 }, (_, pc) => ({
    value: pc,
    label: `${noteName(pc)}${noteName(pc) !== noteName(pc, true) ? ` / ${noteName(pc, true)}` : ''}`,
  })), m.rootPc);

  fillSelect(ui.scale, SCALES.map((s) => ({ value: s.id, label: s.label })), m.scaleId);
  fillSelect(ui.mode, PROGRESSION_MODES.map((p) => ({ value: p.id, label: p.label })), m.mode);
  fillSelect(ui.shape, MELODY_SHAPES.map((s) => ({ value: s.id, label: s.label })), m.melodyShape);

  const noteOptions = Array.from({ length: 49 }, (_, i) => {
    const midi = 48 + i; // C3 .. C7
    return { value: midi, label: `${noteName(midi % 12)}${Math.floor(midi / 12) - 1}` };
  });
  fillSelect(ui.rangeLow, noteOptions, m.rangeLow);
  fillSelect(ui.rangeHigh, noteOptions, m.rangeHigh);

  ui.length.value = m.length;
  ui.barsPerChord.value = m.stepsPerChord;
  // Before anything reads the controls, or the stored seeds look like blanks.
  ui.chordSeed.value = m.chordSeed;
  ui.melodySeed.value = m.melodySeed;
  ui.own.value = m.ownChords;
  for (const id of sliders) $(`#${id}`).value = m[id];
  for (const [id, key] of melodySliders) $(`#${id}`).value = m[key];
  for (const id of sliders) bindSlider($(`#${id}`), $(`#out-${id}`), PERCENT);
  bindSlider($('#mel-density'), $('#out-density'), PERCENT);
  bindSlider($('#chordTones'), $('#out-chordTones'), PERCENT);
  bindSlider($('#restiness'), $('#out-restiness'), PERCENT);

  ui.transforms.replaceChildren(
    ...MELODY_TRANSFORMS.map((t) => el('button', {
      type: 'button',
      class: 'btn ghost',
      title: t.hint,
      onclick: () => applyTransform(t.id),
    }, [t.label])),
  );

  function syncMode() {
    const mode = PROGRESSION_MODES.find((p) => p.id === m.mode);
    ui.hint.textContent = mode ? mode.hint : '';
    ui.ownWrap.hidden = m.mode !== 'cutup';
  }

  function readControls() {
    // A seed the user has typed over wins; an empty box means "surprise me".
    m.chordSeed = ui.chordSeed.value.trim() || randomSeed();
    m.melodySeed = ui.melodySeed.value.trim() || randomSeed();
    m.rootPc = Number(ui.root.value);
    m.scaleId = ui.scale.value;
    m.mode = ui.mode.value;
    m.ownChords = ui.own.value;
    m.length = Number(ui.length.value);
    m.stepsPerChord = Number(ui.barsPerChord.value);
    m.melodyShape = ui.shape.value;
    m.rangeLow = Number(ui.rangeLow.value);
    m.rangeHigh = Number(ui.rangeHigh.value);
    if (m.rangeHigh < m.rangeLow + 7) m.rangeHigh = m.rangeLow + 7;
    for (const id of sliders) m[id] = Number($(`#${id}`).value);
    for (const [id, key] of melodySliders) m[key] = Number($(`#${id}`).value);
  }

  // --- generation -----------------------------------------------------------

  function generateChords({ newSeed = true } = {}) {
    readControls();
    if (newSeed) m.chordSeed = randomSeed();
    ui.chordSeed.value = m.chordSeed;
    const rng = makeRng(`chords:${m.chordSeed}`);

    const fresh = generateProgression({
      rng,
      rootPc: m.rootPc,
      scaleId: m.scaleId,
      length: m.length,
      mode: m.mode,
      sevenths: m.sevenths,
      spice: m.spice,
      source: parseChords(m.ownChords),
    });

    if (m.mode === 'cutup' && !fresh.length) {
      ui.out.replaceChildren(el('p', { class: 'hint' }, ['Type a few chords above first — for example “Am F C G”.']));
      m.chords = [];
      m.voicings = [];
      renderRoll();
      return;
    }

    // Locked chords hold their slot through a reroll.
    m.chords = fresh.map((chord, i) => m.locked[i] || chord);
    m.voicings = voiceProgression(m.chords, { octave: 3 });
    renderChords();
    // The melody keeps its own seed: new chords under the same melody idea is
    // a thing you want to be able to ask for.
    generateMelodyLine({ newSeed: false });
    save();
  }

  function generateMelodyLine({ newSeed = true } = {}) {
    readControls();
    if (!m.chords.length) return;
    if (newSeed) m.melodySeed = randomSeed();
    ui.melodySeed.value = m.melodySeed;
    m.melody = generateMelody({
      rng: makeRng(`melody:${m.melodySeed}`),
      chords: m.chords,
      rootPc: m.rootPc,
      scaleId: m.scaleId,
      stepsPerChord: m.stepsPerChord,
      density: m.density,
      chordTones: m.chordTones,
      restiness: m.restiness,
      shape: m.melodyShape,
      range: [m.rangeLow, m.rangeHigh],
    });
    renderRoll();
    save();
  }

  function applyTransform(id) {
    if (!m.melody.length) return;
    m.melody = transformMelody(m.melody, id, {
      rng: makeRng(`transform:${randomSeed()}`),
      totalSteps: m.chords.length * m.stepsPerChord,
      stepsPerBar: m.stepsPerChord,
      range: [m.rangeLow, m.rangeHigh],
    });
    renderRoll();
    save();
  }

  // --- rendering ------------------------------------------------------------

  function renderChords() {
    const flats = keyUsesFlats(m.rootPc, m.scaleId);
    ui.out.replaceChildren(
      ...m.chords.map((chord, index) => {
        const locked = Boolean(m.locked[index]);
        const voicing = m.voicings[index] || [];
        const card = el('button', {
          type: 'button',
          class: `chord-card${locked ? ' is-locked' : ''}`,
          dataset: { index: String(index) },
          title: 'Click to hear it',
          onclick: () => audio.strum(voicing),
        }, [
          el('div', { class: 'roman', text: chord.roman || '·' }),
          el('div', { class: 'symbol', text: chordSymbol(chord, flats) }),
          el('div', { class: 'notes', text: voicing.map((n) => `${noteName(n % 12, flats)}${Math.floor(n / 12) - 1}`).join(' ') }),
        ]);
        card.append(el('span', {
          class: `lock${locked ? ' is-on' : ''}`,
          role: 'button',
          title: locked ? 'Unlock' : 'Lock this chord',
          onclick: (event) => {
            event.stopPropagation();
            m.locked[index] = locked ? null : chord;
            renderChords();
            save();
          },
        }, [locked ? '🔒' : '🔓']));
        return card;
      }),
    );
  }

  function renderRoll() {
    const canvas = ui.roll;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 640;
    const height = 260;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);

    const totalSteps = Math.max(1, m.chords.length * m.stepsPerChord);
    if (!m.melody.length && !m.chords.length) {
      g.fillStyle = '#6d685c';
      g.font = '13px system-ui, sans-serif';
      g.fillText('No melody yet.', 12, 24);
      return;
    }

    const pitches = [
      ...m.melody.map((n) => n.midi),
      ...(m.voicings.flat().length ? m.voicings.flat() : [m.rangeLow, m.rangeHigh]),
    ];
    const low = Math.min(...pitches) - 2;
    const high = Math.max(...pitches) + 2;
    const rows = Math.max(1, high - low + 1);
    const rowHeight = height / rows;
    const stepWidth = width / totalSteps;

    // Root-note rows, so the shape is readable against the key.
    for (let midi = low; midi <= high; midi++) {
      if (midi % 12 !== m.rootPc % 12) continue;
      g.fillStyle = 'rgba(226, 84, 60, 0.09)';
      g.fillRect(0, (high - midi) * rowHeight, width, rowHeight);
    }

    // Chord blocks underneath.
    g.fillStyle = 'rgba(234, 230, 217, 0.08)';
    m.voicings.forEach((voicing, index) => {
      for (const midi of voicing) {
        if (midi < low || midi > high) continue;
        g.fillRect(index * m.stepsPerChord * stepWidth + 1, (high - midi) * rowHeight, m.stepsPerChord * stepWidth - 2, rowHeight - 1);
      }
    });

    // Bar lines.
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    for (let step = 0; step <= totalSteps; step += m.stepsPerChord) {
      g.beginPath();
      g.moveTo(step * stepWidth + 0.5, 0);
      g.lineTo(step * stepWidth + 0.5, height);
      g.stroke();
    }

    // Notes.
    for (const note of m.melody) {
      const x = note.step * stepWidth;
      const y = (high - note.midi) * rowHeight;
      g.fillStyle = '#e2543c';
      roundRect(g, x + 1, y + 1, Math.max(3, note.length * stepWidth - 2), Math.max(3, rowHeight - 2), 2);
      g.fill();
    }
  }

  function roundRect(g, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + radius, y);
    g.arcTo(x + w, y, x + w, y + h, radius);
    g.arcTo(x + w, y + h, x, y + h, radius);
    g.arcTo(x, y + h, x, y, radius);
    g.arcTo(x, y, x + w, y, radius);
    g.closePath();
  }

  // --- events ---------------------------------------------------------------

  ui.genChords.addEventListener('click', () => generateChords({ newSeed: true }));
  ui.genMelody.addEventListener('click', () => generateMelodyLine({ newSeed: true }));
  ui.mode.addEventListener('change', () => { readControls(); syncMode(); save(); });
  ui.copy.addEventListener('click', () => {
    const flats = keyUsesFlats(m.rootPc, m.scaleId);
    copyText(m.chords.map((c) => chordSymbol(c, flats)).join(' | '), 'Progression copied');
  });

  for (const id of ['root', 'scale', 'prog-length', 'bars-per-chord', 'sevenths', 'spice']) {
    $(`#${id}`).addEventListener('change', () => generateChords({ newSeed: false }));
  }
  for (const id of ['melody-shape', 'mel-density', 'chordTones', 'restiness', 'range-low', 'range-high']) {
    $(`#${id}`).addEventListener('change', () => generateMelodyLine({ newSeed: false }));
  }
  ui.own.addEventListener('change', () => generateChords({ newSeed: true }));

  // Typing a seed in replays it; the dice roll a fresh one for that part only.
  ui.chordSeed.addEventListener('change', () => generateChords({ newSeed: false }));
  ui.melodySeed.addEventListener('change', () => generateMelodyLine({ newSeed: false }));
  ui.newChordSeed.addEventListener('click', () => generateChords({ newSeed: true }));
  ui.newMelodySeed.addEventListener('click', () => generateMelodyLine({ newSeed: true }));

  window.addEventListener('resize', () => renderRoll());

  // --- boot -----------------------------------------------------------------

  syncMode();
  if (m.chords.length) {
    m.voicings = voiceProgression(m.chords, { octave: 3 });
    renderChords();
    renderRoll();
  } else {
    generateChords({ newSeed: true });
  }

  return {
    highlight(step) {
      // The progression repeats when the loop is longer than it is, so the
      // playhead has to wrap back to the first card with it.
      const count = m.chords.length;
      const index = m.stepsPerChord && count > 0 && step >= 0
        ? Math.floor(step / m.stepsPerChord) % count
        : -1;
      for (const card of ui.out.children) {
        card.classList?.toggle('is-playing', Number(card.dataset.index) === index);
      }
    },
    redraw: renderRoll,
  };
}
