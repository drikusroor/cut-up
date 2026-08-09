// App shell: state, persistence, tabs and the shared transport.

import { $, $$, download, toast } from './ui/dom.js';
import { initWords } from './ui/words-panel.js';
import { initChords } from './ui/chords-panel.js';
import { initRhythm } from './ui/rhythm-panel.js';
import { initSong } from './ui/song-panel.js';
import { AudioEngine } from './music/audio.js';
import { songToMidi } from './music/midi.js';
import { buildSongPlan } from './music/sections.js';
import { emptyMelodyEdits } from './music/melody.js';
import { AUTO, resolveInstruments } from './music/instruments.js';
import { randomSeed } from './rng.js';

const STORAGE_KEY = 'cut-up:v1';

function defaultState() {
  return {
    tab: 'words',
    tempo: 96,
    swing: 0,
    parts: { chords: true, melody: true, drums: true },
    words: {
      lang: 'en',
      text: '',
      secondText: '',
      method: 'strips',
      seed: randomSeed(),
      lines: 8, // how many lines to generate
      output: [], // the lines we generated
      titles: [],
      locked: [],
      keepers: [],
      capitalize: true,
      textWeight: 1,
      dictWeight: 0.25,
      imageryWeight: 0.35,
      rarity: 0.2,
      glue: 0.25,
      stripMin: 2,
      stripMax: 4,
      minWords: 4,
      maxWords: 8,
    },
    music: {
      rootPc: 9,
      scaleId: 'minor',
      mode: 'functional',
      length: 4,
      sevenths: 0.2,
      spice: 0.15,
      stepsPerChord: 16,
      ownChords: '',
      chords: [],
      voicings: [],
      locked: [],
      chordSeed: '',
      melodySeed: '',
      // What the generator produced, the deviations you dragged into it, and
      // the two laid over each other — which is the melody that gets played.
      melodyBase: [],
      melodyEdits: emptyMelodyEdits(),
      melody: [],
      melodyShape: 'wander',
      density: 0.45,
      chordTones: 0.6,
      restiness: 0.2,
      rangeLow: 60,
      rangeHigh: 84,
      // 'auto' means "whatever the seed says", so a new roll is a new sound.
      leadInstrument: AUTO,
      harmonyInstrument: AUTO,
    },
    rhythm: {
      style: 'euclid',
      steps: 16,
      bars: 2,
      density: 0.5,
      variation: 0.25,
      trackIds: ['kick', 'snare', 'hat'],
      kit: AUTO,
      seed: '',
      pattern: null,
    },
    // Saved ideas, and the running order built out of them.
    sections: [],
    arrangement: [], // [{ sectionId, repeats }]
    currentSectionId: null,
  };
}

function loadState() {
  const base = defaultState();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored) return base;
    const state = {
      ...base,
      ...stored,
      parts: { ...base.parts, ...(stored.parts || {}) },
      words: { ...base.words, ...(stored.words || {}) },
      music: { ...base.music, ...(stored.music || {}) },
      rhythm: { ...base.rhythm, ...(stored.rhythm || {}) },
      sections: Array.isArray(stored.sections) ? stored.sections : [],
      arrangement: Array.isArray(stored.arrangement) ? stored.arrangement : [],
    };
    // A melody saved before hand edits existed becomes its own base, so the
    // line you left behind is still there and is now draggable.
    if (!state.music.melodyBase?.length && state.music.melody?.length) {
      state.music.melodyBase = state.music.melody.map((note, i) => ({ id: `n${i}`, ...note }));
      state.music.melodyEdits = emptyMelodyEdits();
    }
    return state;
  } catch {
    return base;
  }
}

const state = loadState();

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Private mode, quota, whatever — losing persistence is not fatal.
    }
  }, 250);
}

const audio = new AudioEngine();
const ctx = {
  state,
  save,
  audio,
  // Clicking a chord card or dragging a note plays a single sound with no song
  // around it, so the engine has to be told what the current voices are.
  syncInstruments: () => audio.setInstruments(resolveInstruments(state.music, state.rhythm)),
};
ctx.syncInstruments();

// --- panels -----------------------------------------------------------------

initWords(ctx);
const chordsPanel = initChords(ctx);
const rhythmPanel = initRhythm(ctx);
const songPanel = initSong(ctx, { chords: chordsPanel, rhythm: rhythmPanel });

// --- tabs -------------------------------------------------------------------

function showTab(name) {
  state.tab = name;
  for (const tab of $$('.tab')) {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  for (const panel of $$('.panel')) {
    panel.hidden = panel.id !== `panel-${name}`;
  }
  $('#transport').hidden = name === 'words';
  if (name === 'chords') chordsPanel.redraw();
  if (name === 'song') songPanel.render();
  renderPlayScope();
  save();
}

for (const tab of $$('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}
showTab(state.tab);

// --- transport --------------------------------------------------------------

const tempoInput = $('#tempo');
const swingInput = $('#swing');
const swingOut = $('#out-swing');

tempoInput.value = state.tempo;
swingInput.value = state.swing;
const renderSwing = () => { swingOut.textContent = `${Math.round(Number(swingInput.value) * 100)}%`; };
renderSwing();

tempoInput.addEventListener('change', () => {
  state.tempo = Number(tempoInput.value);
  save();
  if (audio.playing) startPlayback();
});
swingInput.addEventListener('input', renderSwing);
swingInput.addEventListener('change', () => {
  state.swing = Number(swingInput.value);
  save();
  if (audio.playing) startPlayback();
});

for (const part of ['chords', 'melody', 'drums']) {
  const box = $(`#part-${part}`);
  box.checked = state.parts[part];
  box.addEventListener('change', () => {
    state.parts[part] = box.checked;
    save();
    if (audio.playing) startPlayback();
  });
}

/** The loop the Chords and Rhythm tabs are working on. */
function buildLoop() {
  const m = state.music;
  const totalChordSteps = m.chords.length * m.stepsPerChord;
  const drumSteps = state.rhythm.pattern?.tracks?.[0]?.pattern.length ?? 0;
  const melodySteps = m.melody.reduce((max, n) => Math.max(max, n.step + n.length), 0);
  return {
    chordVoicings: m.voicings,
    stepsPerChord: m.stepsPerChord,
    melody: m.melody,
    rhythm: state.rhythm.pattern,
    instruments: resolveInstruments(m, state.rhythm),
    // Loop over whichever part is longest; the shorter ones repeat to fill it.
    totalSteps: Math.max(totalChordSteps, drumSteps, melodySteps, 16),
  };
}

/** The whole arrangement, section by section — null when there isn't one. */
function buildArrangedSong() {
  const plan = buildSongPlan(state.sections, state.arrangement);
  if (!plan.blocks.length) return null;
  return { sections: plan.blocks.map((block) => block.song), totalSteps: plan.totalSteps };
}

/**
 * Whichever of the two the Song tab is asking for. The transport follows the
 * tab you are on, so play means the same thing as whatever is in front of you.
 */
function buildSong({ scope = state.tab === 'song' ? 'song' : 'loop' } = {}) {
  const song = (scope === 'song' && buildArrangedSong()) || buildLoop();
  return {
    ...song, tempo: state.tempo, swing: state.swing, parts: state.parts, loop: true,
  };
}

/** Strips out the parts you have muted, sections and all. */
function applyParts(song, parts) {
  if (song.sections) {
    return { ...song, sections: song.sections.map((section) => applyParts(section, parts)) };
  }
  return {
    ...song,
    chordVoicings: parts.chords ? (song.chordVoicings || []) : [],
    melody: parts.melody ? (song.melody || []) : [],
    rhythm: parts.drums ? (song.rhythm || null) : null,
  };
}

/** True when there is a single note anywhere in an unmuted part. */
function hasAudibleContent(song) {
  if (song.sections) return song.sections.some(hasAudibleContent);
  return Boolean(song.chordVoicings?.length || song.melody?.length || song.rhythm?.tracks?.length);
}

let playbackScope = 'loop';

function startPlayback(options) {
  playbackScope = options?.scope || (state.tab === 'song' ? 'song' : 'loop');
  ctx.syncInstruments();
  audio.play(buildSong({ scope: playbackScope }));
}

function exportMidi(options) {
  const scope = options?.scope || (state.tab === 'song' ? 'song' : 'loop');
  // Muted parts are dropped, but each block keeps the length you heard.
  const song = applyParts(buildSong({ scope }), state.parts);
  if (!hasAudibleContent(song)) return toast('Nothing to export yet');
  const name = scope === 'song' ? 'song' : (state.music.chordSeed || 'idea');
  download(`cut-up-${name}.mid`, songToMidi(song), 'audio/midi');
  return undefined;
}

function renderPlayScope() {
  const scope = $('#play-scope');
  if (state.tab !== 'song') {
    scope.textContent = 'Looping what you have open';
    return;
  }
  const plan = buildSongPlan(state.sections, state.arrangement);
  scope.textContent = plan.blocks.length
    ? `Playing the song — ${Math.max(1, Math.round(plan.totalSteps / 16))} bars`
    : 'No arrangement yet — looping what you have open';
}

/** For changes that alter the sound without altering a note. */
ctx.refreshPlayback = () => {
  if (audio.playing) startPlayback({ scope: playbackScope });
};
ctx.playSong = () => startPlayback({ scope: 'song' });
ctx.exportSong = () => exportMidi({ scope: 'song' });
ctx.onSongChange = () => {
  renderPlayScope();
  if (audio.playing && playbackScope === 'song') startPlayback({ scope: 'song' });
};

$('#play').addEventListener('click', () => startPlayback());
$('#stop').addEventListener('click', () => audio.stop());
$('#export-midi').addEventListener('click', () => exportMidi());

// Space bar toggles playback, except while typing.
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || state.tab === 'words') return;
  const tag = event.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || event.target.isContentEditable) return;
  event.preventDefault();
  if (audio.playing) audio.stop();
  else startPlayback();
});

// --- playhead ---------------------------------------------------------------

let lastStep = -1;
function frame() {
  const step = audio.playing ? audio.currentStep : -1;
  if (step !== lastStep) {
    lastStep = step;
    // While the arrangement is playing, the step means nothing to the chord
    // cards or the drum grid — they are showing one section, not the song.
    const inSong = playbackScope === 'song' && step >= 0;
    rhythmPanel.highlight(inSong ? -1 : step);
    chordsPanel.highlight(inSong ? -1 : step);
    songPanel.highlight(inSong ? step : -1);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => audio.stop());
