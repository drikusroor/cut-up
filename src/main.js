// App shell: state, persistence, tabs and the shared transport.

import { $, $$, download, toast } from './ui/dom.js';
import { initWords } from './ui/words-panel.js';
import { initChords } from './ui/chords-panel.js';
import { initRhythm } from './ui/rhythm-panel.js';
import { initSong } from './ui/song-panel.js';
import { initFeel } from './ui/feel-panel.js';
import { initTrain } from './ui/train-panel.js';
import { initExportAudio } from './ui/export-panel.js';
import { AudioEngine } from './music/audio.js';
import { songToMidi } from './music/midi.js';
import { buildSongPlan, clockTime, planSeconds } from './music/sections.js';
import { emptyMelodyEdits } from './music/melody.js';
import { AUTO, resolveInstruments } from './music/instruments.js';
import { defaultComposeSettings, normalizeComposeSettings } from './music/compose.js';
import { DEFAULT_METER, meterInfo, normalizeMeter } from './music/meter.js';
import { defaultHumanize, normalizeHumanize } from './music/humanize.js';
import { defaultTuning, normalizeTuning } from './music/tuning.js';
import { randomSeed } from './rng.js';

const STORAGE_KEY = 'cut-up:v1';

function defaultState() {
  return {
    tab: 'words',
    tempo: 96,
    swing: 0,
    // Global, the way tempo and swing are: the time signature the whole song is
    // counted in, how tightly the band plays it, and what it is tuned to.
    meter: { ...DEFAULT_METER },
    feel: defaultHumanize(),
    tuning: defaultTuning(),
    parts: {
      chords: true, melody: true, bass: true, drums: true,
    },
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
      // How long a chord is held, in bars — and what that comes to in steps
      // once the time signature has had its say.
      barsPerChord: 1,
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
      // The bass: optional, written against the drums and the melody at once.
      bassOn: true,
      bassStyle: 'walk',
      bassSeed: '',
      bass: [],
      bassDensity: 0.5,
      bassMotion: 0.5,
      bassCounter: 0.5,
      bassOctave: 2,
      // 'auto' means "whatever the seed says", so a new roll is a new sound.
      leadInstrument: AUTO,
      harmonyInstrument: AUTO,
      bassInstrument: AUTO,
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
    arrangement: [], // [{ sectionId, repeats, fade }]
    currentSectionId: null,
    // What the composer was last asked for — see music/compose.js.
    compose: defaultComposeSettings(),
    // How much say the trained model gets when composing, 0..1. Multiplied by
    // how much the model has actually earned — see ml/model.js.
    tasteStrength: 1,
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
      meter: normalizeMeter(stored.meter || base.meter),
      feel: normalizeHumanize(stored.feel || base.feel),
      tuning: normalizeTuning(stored.tuning || base.tuning),
      sections: Array.isArray(stored.sections) ? stored.sections : [],
      arrangement: Array.isArray(stored.arrangement) ? stored.arrangement : [],
      compose: normalizeComposeSettings(stored.compose || base.compose),
      tasteStrength: Number.isFinite(stored.tasteStrength)
        ? Math.min(1, Math.max(0, stored.tasteStrength)) : base.tasteStrength,
    };
    // A progression saved before time signatures existed knows how long its
    // chords are in steps but not in bars, which is now the thing you set.
    if (!Number.isFinite(state.music.barsPerChord)) {
      state.music.barsPerChord = state.music.stepsPerChord / meterInfo(state.meter).stepsPerBar;
    }
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
  // And what they are tuned to: a temperament is measured from the tonic, so a
  // previewed chord has to know the key as well as the tuning.
  syncFeel: () => {
    audio.setFeel(state.feel);
    audio.setTuning(state.tuning, state.music.rootPc);
  },
};
ctx.syncInstruments();
ctx.syncFeel();

// --- panels -----------------------------------------------------------------

initWords(ctx);
const chordsPanel = initChords(ctx);
// The bass is written against the drums, so a new pattern is a new bass line.
// It has to be hooked up before the Rhythm tab boots, because booting it
// generates a pattern.
ctx.onRhythmChange = () => chordsPanel.rebuildBass();
const rhythmPanel = initRhythm(ctx);
const songPanel = initSong(ctx, { chords: chordsPanel, rhythm: rhythmPanel });

// A bar of a different length is a different grid: the drum pattern is re-laid
// on it, and the chords, melody and bass are re-cut to the new bar. Same seeds,
// so it is the same idea counted differently rather than a new one.
ctx.onMeterChange = () => {
  rhythmPanel.applyMeter();
  chordsPanel.applyMeter();
  renderPlayScope();
  ctx.refreshPlayback?.();
};
const feelPanel = initFeel(ctx);
// The Train tab needs the Song tab to exist first: keeping a hand puts sections
// on the shelf, and composing asks it for the model.
const trainPanel = initTrain(ctx);
ctx.taste = () => trainPanel.model();
// The export dialog is shared: the transport, the Song tab and every card on
// the shelf open the same one.
const exportPanel = initExportAudio(ctx);
// The key lives in the Chords tab but the temperament readout is in the
// transport, so the two have to be introduced.
ctx.onKeyChange = () => {
  ctx.syncFeel();
  feelPanel.refresh();
};

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
  if (name === 'train') trainPanel.refresh();
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

for (const part of ['chords', 'melody', 'bass', 'drums']) {
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
  const bar = meterInfo(state.meter).stepsPerBar;
  const totalChordSteps = m.chords.length * m.stepsPerChord;
  const drumSteps = state.rhythm.pattern?.tracks?.[0]?.pattern.length ?? 0;
  const end = (notes) => notes.reduce((max, n) => Math.max(max, n.step + n.length), 0);
  const bass = m.bassOn ? m.bass : [];
  return {
    chordVoicings: m.voicings,
    stepsPerChord: m.stepsPerChord,
    melody: m.melody,
    bass,
    rhythm: state.rhythm.pattern,
    instruments: resolveInstruments(m, state.rhythm),
    // The key an unequal temperament is measured from.
    rootPc: m.rootPc,
    stepsPerBar: bar,
    // Loop over whichever part is longest; the shorter ones repeat to fill it.
    totalSteps: Math.max(totalChordSteps, drumSteps, end(m.melody), end(bass), bar),
  };
}

/** The whole arrangement, section by section — null when there isn't one. */
function buildArrangedSong() {
  const plan = buildSongPlan(state.sections, state.arrangement);
  if (!plan.blocks.length) return null;
  return { sections: plan.blocks.map((block) => block.song), totalSteps: plan.totalSteps };
}

/**
 * One saved section on its own, played the way the song would play it — same
 * arranger, same voices, same bar — so exporting a section gives you the thing
 * you heard on the shelf rather than a near miss.
 */
function buildSectionSong(section) {
  if (!section) return null;
  const plan = buildSongPlan([section], [{ sectionId: section.id, repeats: 1 }]);
  if (!plan.blocks.length) return null;
  return { sections: plan.blocks.map((block) => block.song), totalSteps: plan.totalSteps };
}

/**
 * Whichever of the three is being asked for: the arrangement, one section, or
 * the loop. The transport follows the tab you are on, so play means the same
 * thing as whatever is in front of you; only an export names a section.
 */
function buildSong({ scope = state.tab === 'song' ? 'song' : 'loop', section = null } = {}) {
  const song = (scope === 'section' && buildSectionSong(section))
    || (scope === 'song' && buildArrangedSong())
    || buildLoop();
  return {
    ...song,
    tempo: state.tempo,
    swing: state.swing,
    // Global, all three: the same bar, the same feel and the same tuning run
    // under every section of the song.
    meter: state.meter,
    feel: state.feel,
    tuning: state.tuning,
    parts: state.parts,
    loop: true,
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
    bass: parts.bass ? (song.bass || []) : [],
    rhythm: parts.drums ? (song.rhythm || null) : null,
  };
}

/** True when there is a single note anywhere in an unmuted part. */
function hasAudibleContent(song) {
  if (song.sections) return song.sections.some(hasAudibleContent);
  return Boolean(song.chordVoicings?.length || song.melody?.length
    || song.bass?.length || song.rhythm?.tracks?.length);
}

let playbackScope = 'loop';

function startPlayback(options) {
  playbackScope = options?.scope || (state.tab === 'song' ? 'song' : 'loop');
  ctx.syncInstruments();
  ctx.syncFeel();
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

/** A file name that will survive a file system: "Section A" becomes "section-a". */
function slug(text, fallback) {
  const cleaned = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return cleaned || fallback;
}

/**
 * Opens the audio export dialog on whatever is being asked for: the whole
 * arrangement, one saved section, or the loop in front of you.
 *
 * Muted parts are left out, exactly as they are left out of the MIDI — what
 * you are exporting is what you have been listening to.
 */
function exportAudio(options) {
  const scope = options?.scope || (state.tab === 'song' ? 'song' : 'loop');
  const section = options?.section || null;
  const song = applyParts({ ...buildSong({ scope, section }), loop: false }, state.parts);
  if (!hasAudibleContent(song)) return toast('Nothing to export yet');

  const names = {
    song: 'song',
    section: slug(section?.name, 'section'),
    loop: slug(state.music.chordSeed, 'idea'),
  };
  const labels = {
    song: 'The song, as arranged.',
    section: `Section ${section?.name || ''}, on its own.`,
    loop: 'The loop you have open, on repeat for as long as you ask.',
  };
  const muted = Object.entries(state.parts).filter(([, on]) => !on).map(([part]) => part);
  const list = muted.length > 1
    ? `${muted.slice(0, -1).join(', ')} and ${muted[muted.length - 1]}`
    : muted[0];
  exportPanel.open({
    song,
    name: `cut-up-${names[scope] || 'export'}`,
    label: labels[scope]
      + (muted.length ? ` The ${list} you have muted ${muted.length > 1 ? 'are' : 'is'} left out.` : ''),
    loop: scope !== 'song',
  });
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
    ? `Playing the song — ${plan.blocks.length} parts, ${clockTime(planSeconds(plan, state.tempo))}`
    : 'No arrangement yet — looping what you have open';
}

/**
 * The transport was changed from somewhere else — the composer picking a tempo,
 * or a section bringing its own time signature back with it. Nothing is
 * regenerated: the controls are simply told what they now say.
 */
ctx.onTransportChange = () => {
  tempoInput.value = String(state.tempo);
  feelPanel.applyState();
  renderPlayScope();
  save();
  ctx.refreshPlayback?.();
};

/** For changes that alter the sound without altering a note. */
ctx.refreshPlayback = () => {
  if (audio.playing) startPlayback({ scope: playbackScope });
};
ctx.playSong = () => startPlayback({ scope: 'song' });

/**
 * Plays a handful of sections that are not part of the song — the hands the
 * Train tab deals. They go through the same arranger, the same voices and the
 * same tuning as everything else, because a card judged through a different
 * signal path is a card judged on the wrong thing.
 */
ctx.playCards = (sections, { tempo, meter } = {}) => {
  const plan = buildSongPlan(sections, sections.map((section) => ({ sectionId: section.id, repeats: 1 })));
  if (!plan.blocks.length) return;
  ctx.syncInstruments();
  ctx.syncFeel();
  playbackScope = 'cards';
  audio.play({
    sections: plan.blocks.map((block) => block.song),
    totalSteps: plan.totalSteps,
    // The hand brings its own tempo and bar; the transport is left alone,
    // because auditioning a card should not quietly rewrite the song you have
    // open on the other tab.
    tempo: tempo || state.tempo,
    swing: state.swing,
    meter: meter || state.meter,
    feel: state.feel,
    tuning: state.tuning,
    parts: state.parts,
    loop: true,
  });
};

/** The Train tab keeping a hand adds sections the Song tab has not drawn yet. */
ctx.refreshSections = () => songPanel.render();
ctx.exportSong = () => exportMidi({ scope: 'song' });
ctx.exportSongAudio = () => exportAudio({ scope: 'song' });
ctx.exportSectionAudio = (section) => exportAudio({ scope: 'section', section });
ctx.onSongChange = () => {
  renderPlayScope();
  if (audio.playing && playbackScope === 'song') startPlayback({ scope: 'song' });
};

$('#play').addEventListener('click', () => startPlayback());
$('#stop').addEventListener('click', () => audio.stop());
$('#export-midi').addEventListener('click', () => exportMidi());
$('#export-audio').addEventListener('click', () => exportAudio());

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
    const inSong = playbackScope !== 'loop' && step >= 0;
    rhythmPanel.highlight(inSong ? -1 : step);
    chordsPanel.highlight(inSong ? -1 : step);
    songPanel.highlight(playbackScope === 'song' && step >= 0 ? step : -1);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => audio.stop());
