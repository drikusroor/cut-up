// Sections: a musical idea you liked, put in a drawer.
//
// A section freezes everything the Chords and Rhythm tabs were showing when you
// saved it — key, progression, melody (base and your hand edits), drum pattern,
// seeds and all. The arrangement is then just an ordered list of those drawers,
// each with a repeat count, which is what turns a loop into a song with an
// intro, a couple of verses, a middle eight and a coda.

import { naturalSteps } from './arrange.js';
import { resolveInstruments } from './instruments.js';
import { singMelody } from './vocal.js';
import { stepsPerBar } from './meter.js';

export const SECTION_KINDS = [
  { id: 'intro', label: 'Intro', hint: 'Sets it up. Optional.' },
  { id: 'main', label: 'Section', hint: 'A verse, a chorus — the body of the song.' },
  { id: 'bridge', label: 'Middle eight', hint: 'The one that goes somewhere else.' },
  { id: 'outro', label: 'Outro / coda', hint: 'Takes it out. Optional.' },
];

export function kindLabel(kind) {
  return SECTION_KINDS.find((k) => k.id === kind)?.label || 'Section';
}

/** Structured clone that also works in the test runner without a DOM. */
export function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Sections are named the way people name them on a lyric sheet: the body
 * sections march through A, B, C, and the bookends take their role as a name.
 */
export function nextSectionName(sections = [], kind = 'main') {
  const used = new Set(sections.map((s) => s.name));
  if (kind === 'main') {
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      if (!used.has(letter)) return letter;
    }
  }
  const base = kindLabel(kind);
  if (!used.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
  }
  return `${base} ${sections.length + 1}`;
}

let counter = 0;
function newId(prefix) {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * Takes a snapshot of the current music and rhythm state.
 *
 * A section remembers the bar it was written in, because the time signature is
 * global but a saved idea is not: a chorus counted in 7/8 is still in 7/8 when
 * the transport has moved on. It can also carry how hard it is played
 * (`dynamics`), how fast relative to the tempo (`tempoScale`), and a line or
 * two saying what makes it different from the others (`traits`) — which is how
 * a composed song explains itself on the shelf.
 *
 * @param {{name: string, kind?: string, music: object, rhythm: object,
 *   meter?: object, dynamics?: number, tempoScale?: number, traits?: string[]}} spec
 */
export function makeSection({
  name, kind = 'main', music, rhythm, meter, dynamics, tempoScale, traits,
}) {
  const section = {
    id: newId('sec'),
    name,
    kind,
    music: clone(music),
    rhythm: clone(rhythm),
    savedAt: Date.now(),
  };
  if (meter) section.meter = clone(meter);
  if (Number.isFinite(dynamics) && dynamics !== 1) section.dynamics = dynamics;
  if (Number.isFinite(tempoScale) && tempoScale !== 1) section.tempoScale = tempoScale;
  if (traits?.length) section.traits = clone(traits);
  return section;
}

/** A copy under a new id and name — the "fork this and take it elsewhere" move. */
export function forkSection(section, sections) {
  return {
    ...clone(section),
    id: newId('sec'),
    name: nextSectionName(sections, section.kind),
    savedAt: Date.now(),
  };
}

/** The playable song hidden inside a section. */
export function sectionSong(section) {
  const music = section?.music || {};
  return {
    chordVoicings: music.voicings || [],
    stepsPerChord: music.stepsPerChord || 16,
    // The words are set on the melody here rather than stored beside it, so a
    // section that has had its tune redrawn is re-sung against the new notes
    // and never plays a syllable that belonged to a note that has gone.
    melody: singMelody(music).notes,
    // The bass is optional, and a section saved before it existed has none.
    bass: music.bassOn === false ? [] : (music.bass || []),
    rhythm: section?.rhythm?.pattern || null,
    // The key it was written in, because an unequal temperament is measured
    // from the tonic and every section keeps its own.
    rootPc: music.rootPc ?? 0,
    // A section stores the *choice* of instrument, not the result, so one left
    // on "from the seed" re-derives its own voices from its own seeds — which
    // is why every section you roll turns up in a different colour.
    instruments: resolveInstruments(music, section?.rhythm),
    // The bar it was counted in, how loud it is played and how fast, all of
    // which the arranger applies as it lays the section down.
    meter: section?.meter || null,
    stepsPerBar: section?.meter ? stepsPerBar(section.meter) : 16,
    dynamics: section?.dynamics ?? 1,
    tempoScale: section?.tempoScale ?? 1,
  };
}

/** How long a section runs, once, in grid steps. */
export function sectionSteps(section) {
  return naturalSteps(sectionSong(section));
}

/**
 * Resolves an arrangement into the blocks that will actually be played, with
 * their start positions — which is what both the transport and the playhead
 * highlight need to know.
 *
 * An entry may also ask for the block to fade, which is a property of *this
 * appearance* of the section rather than of the section itself: a chorus that
 * fades out at the end of the song is the same chorus that came in at full
 * volume four minutes earlier.
 *
 * @param {object[]} sections the library
 * @param {Array<{sectionId: string, repeats?: number, fade?: boolean|object}>} arrangement
 */
export function buildSongPlan(sections = [], arrangement = []) {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const blocks = [];
  let step = 0;

  for (const item of arrangement) {
    const section = byId.get(item?.sectionId);
    // An entry whose section has been deleted is skipped rather than fatal.
    if (!section) continue;
    const repeats = Math.max(1, Math.round(item.repeats || 1));
    const steps = sectionSteps(section);
    blocks.push({
      sectionId: section.id,
      name: section.name,
      kind: section.kind,
      repeats,
      steps,
      start: step,
      length: steps * repeats,
      fade: item.fade || null,
      meter: section.meter || null,
      // Pinning totalSteps keeps a block the same length even when a part is
      // muted, so muting the melody never shortens the section under it.
      song: {
        ...sectionSong(section), totalSteps: steps, repeats, fade: item.fade || null,
      },
    });
    step += steps * repeats;
  }

  return { blocks, totalSteps: step };
}

/**
 * How long a plan lasts, in seconds. Not simply steps × tempo: a section can be
 * taken faster or slower than the transport, and a song with a half-time coda
 * runs longer than its step count says.
 *
 * @param {{blocks: Array<{length:number, song:{tempoScale?:number}}>}} plan
 * @param {number} tempo
 */
export function planSeconds(plan, tempo) {
  const secondsPerStep = 60 / Math.max(20, tempo || 100) / 4;
  return (plan?.blocks || []).reduce(
    (total, block) => total + (block.length * secondsPerStep) / (block.song?.tempoScale || 1),
    0,
  );
}

/** "2:47" — the way a running time is written on a sleeve. */
export function clockTime(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
