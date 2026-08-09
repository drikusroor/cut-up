// Lays the generated parts out across one full pass of the loop.
//
// The parts are rarely the same length: a two-bar drum pattern sitting under a
// four-bar progression has to repeat to cover it, the way a looped clip does in
// a DAW. Playback and MIDI export both go through here, so they cannot disagree
// about what the song actually is.

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
  const {
    chordVoicings = [],
    stepsPerChord = 16,
    melody = [],
    rhythm = null,
  } = song || {};

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
