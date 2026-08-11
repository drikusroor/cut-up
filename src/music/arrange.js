// Lays the generated parts out across one full pass of the loop.
//
// The parts are rarely the same length: a two-bar drum pattern sitting under a
// four-bar progression has to repeat to cover it, the way a looped clip does in
// a DAW. Playback and MIDI export both go through here, so they cannot disagree
// about what the song actually is.
//
// A song can also be a list of `sections` — intro, A, B, coda — in which case
// each one is laid out on its own and the results are strung end to end. A
// section is more than its notes: it can be played louder or softer than the
// one before it, faded out, counted in a different time signature, or taken at
// a different tempo. The first two are written into the velocities as the
// events are laid down, so playback and the exported file agree without either
// of them having to know what a coda is; the last two come out as maps of
// where, in steps, the pulse and the bar change.

/** What a chord is struck at before a section has its say. */
const CHORD_VELOCITY = 80;

/** The natural length of a song in steps: however long its longest part is. */
export function naturalSteps(song) {
  const {
    chordVoicings = [], stepsPerChord = 16, melody = [], bass = [], rhythm = null,
    stepsPerBar = 16,
  } = song || {};
  const chordSpan = chordVoicings.length * stepsPerChord;
  const drumSpan = rhythm?.tracks?.[0]?.pattern.length ?? 0;
  const end = (notes) => notes.reduce((max, note) => Math.max(max, note.step + note.length), 0);
  // Nothing is ever shorter than one bar, whatever the time signature says a
  // bar is.
  return Math.max(chordSpan, drumSpan, end(melody), end(bass), stepsPerBar);
}

/**
 * How loud a section is, and whether it is going somewhere — the two things
 * that turn a row of loops into an arrangement.
 *
 * `dynamics` is a flat multiplier: 0.7 is the quiet verse after the loud
 * chorus. `fade` is a ramp across the whole block, repeats included, which is
 * how a song ends without ending. It holds full for the first stretch and then
 * goes, because a fade that starts at step one is not a fade, it is a diminuendo.
 *
 * @param {boolean|{from?:number, to?:number, start?:number}} fade
 * @returns {{from:number, to:number, start:number}|null}
 */
export function normalizeFade(fade) {
  if (!fade) return null;
  const spec = fade === true ? {} : fade;
  const num = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
  return {
    from: Math.max(0, num(spec.from, 1)),
    to: Math.max(0, num(spec.to, 0)),
    start: Math.min(0.95, Math.max(0, num(spec.start, 0.3))),
  };
}

/** Where on the ramp a point `p` (0..1) through the block sits. */
function fadeGain(fade, p) {
  if (!fade) return 1;
  if (p <= fade.start) return fade.from;
  const t = Math.min(1, (p - fade.start) / Math.max(0.001, 1 - fade.start));
  return Math.max(0, fade.from + (fade.to - fade.from) * t);
}

/**
 * The gain curve for one block of the arrangement: its dynamics, times its
 * fade if it has one.
 *
 * @param {{dynamics?: number, fade?: any}} section
 * @returns {(p: number) => number} p is 0..1 across the block, repeats included
 */
function levelCurve(section) {
  const raw = Number(section?.dynamics);
  const dynamics = Number.isFinite(raw) ? Math.min(2, Math.max(0.05, raw)) : 1;
  const fade = normalizeFade(section?.fade);
  if (!fade) return () => dynamics;
  return (p) => dynamics * fadeGain(fade, p);
}

/** A velocity, scaled by the block's level and kept inside MIDI's range. */
function atLevel(velocity, level, fallback) {
  const base = Number.isFinite(velocity) ? velocity : fallback;
  return Math.min(127, Math.max(1, Math.round(base * level)));
}

/** How fast a section runs relative to the transport's tempo. */
export function tempoScaleOf(scale) {
  const value = Number(scale);
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(4, Math.max(0.25, value));
}

/**
 * @param {object} song
 * @param {number[][]} [song.chordVoicings] MIDI notes per chord
 * @param {number} [song.stepsPerChord]
 * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.melody]
 * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.bass]
 * @param {{tracks: Array<{id:string, note:number, pattern:boolean[], velocities:number[]}>}} [song.rhythm]
 * @param {{lead?:string, harmony?:string, bass?:string, kit?:string}} [song.instruments]
 * @param {number} [song.rootPc] the key, which is what an unequal temperament is measured from
 * @param {number} [song.stepsPerBar] one bar, from the time signature
 * @param {number} [song.totalSteps] loop length; defaults to the longest part
 * @returns {{
 *   totalSteps: number,
 *   chords: Array<{voicing:number[], step:number, length:number, velocity:number, instrument?:string}>,
 *   melody: Array<{midi:number, step:number, length:number, velocity?:number, instrument?:string}>,
 *   bass: Array<{midi:number, step:number, length:number, velocity?:number, instrument?:string}>,
 *   drums: Array<{id:string, note:number, step:number, velocity:number, kit?:string}>,
 *   tempoMap: Array<{step:number, scale:number}>,
 *   meterMap: Array<{step:number, meter:{beats:number, unit:number}}>,
 * }}
 */
export function arrange(song) {
  if (Array.isArray(song?.sections) && song.sections.length) return arrangeSections(song);

  const {
    chordVoicings = [],
    stepsPerChord = 16,
    melody = [],
    bass = [],
    rhythm = null,
    // Every event is tagged with the voice it should be played on, so a song
    // strung together from sections can change instruments as it goes — and
    // with the key it was written in, because an unequal temperament tunes the
    // notes relative to the tonic and sections do not share one.
    instruments = {},
    rootPc = 0,
    stepsPerBar = 16,
  } = song || {};

  const chordSpan = chordVoicings.length * stepsPerChord;
  const drumSpan = rhythm?.tracks?.[0]?.pattern.length ?? 0;
  const end = (notes) => notes.reduce((max, note) => Math.max(max, note.step + note.length), 0);
  // The melody and the bass are written against the progression, so all three
  // repeat together even when the notes stop short of the last chord.
  const melodySpan = Math.max(chordSpan, end(melody), end(bass));
  const totalSteps = song?.totalSteps || Math.max(chordSpan, drumSpan, melodySpan, stepsPerBar);

  const chords = [];
  if (chordSpan > 0) {
    for (let step = 0; step < totalSteps; step += stepsPerChord) {
      chords.push({
        voicing: chordVoicings[(step / stepsPerChord) % chordVoicings.length],
        step,
        // A repeat that runs past the end of the loop gets clipped, not dropped.
        length: Math.min(stepsPerChord, totalSteps - step),
        velocity: CHORD_VELOCITY,
        instrument: instruments.harmony,
        rootPc,
      });
    }
  }

  /** Repeats a pitched part until it covers the loop, clipping the overhang. */
  const layOut = (notes, instrument) => {
    const out = [];
    for (let offset = 0; melodySpan > 0 && offset < totalSteps; offset += melodySpan) {
      for (const note of notes) {
        const step = offset + note.step;
        if (step >= totalSteps) continue;
        out.push({
          ...note, step, length: Math.min(note.length, totalSteps - step), instrument, rootPc,
        });
      }
    }
    return out;
  };

  const melodyOut = layOut(melody, instruments.lead);
  const bassOut = layOut(bass, instruments.bass);

  const drums = [];
  for (let offset = 0; drumSpan > 0 && offset < totalSteps; offset += drumSpan) {
    for (const track of rhythm.tracks) {
      track.pattern.forEach((on, index) => {
        const step = offset + index;
        if (!on || step >= totalSteps) return;
        drums.push({
          id: track.id,
          note: track.note,
          step,
          velocity: track.velocities?.[index] || 100,
          kit: instruments.kit,
        });
      });
    }
  }

  return {
    totalSteps,
    chords,
    melody: melodyOut,
    bass: bassOut,
    drums,
    tempoMap: [{ step: 0, scale: 1 }],
    meterMap: song?.meter ? [{ step: 0, meter: song.meter }] : [],
  };
}

/** True when two time signatures are the same one. */
function sameMeter(a, b) {
  return Boolean(a) && Boolean(b) && a.beats === b.beats && a.unit === b.unit;
}

/**
 * Strings sections end to end, each one repeated as many times as it asks for.
 * Every section keeps its own progression, melody and kit — the only thing
 * shared across the song is the transport, so tempo and swing stay global,
 * with each section free to lean on them: `tempoScale` takes a coda into half
 * time, `dynamics` and `fade` say how hard it is played and how it ends.
 *
 * @param {{sections: Array<object & {repeats?: number}>}} song
 */
function arrangeSections(song) {
  const chords = [];
  const melody = [];
  const bass = [];
  const drums = [];
  const tempoMap = [];
  const meterMap = [];
  let offset = 0;

  for (const section of song.sections) {
    // A section is an ordinary song, so it goes through the same layout code —
    // shorter parts inside it still repeat to cover the longest one.
    const block = arrange({ ...section, sections: undefined });
    const repeats = Math.max(1, Math.round(section.repeats || 1));
    const span = Math.max(1, block.totalSteps * repeats);
    const level = levelCurve(section);

    const scale = tempoScaleOf(section.tempoScale);
    if (tempoMap.at(-1)?.scale !== scale) tempoMap.push({ step: offset, scale });
    const meter = section.meter || song.meter;
    if (meter && !sameMeter(meterMap.at(-1)?.meter, meter)) meterMap.push({ step: offset, meter });

    for (let pass = 0; pass < repeats; pass++) {
      const passStart = pass * block.totalSteps;
      /** Where this event sits on the block's gain curve. */
      const gain = (step) => level((passStart + step) / span);
      for (const chord of block.chords) {
        chords.push({
          ...chord,
          step: chord.step + offset,
          velocity: atLevel(chord.velocity, gain(chord.step), CHORD_VELOCITY),
        });
      }
      for (const note of block.melody) {
        melody.push({
          ...note, step: note.step + offset, velocity: atLevel(note.velocity, gain(note.step), 96),
        });
      }
      for (const note of block.bass) {
        bass.push({
          ...note, step: note.step + offset, velocity: atLevel(note.velocity, gain(note.step), 100),
        });
      }
      for (const hit of block.drums) {
        drums.push({
          ...hit, step: hit.step + offset, velocity: atLevel(hit.velocity, gain(hit.step), 100),
        });
      }
      offset += block.totalSteps;
    }
  }

  return {
    totalSteps: Math.max(offset, 16), chords, melody, bass, drums, tempoMap, meterMap,
  };
}
