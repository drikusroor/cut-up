// Lays the generated parts out across one full pass of the loop.
//
// The parts are rarely the same length: a two-bar drum pattern sitting under a
// four-bar progression has to repeat to cover it, the way a looped clip does in
// a DAW. Playback and MIDI export both go through here, so they cannot disagree
// about what the song actually is.
//
// A song can also be a list of `sections` — intro, A, B, coda — in which case
// each one is laid out on its own and the results are strung end to end.

/**
 * Chords have to occupy some time. A stored setting of 0 — which is what a
 * blank select reads back as — would give the progression no length at all,
 * and anything stepping through the loop a chord at a time would never arrive.
 */
function perChord(value) {
  const steps = Math.round(Number(value));
  return Number.isFinite(steps) && steps > 0 ? steps : 16;
}

/** The natural length of a song in steps: however long its longest part is. */
export function naturalSteps(song) {
  const {
    chordVoicings = [], melody = [], rhythm = null,
  } = song || {};
  const stepsPerChord = perChord(song?.stepsPerChord);
  const chordSpan = chordVoicings.length * stepsPerChord;
  const drumSpan = rhythm?.tracks?.[0]?.pattern.length ?? 0;
  const melodyEnd = melody.reduce((max, note) => Math.max(max, note.step + note.length), 0);
  return Math.max(chordSpan, drumSpan, melodyEnd, 16);
}

/**
 * @param {object} song
 * @param {number[][]} [song.chordVoicings] MIDI notes per chord
 * @param {number} [song.stepsPerChord]
 * @param {Array<{midi:number, step:number, length:number, velocity?:number}>} [song.melody]
 * @param {{tracks: Array<{id:string, note:number, pattern:boolean[], velocities:number[]}>}} [song.rhythm]
 * @param {number} [song.totalSteps] loop length; defaults to the longest part
 * @returns {{
 *   totalSteps: number,
 *   chords: Array<{voicing:number[], step:number, length:number}>,
 *   melody: Array<{midi:number, step:number, length:number, velocity?:number}>,
 *   drums: Array<{id:string, note:number, step:number, velocity:number}>,
 * }}
 */
export function arrange(song) {
  if (Array.isArray(song?.sections) && song.sections.length) return arrangeSections(song);

  const {
    chordVoicings = [],
    melody = [],
    rhythm = null,
  } = song || {};
  const stepsPerChord = perChord(song?.stepsPerChord);

  const chordSpan = chordVoicings.length * stepsPerChord;
  const drumSpan = rhythm?.tracks?.[0]?.pattern.length ?? 0;
  const melodyEnd = melody.reduce((max, note) => Math.max(max, note.step + note.length), 0);
  // The melody is written against the progression, so the two repeat together
  // even when the melody itself stops short of the last chord.
  const melodySpan = Math.max(chordSpan, melodyEnd);
  const totalSteps = song?.totalSteps || Math.max(chordSpan, drumSpan, melodySpan, 16);

  const chords = [];
  if (chordSpan > 0) {
    for (let step = 0; step < totalSteps; step += stepsPerChord) {
      chords.push({
        voicing: chordVoicings[(step / stepsPerChord) % chordVoicings.length],
        step,
        // A repeat that runs past the end of the loop gets clipped, not dropped.
        length: Math.min(stepsPerChord, totalSteps - step),
      });
    }
  }

  const melodyOut = [];
  for (let offset = 0; melodySpan > 0 && offset < totalSteps; offset += melodySpan) {
    for (const note of melody) {
      const step = offset + note.step;
      if (step >= totalSteps) continue;
      melodyOut.push({ ...note, step, length: Math.min(note.length, totalSteps - step) });
    }
  }

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
        });
      });
    }
  }

  return { totalSteps, chords, melody: melodyOut, drums };
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
      for (const hit of block.drums) drums.push({ ...hit, step: hit.step + offset });
      offset += block.totalSteps;
    }
  }

  return { totalSteps: Math.max(offset, 16), chords, melody, drums };
}
