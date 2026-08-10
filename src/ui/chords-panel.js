// The Chords & melody tab.

import { $, bindSlider, copyText, el, fillSelect, toast } from './dom.js';
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
import {
  AUTO,
  BASS_INSTRUMENTS,
  bassInstrument,
  HARMONY_INSTRUMENTS,
  harmonyInstrument,
  instrumentOptions,
  LEAD_INSTRUMENTS,
  leadInstrument,
  resolveBass,
  resolveHarmony,
  resolveLead,
} from '../music/instruments.js';
import { BASS_REGISTERS, BASS_STYLES, generateBass } from '../music/bass.js';
import { meterInfo } from '../music/meter.js';
import {
  applyMelodyEdits,
  EDIT_RANGE,
  emptyMelodyEdits,
  generateMelody,
  isNullMove,
  melodyEditCount,
  MELODY_SHAPES,
  MELODY_TRANSFORMS,
  transformMelody,
} from '../music/melody.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;
/** Grabbing this close to a note's right-hand edge resizes it instead. */
const RESIZE_GRIP = 9;
/** How long a chord may be held, in bars. */
const CHORD_LENGTHS = [0.5, 1, 2];

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
    chordLengthHint: $('#chord-length-hint'),
    shape: $('#melody-shape'),
    rangeLow: $('#range-low'),
    rangeHigh: $('#range-high'),
    transforms: $('#melody-transforms'),
    bassOn: $('#bass-on'),
    bassControls: $('#bass-controls'),
    bassStyle: $('#bass-style'),
    bassHint: $('#bass-hint'),
    bassOctave: $('#bass-octave'),
    out: $('#chords-out'),
    roll: $('#piano-roll'),
    genChords: $('#gen-chords'),
    genMelody: $('#gen-melody'),
    genBass: $('#gen-bass'),
    copy: $('#copy-chords'),
    chordSeed: $('#chord-seed'),
    melodySeed: $('#melody-seed'),
    bassSeed: $('#bass-seed'),
    newChordSeed: $('#new-chord-seed'),
    newMelodySeed: $('#new-melody-seed'),
    newBassSeed: $('#new-bass-seed'),
    undoEdit: $('#undo-melody-edit'),
    resetEdits: $('#reset-melody-edits'),
    editStatus: $('#melody-edit-status'),
    lead: $('#lead-instrument'),
    harmony: $('#harmony-instrument'),
    bass: $('#bass-instrument'),
    leadHint: $('#lead-hint'),
    harmonyHint: $('#harmony-hint'),
    bassInstrumentHint: $('#bass-instrument-hint'),
    hearLead: $('#hear-lead'),
    hearHarmony: $('#hear-harmony'),
    hearBass: $('#hear-bass'),
  };

  const sliders = ['sevenths', 'spice'];
  const melodySliders = [
    ['mel-density', 'density'],
    ['chordTones', 'chordTones'],
    ['restiness', 'restiness'],
  ];
  const bassSliders = [
    ['bass-density', 'bassDensity'],
    ['bass-motion', 'bassMotion'],
    ['bass-counter', 'bassCounter'],
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
  fillSelect(ui.lead, instrumentOptions(LEAD_INSTRUMENTS), m.leadInstrument);
  fillSelect(ui.harmony, instrumentOptions(HARMONY_INSTRUMENTS), m.harmonyInstrument);
  fillSelect(ui.bass, instrumentOptions(BASS_INSTRUMENTS), m.bassInstrument);
  fillSelect(ui.bassStyle, BASS_STYLES.map((s) => ({ value: s.id, label: s.label })), m.bassStyle);
  fillSelect(ui.bassOctave, BASS_REGISTERS, m.bassOctave);

  for (const id of sliders) bindSlider($(`#${id}`), $(`#out-${id}`), PERCENT);
  bindSlider($('#mel-density'), $('#out-density'), PERCENT);
  bindSlider($('#chordTones'), $('#out-chordTones'), PERCENT);
  bindSlider($('#restiness'), $('#out-restiness'), PERCENT);
  for (const [id] of bassSliders) bindSlider($(`#${id}`), $(`#out-${id}`), PERCENT);

  ui.transforms.replaceChildren(
    ...MELODY_TRANSFORMS.map((t) => el('button', {
      type: 'button',
      class: 'btn ghost',
      title: t.hint,
      onclick: () => applyTransform(t.id),
    }, [t.label])),
  );

  /** How the bar is counted right now — the transport owns the time signature. */
  const grid = () => meterInfo(state.meter);

  /** The nearest length the picker actually offers, for anything stored oddly. */
  function nearestChordLength(bars) {
    const value = Number(bars);
    if (!Number.isFinite(value)) return 1;
    return CHORD_LENGTHS.reduce((best, option) => (Math.abs(option - value) < Math.abs(best - value) ? option : best), 1);
  }

  /** Writes the stored settings back into the controls. */
  function writeControls() {
    ui.root.value = String(m.rootPc);
    ui.scale.value = m.scaleId;
    ui.mode.value = m.mode;
    ui.own.value = m.ownChords;
    ui.length.value = m.length;
    ui.barsPerChord.value = String(nearestChordLength(m.barsPerChord));
    syncChordLength();
    ui.shape.value = m.melodyShape;
    ui.rangeLow.value = String(m.rangeLow);
    ui.rangeHigh.value = String(m.rangeHigh);
    ui.bassOn.checked = Boolean(m.bassOn);
    ui.bassStyle.value = m.bassStyle;
    ui.bassOctave.value = String(m.bassOctave);
    // Before anything reads the controls, or the stored seeds look like blanks.
    ui.chordSeed.value = m.chordSeed;
    ui.melodySeed.value = m.melodySeed;
    ui.bassSeed.value = m.bassSeed;
    ui.lead.value = m.leadInstrument || AUTO;
    ui.harmony.value = m.harmonyInstrument || AUTO;
    ui.bass.value = m.bassInstrument || AUTO;
    syncSound();
    syncBass();
    for (const id of sliders) $(`#${id}`).value = m[id];
    for (const [id, key] of [...melodySliders, ...bassSliders]) $(`#${id}`).value = m[key];
    for (const id of ['sevenths', 'spice', 'mel-density', 'chordTones', 'restiness', ...bassSliders.map(([x]) => x)]) {
      $(`#${id}`).dispatchEvent(new Event('input'));
    }
  }

  /** What a chord actually lasts, once the time signature has had its say. */
  function syncChordLength() {
    const info = grid();
    ui.chordLengthHint.textContent = `${m.stepsPerChord} steps at ${info.label} — one bar is ${info.stepsPerBar}.`;
  }

  function syncMode() {
    const mode = PROGRESSION_MODES.find((p) => p.id === m.mode);
    ui.hint.textContent = mode ? mode.hint : '';
    ui.ownWrap.hidden = m.mode !== 'cutup';
  }

  function syncBass() {
    const style = BASS_STYLES.find((s) => s.id === m.bassStyle);
    ui.bassHint.textContent = style ? style.hint : '';
    ui.bassControls.hidden = !m.bassOn;
  }

  /** The three voices this idea is currently played with. */
  function currentSound() {
    return {
      lead: resolveLead(m.leadInstrument, m.melodySeed),
      harmony: resolveHarmony(m.harmonyInstrument, m.chordSeed),
      bass: resolveBass(m.bassInstrument, m.bassSeed),
    };
  }

  /**
   * Says which instrument you actually got — the point of "from the seed" is
   * that it changes under you, so it has to be readable.
   */
  function syncSound() {
    const sound = currentSound();
    const describe = (choice, spec) => (choice === AUTO
      ? `From this seed: ${spec.label} — ${spec.hint}`
      : spec.hint);
    ui.leadHint.textContent = describe(m.leadInstrument, leadInstrument(sound.lead));
    ui.harmonyHint.textContent = describe(m.harmonyInstrument, harmonyInstrument(sound.harmony));
    ui.bassInstrumentHint.textContent = describe(m.bassInstrument, bassInstrument(sound.bass));
    ctx.syncInstruments?.();
  }

  function readControls() {
    // A seed the user has typed over wins; an empty box means "surprise me".
    m.chordSeed = ui.chordSeed.value.trim() || randomSeed();
    m.melodySeed = ui.melodySeed.value.trim() || randomSeed();
    m.bassSeed = ui.bassSeed.value.trim() || randomSeed();
    m.rootPc = Number(ui.root.value);
    m.scaleId = ui.scale.value;
    m.mode = ui.mode.value;
    m.ownChords = ui.own.value;
    m.length = Number(ui.length.value);
    // A chord is so many bars long; how many steps that is depends on the bar.
    m.barsPerChord = nearestChordLength(ui.barsPerChord.value);
    m.stepsPerChord = Math.max(1, Math.round(grid().stepsPerBar * m.barsPerChord));
    m.melodyShape = ui.shape.value;
    m.rangeLow = Number(ui.rangeLow.value);
    m.rangeHigh = Number(ui.rangeHigh.value);
    m.leadInstrument = ui.lead.value;
    m.harmonyInstrument = ui.harmony.value;
    m.bassInstrument = ui.bass.value;
    m.bassOn = ui.bassOn.checked;
    m.bassStyle = ui.bassStyle.value;
    m.bassOctave = Number(ui.bassOctave.value);
    if (m.rangeHigh < m.rangeLow + 7) m.rangeHigh = m.rangeLow + 7;
    for (const id of sliders) m[id] = Number($(`#${id}`).value);
    for (const [id, key] of [...melodySliders, ...bassSliders]) m[key] = Number($(`#${id}`).value);
  }

  const totalSteps = () => Math.max(grid().stepsPerBar, m.chords.length * m.stepsPerChord);

  // --- generation -----------------------------------------------------------

  function generateChords({ newSeed = true } = {}) {
    readControls();
    if (newSeed) m.chordSeed = randomSeed();
    ui.chordSeed.value = m.chordSeed;
    // A new seed can mean a new instrument, so the readout has to keep up.
    syncSound();
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
      m.bass = [];
      renderRoll();
      return;
    }

    // Locked chords hold their slot through a reroll.
    m.chords = fresh.map((chord, i) => m.locked[i] || chord);
    m.voicings = voiceProgression(m.chords, { octave: 3 });
    renderChords();
    syncChordLength();
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
    syncSound();
    m.melodyBase = generateMelody({
      rng: makeRng(`melody:${m.melodySeed}`),
      chords: m.chords,
      rootPc: m.rootPc,
      scaleId: m.scaleId,
      stepsPerChord: m.stepsPerChord,
      stepsPerBeat: grid().pulse,
      density: m.density,
      chordTones: m.chordTones,
      restiness: m.restiness,
      shape: m.melodyShape,
      range: [m.rangeLow, m.rangeHigh],
    });
    // A fresh line is a fresh set of notes; deltas aimed at the old ones would
    // land on strangers, so the ledger goes with them.
    discardEdits();
    refreshMelody();
    // The bass is counterpoint to the melody, so a new melody wants a new one.
    generateBassLine({ newSeed: false });
    renderRoll();
    save();
  }

  /**
   * The bass line, written against three things at once: the progression, the
   * drum pattern in the Rhythm tab, and the melody it has to keep out of the
   * way of. Its own seed, so you can keep a bass line you like while rolling
   * everything else — or roll it on its own until it sits right.
   */
  function generateBassLine({ newSeed = true } = {}) {
    readControls();
    if (newSeed) m.bassSeed = randomSeed();
    ui.bassSeed.value = m.bassSeed;
    syncSound();
    if (!m.bassOn) {
      m.bass = [];
      return;
    }
    m.bass = generateBass({
      rng: makeRng(`bass:${m.bassSeed}`),
      chords: m.chords,
      rootPc: m.rootPc,
      scaleId: m.scaleId,
      stepsPerChord: m.stepsPerChord,
      stepsPerBeat: grid().pulse,
      style: m.bassStyle,
      density: m.bassDensity,
      motion: m.bassMotion,
      counter: m.bassCounter,
      octave: m.bassOctave,
      rhythm: state.rhythm.pattern,
      melody: m.melody,
    });
  }

  /** Rolls the bass on its own, keeping the chords and the melody as they are. */
  function rollBass({ newSeed = true } = {}) {
    generateBassLine({ newSeed });
    syncBass();
    renderRoll();
    save();
    ctx.refreshPlayback?.();
  }

  function applyTransform(id) {
    if (!m.melodyBase.length) return;
    // Transforms are the machine's move, so they rewrite the base. Note ids
    // survive them, which means your hand edits ride along on top.
    m.melodyBase = transformMelody(m.melodyBase, id, {
      rng: makeRng(`transform:${randomSeed()}`),
      totalSteps: totalSteps(),
      stepsPerBar: grid().stepsPerBar,
      range: [m.rangeLow, m.rangeHigh],
    });
    refreshMelody();
    // The line the bass was answering has just been turned inside out.
    generateBassLine({ newSeed: false });
    renderRoll();
    save();
  }

  // --- hand edits -----------------------------------------------------------

  const undoStack = [];
  let addCounter = 0;

  function refreshMelody() {
    m.melody = applyMelodyEdits(m.melodyBase, m.melodyEdits, {
      totalSteps: totalSteps(),
      range: EDIT_RANGE,
    });
    renderEditStatus();
  }

  function pushUndo() {
    undoStack.push(JSON.stringify(m.melodyEdits));
    if (undoStack.length > 60) undoStack.shift();
  }

  function discardEdits() {
    m.melodyEdits = emptyMelodyEdits();
    undoStack.length = 0;
  }

  function renderEditStatus() {
    const count = melodyEditCount(m.melodyEdits);
    ui.editStatus.textContent = count
      ? `${count} hand-edited note${count === 1 ? '' : 's'} on top of the generated line`
      : 'Straight from the generator — drag a note to change it.';
    ui.resetEdits.disabled = count === 0;
    ui.undoEdit.disabled = undoStack.length === 0;
  }

  function undoEdit() {
    if (!undoStack.length) return;
    m.melodyEdits = JSON.parse(undoStack.pop());
    refreshMelody();
    renderRoll();
    save();
  }

  function resetEdits() {
    if (!melodyEditCount(m.melodyEdits)) return;
    pushUndo();
    m.melodyEdits = emptyMelodyEdits();
    refreshMelody();
    renderRoll();
    save();
    toast('Back to the generated melody');
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
          onclick: () => audio.strum(voicing, currentSound().harmony),
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

  // The roll's geometry, kept around between frames because the pointer
  // handlers need to turn an (x, y) back into a step and a MIDI note. It is
  // frozen while you drag, so the view cannot shift under your own hand.
  let view = null;

  function measure() {
    const width = ui.roll.clientWidth || 640;
    const steps = totalSteps();
    const pitches = [
      ...m.melody.map((n) => n.midi),
      ...m.melodyBase.map((n) => n.midi),
      ...(m.bassOn ? m.bass.map((n) => n.midi) : []),
      ...m.voicings.flat(),
      m.rangeLow,
      m.rangeHigh,
    ].filter(Number.isFinite);
    const low = (pitches.length ? Math.min(...pitches) : 60) - 2;
    const high = (pitches.length ? Math.max(...pitches) : 84) + 2;
    const rows = Math.max(1, high - low + 1);
    // Rows have to stay thick enough to hit with a finger, but the whole roll
    // has to stay a sensible height on screen, so meet in the middle.
    const rowHeight = Math.max(8, Math.min(18, 380 / rows));
    return {
      width,
      height: Math.max(200, Math.round(rows * rowHeight)),
      low,
      high,
      rows,
      rowHeight,
      steps,
      stepWidth: width / steps,
    };
  }

  function renderRoll() {
    if (!view || !view.frozen) view = measure();
    const {
      width, height, low, high, rowHeight, stepWidth, steps,
    } = view;

    const canvas = ui.roll;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);

    if (!m.melody.length && !m.chords.length) {
      g.fillStyle = '#6d685c';
      g.font = '13px system-ui, sans-serif';
      g.fillText('No melody yet.', 12, 24);
      return;
    }

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
        g.fillRect(
          index * m.stepsPerChord * stepWidth + 1,
          (high - midi) * rowHeight,
          m.stepsPerChord * stepWidth - 2,
          rowHeight - 1,
        );
      }
    });

    // Beats, then bars over them, then the chord changes over those — three
    // weights, so a bar of five reads as five and not as an accident.
    const info = grid();
    g.lineWidth = 1;
    const rule = (every, colour) => {
      if (!(every > 0)) return;
      g.strokeStyle = colour;
      for (let step = 0; step <= steps; step += every) {
        g.beginPath();
        g.moveTo(step * stepWidth + 0.5, 0);
        g.lineTo(step * stepWidth + 0.5, height);
        g.stroke();
      }
    };
    rule(info.pulse, 'rgba(255,255,255,0.05)');
    rule(info.stepsPerBar, 'rgba(255,255,255,0.12)');
    rule(m.stepsPerChord, 'rgba(255,255,255,0.18)');

    // Ghosts: where the generator originally put the notes you have since moved
    // or struck out. This is the whole point of keeping edits as deviations —
    // you can always see how far you have drifted.
    const { moves = {}, removed = [] } = m.melodyEdits || {};
    const struck = new Set(removed);
    g.strokeStyle = 'rgba(234, 230, 217, 0.3)';
    g.setLineDash([3, 3]);
    for (const note of m.melodyBase) {
      if (!struck.has(note.id) && isNullMove(moves[note.id])) continue;
      if (note.midi < low || note.midi > high) continue;
      g.strokeRect(
        note.step * stepWidth + 1.5,
        (high - note.midi) * rowHeight + 1.5,
        Math.max(3, note.length * stepWidth - 3),
        Math.max(3, rowHeight - 3),
      );
    }
    g.setLineDash([]);

    // The bass, underneath and in its own colour. It is drawn but not draggable
    // — it is written against the melody and the drums, so it is rolled rather
    // than edited.
    if (m.bassOn) {
      g.fillStyle = '#5b8dd6';
      for (const note of m.bass) {
        if (note.midi < low || note.midi > high) continue;
        roundRect(
          g,
          note.step * stepWidth + 1,
          (high - note.midi) * rowHeight + 1,
          Math.max(3, note.length * stepWidth - 2),
          Math.max(3, rowHeight - 2),
          2,
        );
        g.fill();
      }
    }

    // Notes. Edited ones wear a different colour so the deviations stand out.
    for (const note of m.melody) {
      const x = note.step * stepWidth;
      const y = (high - note.midi) * rowHeight;
      const w = Math.max(3, note.length * stepWidth - 2);
      const h = Math.max(3, rowHeight - 2);
      g.fillStyle = note.edited ? '#7fbf6a' : '#e2543c';
      roundRect(g, x + 1, y + 1, w, h, 2);
      g.fill();
      // A grip on the right-hand edge, so it looks like it can be stretched.
      if (w > RESIZE_GRIP * 1.5) {
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(x + 1 + w - 2.5, y + 2, 1.5, h - 2);
      }
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

  // --- dragging notes -------------------------------------------------------

  let drag = null;

  function pointerAt(event) {
    const rect = ui.roll.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function midiAt(y) {
    return view.high - Math.floor(y / view.rowHeight);
  }

  function noteAt(x, y) {
    const midi = midiAt(y);
    const step = x / view.stepWidth;
    // Backwards, so the note drawn on top is the one you grab.
    for (let i = m.melody.length - 1; i >= 0; i--) {
      const note = m.melody[i];
      if (note.midi === midi && step >= note.step && step < note.step + note.length) return note;
    }
    return null;
  }

  function moveOf(id) {
    return { dMidi: 0, dStep: 0, dLength: 0, ...(m.melodyEdits.moves[id] || {}) };
  }

  /** Files a note as struck out — or drops it, if you drew it in yourself. */
  function removeNote(note) {
    pushUndo();
    const added = m.melodyEdits.added;
    const index = added.findIndex((n) => n.id === note.id);
    if (index >= 0) {
      added.splice(index, 1);
      delete m.melodyEdits.moves[note.id];
    } else {
      m.melodyEdits.removed.push(note.id);
    }
    refreshMelody();
    renderRoll();
    save();
  }

  function addNote(x, y) {
    const step = Math.max(0, Math.min(view.steps - 1, Math.floor(x / view.stepWidth)));
    const midi = Math.max(EDIT_RANGE[0], Math.min(EDIT_RANGE[1], midiAt(y)));
    pushUndo();
    addCounter += 1;
    m.melodyEdits.added.push({
      id: `add${Date.now().toString(36)}${addCounter}`,
      midi,
      step,
      length: Math.min(2, view.steps - step),
      velocity: 96,
    });
    refreshMelody();
    renderRoll();
    save();
    audio.preview(midi);
  }

  ui.roll.addEventListener('pointerdown', (event) => {
    if (!view || event.button === 2) return;
    const { x, y } = pointerAt(event);
    const note = noteAt(x, y);

    if (!note) {
      // Empty canvas: a plain click does nothing (you are probably about to
      // double-click), but a modified one draws a note straight in.
      if (event.altKey || event.metaKey || event.shiftKey) addNote(x, y);
      return;
    }
    if (event.altKey || event.metaKey) {
      removeNote(note);
      return;
    }

    const noteWidth = note.length * view.stepWidth;
    const fromRight = (note.step + note.length) * view.stepWidth - x;
    const mode = fromRight < Math.min(RESIZE_GRIP, noteWidth * 0.4) ? 'resize' : 'move';

    view.frozen = true;
    drag = {
      id: note.id, mode, startX: x, startY: y, from: moveOf(note.id), midi: note.midi, dirty: false,
    };
    ui.roll.setPointerCapture(event.pointerId);
    ui.roll.style.cursor = mode === 'resize' ? 'ew-resize' : 'grabbing';
    event.preventDefault();
  });

  ui.roll.addEventListener('pointermove', (event) => {
    if (!view) return;
    const { x, y } = pointerAt(event);

    if (!drag) {
      const note = noteAt(x, y);
      const fromRight = note ? (note.step + note.length) * view.stepWidth - x : Infinity;
      ui.roll.style.cursor = !note ? 'default'
        : (fromRight < Math.min(RESIZE_GRIP, note.length * view.stepWidth * 0.4) ? 'ew-resize' : 'grab');
      return;
    }

    const dStep = Math.round((x - drag.startX) / view.stepWidth);
    // Screen y grows downwards; pitch does not.
    const dMidi = -Math.round((y - drag.startY) / view.rowHeight);
    const next = drag.mode === 'resize'
      ? { ...drag.from, dLength: drag.from.dLength + dStep }
      : { ...drag.from, dStep: drag.from.dStep + dStep, dMidi: drag.from.dMidi + dMidi };

    const current = m.melodyEdits.moves[drag.id];
    if (current && current.dMidi === next.dMidi && current.dStep === next.dStep
      && current.dLength === next.dLength) return;

    // The undo entry is taken on the first real movement, so a click that turns
    // out to be a click does not leave a step in the history.
    if (!drag.dirty) {
      pushUndo();
      drag.dirty = true;
    }
    m.melodyEdits.moves[drag.id] = next;
    refreshMelody();
    renderRoll();

    const landed = m.melody.find((n) => n.id === drag.id);
    if (landed && landed.midi !== drag.midi) {
      drag.midi = landed.midi;
      audio.preview(landed.midi);
    }
  });

  function endDrag(event) {
    if (!drag) return;
    // A drag that came back to where it started leaves no deviation behind.
    if (isNullMove(m.melodyEdits.moves[drag.id])) delete m.melodyEdits.moves[drag.id];
    drag = null;
    view.frozen = false;
    ui.roll.style.cursor = 'default';
    if (event?.pointerId != null && ui.roll.hasPointerCapture(event.pointerId)) {
      ui.roll.releasePointerCapture(event.pointerId);
    }
    refreshMelody();
    renderRoll();
    save();
  }

  ui.roll.addEventListener('pointerup', endDrag);
  ui.roll.addEventListener('pointercancel', endDrag);

  ui.roll.addEventListener('dblclick', (event) => {
    if (!view) return;
    const { x, y } = pointerAt(event);
    if (noteAt(x, y)) return;
    addNote(x, y);
  });

  // Right-click deletes, which is what every piano roll does.
  ui.roll.addEventListener('contextmenu', (event) => {
    if (!view) return;
    const { x, y } = pointerAt(event);
    const note = noteAt(x, y);
    if (!note) return;
    event.preventDefault();
    removeNote(note);
  });

  // --- events ---------------------------------------------------------------

  ui.genChords.addEventListener('click', () => generateChords({ newSeed: true }));
  ui.genMelody.addEventListener('click', () => generateMelodyLine({ newSeed: true }));
  ui.genBass.addEventListener('click', () => {
    if (!ui.bassOn.checked) ui.bassOn.checked = true;
    rollBass({ newSeed: true });
  });
  ui.bassOn.addEventListener('change', () => rollBass({ newSeed: false }));
  ui.mode.addEventListener('change', () => { readControls(); syncMode(); save(); });
  ui.copy.addEventListener('click', () => {
    const flats = keyUsesFlats(m.rootPc, m.scaleId);
    copyText(m.chords.map((c) => chordSymbol(c, flats)).join(' | '), 'Progression copied');
  });
  ui.undoEdit.addEventListener('click', undoEdit);
  ui.resetEdits.addEventListener('click', resetEdits);

  for (const select of [ui.lead, ui.harmony, ui.bass]) {
    select.addEventListener('change', () => {
      m.leadInstrument = ui.lead.value;
      m.harmonyInstrument = ui.harmony.value;
      m.bassInstrument = ui.bass.value;
      syncSound();
      save();
      // Changing an instrument does not change a note, so nothing is
      // regenerated — but if it is playing, you should hear it straight away.
      ctx.refreshPlayback?.();
    });
  }

  // A little of the melody's own range, and the first chord of the progression.
  ui.hearLead.addEventListener('click', () => {
    const root = m.rootPc + 12 * Math.ceil((m.rangeLow - m.rootPc) / 12);
    audio.audition(leadInstrument(currentSound().lead), [root, root + 4, root + 7, root + 12]);
  });
  ui.hearHarmony.addEventListener('click', () => {
    const voicing = m.voicings[0] || [m.rootPc + 48, m.rootPc + 52, m.rootPc + 55];
    audio.strum(voicing, currentSound().harmony);
  });
  // A root, its fifth and the octave, in the register the line is written in.
  ui.hearBass.addEventListener('click', () => {
    const root = 12 * (m.bassOctave + 1) + (m.rootPc % 12);
    audio.audition(bassInstrument(currentSound().bass), [root, root + 7, root + 12, root], {
      gap: 0.22, length: 0.4, gain: 0.22,
    });
  });

  for (const id of ['prog-length', 'bars-per-chord', 'sevenths', 'spice']) {
    $(`#${id}`).addEventListener('change', () => generateChords({ newSeed: false }));
  }
  for (const id of ['root', 'scale']) {
    $(`#${id}`).addEventListener('change', () => {
      generateChords({ newSeed: false });
      // An unequal temperament is measured from the tonic, so a new key is a
      // new set of offsets — and the transport says so.
      ctx.onKeyChange?.();
    });
  }
  for (const id of ['melody-shape', 'mel-density', 'chordTones', 'restiness', 'range-low', 'range-high']) {
    $(`#${id}`).addEventListener('change', () => generateMelodyLine({ newSeed: false }));
  }
  for (const id of ['bass-style', 'bass-density', 'bass-motion', 'bass-counter', 'bass-octave']) {
    $(`#${id}`).addEventListener('change', () => rollBass({ newSeed: false }));
  }
  ui.own.addEventListener('change', () => generateChords({ newSeed: true }));

  // Typing a seed in replays it; the dice roll a fresh one for that part only.
  ui.chordSeed.addEventListener('change', () => generateChords({ newSeed: false }));
  ui.melodySeed.addEventListener('change', () => generateMelodyLine({ newSeed: false }));
  ui.bassSeed.addEventListener('change', () => rollBass({ newSeed: false }));
  ui.newChordSeed.addEventListener('click', () => generateChords({ newSeed: true }));
  ui.newMelodySeed.addEventListener('click', () => generateMelodyLine({ newSeed: true }));
  ui.newBassSeed.addEventListener('click', () => rollBass({ newSeed: true }));

  document.addEventListener('keydown', (event) => {
    if (state.tab !== 'chords' || !(event.ctrlKey || event.metaKey) || event.key !== 'z') return;
    const tag = event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target.isContentEditable) return;
    event.preventDefault();
    undoEdit();
  });

  window.addEventListener('resize', () => renderRoll());

  // --- boot -----------------------------------------------------------------

  writeControls();
  syncMode();
  if (m.chords.length) {
    m.voicings = voiceProgression(m.chords, { octave: 3 });
    renderChords();
    refreshMelody();
    // Somebody who last used this before the bass existed still gets one.
    if (m.bassOn && !m.bass.length) generateBassLine({ newSeed: false });
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
    /**
     * The bar changed length under it. The chords are unaffected — a
     * progression is a list of chords, not of steps — but how long each one is
     * held is not, so the melody and the bass are cut onto the new bar from the
     * same seeds. Hand edits are deltas on notes that no longer exist, so they
     * go the way they go on any reroll.
     */
    applyMeter() {
      const before = m.stepsPerChord;
      readControls();
      syncChordLength();
      if (m.stepsPerChord === before || !m.chords.length) {
        renderRoll();
        save();
        return;
      }
      const edits = melodyEditCount(m.melodyEdits);
      generateMelodyLine({ newSeed: false });
      if (edits) toast(`Recounted in ${grid().label} — the melody was rewritten to the new bar`);
    },
    /** New melody over the same chords — what forking a variation does. */
    rerollMelody: () => generateMelodyLine({ newSeed: true }),
    /**
     * The same bass line rewritten against whatever the drums are doing now.
     * The Rhythm tab calls this whenever the pattern changes, which is what
     * keeps the two parts moving together instead of merely coexisting.
     */
    rebuildBass() {
      if (!m.bassOn || !m.chords.length) return;
      generateBassLine({ newSeed: false });
      renderRoll();
      save();
    },
    /** Re-reads state.music after a section has been loaded over it. */
    applyState() {
      undoStack.length = 0;
      writeControls();
      syncMode();
      m.voicings = m.chords.length ? voiceProgression(m.chords, { octave: 3 }) : [];
      renderChords();
      refreshMelody();
      view = null;
      renderRoll();
    },
  };
}
