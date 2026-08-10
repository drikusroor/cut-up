// Lays the generated parts out across one full pass of the loop.
//
// The parts are rarely the same length: a two-bar drum pattern sitting under a
// four-bar progression has to repeat to cover it, the way a looped clip does in
// a DAW. Playback and MIDI export both go through here, so they cannot disagree
// about what the song actually is.
//
// A song can also be a list of `sections` — intro, A, B, coda — in which case
// each one is laid out on its own and the results are strung end to end.

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
 *   chords: Array<{voicing:number[], step:number, length:number, instrument?:string}>,
 *   melody: Array<{midi:number, step:number, length:number, velocity?:number, instrument?:string}>,
 *   bass: Array<{midi:number, step:number, length:number, velocity?:number, instrument?:string}>,
 *   drums: Array<{id:string, note:number, step:number, velocity:number, kit?:string}>,
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
    totalSteps, chords, melody: melodyOut, bass: bassOut, drums,
  };
}

/**
 * Strings sections end to end, each one repeated as many times as it asks for.
 * Every section keeps its own progression, melody and kit — the only thing
 * shared across the song is the transport, so tempo and swing stay global.
 *
 * @param {{sections: Array<object & {repeats?: number}>}} song
 */
function arrangeSections(song) {
  const chords = [];
  const melody = [];
  const bass = [];
  const drums = [];
  let offset = 0;

  for (const section of song.sections) {
    // A section is an ordinary song, so it goes through the same layout code —
    // shorter parts inside it still repeat to cover the longest one.
    const block = arrange({ ...section, sections: undefined });
    const repeats = Math.max(1, Math.round(section.repeats || 1));
    for (let pass = 0; pass < repeats; pass++) {
      for (const chord of block.chords) chords.push({ ...chord, step: chord.step + offset });
      for (const note of block.melody) melody.push({ ...note, step: note.step + offset });
      for (const note of block.bass) bass.push({ ...note, step: note.step + offset });
      for (const hit of block.drums) drums.push({ ...hit, step: hit.step + offset });
      offset += block.totalSteps;
    }
  }

  return {
    totalSteps: Math.max(offset, 16), chords, melody, bass, drums,
  };
}
