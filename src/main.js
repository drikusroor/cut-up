// App shell: state, persistence, tabs and the shared transport.

import { $, $$, download, toast } from './ui/dom.js';
import { initWords } from './ui/words-panel.js';
import { initChords } from './ui/chords-panel.js';
import { initRhythm } from './ui/rhythm-panel.js';
import { AudioEngine } from './music/audio.js';
import { songToMidi } from './music/midi.js';
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
      melody: [],
      melodyShape: 'wander',
      density: 0.45,
      chordTones: 0.6,
      restiness: 0.2,
      rangeLow: 60,
      rangeHigh: 84,
    },
    rhythm: {
      style: 'euclid',
      steps: 16,
      bars: 2,
      density: 0.5,
      variation: 0.25,
      trackIds: ['kick', 'snare', 'hat'],
      seed: '',
      pattern: null,
    },
  };
}

function loadState() {
  const base = defaultState();
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored) return base;
    return {
      ...base,
      ...stored,
      parts: { ...base.parts, ...(stored.parts || {}) },
      words: { ...base.words, ...(stored.words || {}) },
      music: { ...base.music, ...(stored.music || {}) },
      rhythm: { ...base.rhythm, ...(stored.rhythm || {}) },
    };
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
const ctx = { state, save, audio };

// --- panels -----------------------------------------------------------------

initWords(ctx);
const chordsPanel = initChords(ctx);
const rhythmPanel = initRhythm(ctx);

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

/** Everything the audio engine and the MIDI writer both need. */
function buildSong() {
  const m = state.music;
  const totalChordSteps = m.chords.length * m.stepsPerChord;
  const drumSteps = state.rhythm.pattern?.tracks?.[0]?.pattern.length ?? 0;
  return {
    tempo: state.tempo,
    swing: state.swing,
    chordVoicings: m.voicings,
    stepsPerChord: m.stepsPerChord,
    melody: m.melody,
    rhythm: state.rhythm.pattern,
    // Loop over whichever part is longest, rounded up to whole drum bars.
    totalSteps: Math.max(totalChordSteps, drumSteps, 16),
    parts: state.parts,
    loop: true,
  };
}

function startPlayback() {
  audio.play(buildSong());
}

$('#play').addEventListener('click', startPlayback);
$('#stop').addEventListener('click', () => audio.stop());

$('#export-midi').addEventListener('click', () => {
  const song = buildSong();
  const hasSomething = (state.parts.chords && song.chordVoicings.length)
    || (state.parts.melody && song.melody.length)
    || (state.parts.drums && song.rhythm?.tracks?.length);
  if (!hasSomething) return toast('Nothing to export yet');

  const midi = songToMidi({
    tempo: song.tempo,
    swing: song.swing,
    chordVoicings: state.parts.chords ? song.chordVoicings : [],
    stepsPerChord: song.stepsPerChord,
    melody: state.parts.melody ? song.melody : [],
    rhythm: state.parts.drums ? song.rhythm : null,
  });
  download(`cut-up-${state.music.chordSeed || 'idea'}.mid`, midi, 'audio/midi');
  return undefined;
});

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
    rhythmPanel.highlight(step);
    chordsPanel.highlight(step);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => audio.stop());
