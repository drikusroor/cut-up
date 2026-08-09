// What things actually sound like.
//
// Every instrument here is a recipe rather than a sample: a stack of
// oscillators, an envelope, a filter, and sometimes a modulator or a puff of
// noise on the attack. The audio engine knows how to build one of these; it
// does not know what a Rhodes is. Each one also carries its General MIDI
// program number, so an exported file opens on roughly the right patch.
//
// The instrument you get can be pinned by hand, or left on "from the seed" —
// in which case it is drawn from the same seed that produced the notes. That
// keeps the app's one promise intact (a seed always gives back the same thing)
// while making every freshly rolled section arrive in a new voice.

import { makeRng, pick } from '../rng.js';

/** The "let the seed decide" choice, valid anywhere an instrument id is. */
export const AUTO = 'auto';

/**
 * @typedef {object} Partial one oscillator inside a voice
 * @property {OscillatorType} [type] waveform, default sine
 * @property {number} [ratio] frequency as a multiple of the note, default 1
 * @property {number} [detune] cents
 * @property {number} [level] mix level, default 1
 * @property {number} [decay] time constant for this partial fading on its own,
 *   which is how a bell loses its overtones before its fundamental
 * @property {{ratio:number, index:number, decay?:number}} [fm] a modulator on
 *   this partial's frequency; `index` is the deviation in Hz
 *
 * @typedef {object} Voice
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {number} program General MIDI program (0-127)
 * @property {number} [gain] level trim, so the set is roughly matched by ear
 * @property {number} [spread] seconds between chord notes, i.e. how strummed
 * @property {{attack:number, decay:number, sustain:number, release:number}} env
 * @property {{type:BiquadFilterType, from:number, to?:number, time?:number, q?:number}} filter
 * @property {Partial[]} partials
 * @property {{rate:number, depth:number, delay?:number}} [vibrato] depth in cents
 * @property {{level:number, decay:number, type:BiquadFilterType, frequency:number}} [noise]
 *   a short burst of filtered noise on the attack — breath, pick, hammer
 */

/** Voices for the melody line. */
export const LEAD_INSTRUMENTS = [
  {
    id: 'saw',
    label: 'Saw lead',
    hint: 'Bright and reedy. The one this app has always used.',
    program: 81,
    gain: 1,
    env: { attack: 0.012, decay: 0.15, sustain: 0.6, release: 0.06 },
    filter: { type: 'lowpass', from: 2600, to: 1100, time: 0.25, q: 3 },
    partials: [{ type: 'sawtooth', level: 1 }],
  },
  {
    id: 'square',
    label: 'Square bleep',
    hint: 'Hard-edged chiptune pulse.',
    program: 80,
    gain: 0.8,
    env: { attack: 0.004, decay: 0.08, sustain: 0.75, release: 0.03 },
    filter: { type: 'lowpass', from: 4200, to: 2600, time: 0.2, q: 1 },
    partials: [
      { type: 'square', level: 1 },
      { type: 'square', ratio: 2, detune: 6, level: 0.18 },
    ],
  },
  {
    id: 'pluck',
    label: 'Plucked string',
    hint: 'Short, dry, percussive — each note gets out of the way.',
    program: 45,
    gain: 1.15,
    env: { attack: 0.003, decay: 0.12, sustain: 0, release: 0.05 },
    filter: { type: 'lowpass', from: 5200, to: 700, time: 0.09, q: 1.2 },
    partials: [
      { type: 'sawtooth', level: 0.8 },
      { type: 'triangle', ratio: 2, level: 0.3, decay: 0.05 },
    ],
    noise: { level: 0.22, decay: 0.012, type: 'highpass', frequency: 2500 },
  },
  {
    id: 'bell',
    label: 'FM bell',
    hint: 'Struck metal with a long tail. Sparse lines suit it.',
    program: 14,
    gain: 0.9,
    env: { attack: 0.002, decay: 0.5, sustain: 0, release: 0.25 },
    filter: { type: 'lowpass', from: 6000, q: 0.5 },
    partials: [
      { type: 'sine', level: 1, fm: { ratio: 3.5, index: 900, decay: 0.18 } },
      { type: 'sine', ratio: 2.01, level: 0.25, decay: 0.35 },
    ],
  },
  {
    id: 'flute',
    label: 'Breathy flute',
    hint: 'Soft attack with air around the note.',
    program: 73,
    gain: 1.25,
    env: { attack: 0.07, decay: 0.2, sustain: 0.85, release: 0.12 },
    filter: { type: 'lowpass', from: 2400, q: 0.8 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 2, level: 0.12 },
    ],
    vibrato: { rate: 5.2, depth: 14, delay: 0.35 },
    noise: { level: 0.07, decay: 0.35, type: 'bandpass', frequency: 2000 },
  },
  {
    id: 'organ',
    label: 'Electric organ',
    hint: 'Drawbars. No attack, no decay, just there.',
    program: 16,
    gain: 0.75,
    env: { attack: 0.008, decay: 0.05, sustain: 1, release: 0.05 },
    filter: { type: 'lowpass', from: 3800, q: 0.4 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 2, level: 0.5 },
      { type: 'sine', ratio: 3, level: 0.28 },
      { type: 'sine', ratio: 4, level: 0.18 },
      { type: 'sine', ratio: 6, level: 0.1 },
    ],
  },
  {
    id: 'brass',
    label: 'Synth brass',
    hint: 'Swells in, then leans on you.',
    program: 62,
    gain: 0.9,
    env: { attack: 0.05, decay: 0.25, sustain: 0.8, release: 0.1 },
    filter: { type: 'lowpass', from: 700, to: 3200, time: 0.12, q: 2 },
    partials: [
      { type: 'sawtooth', detune: -6, level: 1 },
      { type: 'sawtooth', detune: 7, level: 0.7 },
    ],
  },
  {
    id: 'glass',
    label: 'Glass',
    hint: 'Thin and chiming, slightly out of tune with itself.',
    program: 11,
    gain: 0.95,
    env: { attack: 0.004, decay: 0.35, sustain: 0.15, release: 0.2 },
    filter: { type: 'highpass', from: 400, q: 0.5 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 3.01, level: 0.3, decay: 0.25 },
      { type: 'sine', ratio: 5.02, level: 0.12, decay: 0.12 },
    ],
  },
  {
    id: 'vox',
    label: 'Vox',
    hint: 'A vowel, more or less. Wobbles like a singer.',
    program: 54,
    gain: 1.1,
    env: { attack: 0.06, decay: 0.25, sustain: 0.8, release: 0.18 },
    filter: { type: 'lowpass', from: 1500, q: 6 },
    partials: [
      { type: 'sawtooth', level: 0.7 },
      { type: 'triangle', detune: 8, level: 0.5 },
    ],
    vibrato: { rate: 5.6, depth: 18, delay: 0.3 },
  },
];

/**
 * Voices for the bass. Everything down here lives an octave or two below the
 * chords, so the recipes are darker than they look: the filters close early and
 * the bright partials are there for the attack rather than for the tone.
 */
export const BASS_INSTRUMENTS = [
  {
    id: 'finger',
    label: 'Fingered bass',
    hint: 'Round and woody. The one a hand on a string sounds like.',
    program: 33,
    gain: 1,
    env: { attack: 0.006, decay: 0.35, sustain: 0.45, release: 0.09 },
    filter: { type: 'lowpass', from: 2200, to: 620, time: 0.18, q: 1.2 },
    partials: [
      { type: 'triangle', level: 1 },
      { type: 'sawtooth', level: 0.35, decay: 0.16 },
      { type: 'sine', ratio: 2, level: 0.2, decay: 0.3 },
    ],
    noise: { level: 0.1, decay: 0.012, type: 'highpass', frequency: 1800 },
  },
  {
    id: 'sub',
    label: 'Sub',
    hint: 'Almost a pure sine. Felt more than heard.',
    program: 38,
    gain: 0.9,
    env: { attack: 0.008, decay: 0.25, sustain: 0.85, release: 0.09 },
    filter: { type: 'lowpass', from: 900, to: 320, time: 0.25, q: 0.7 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 2, level: 0.12, decay: 0.09 },
    ],
  },
  {
    id: 'pick',
    label: 'Picked bass',
    hint: 'A plectrum on the attack — cuts through a busy kit.',
    program: 34,
    gain: 1,
    env: { attack: 0.003, decay: 0.28, sustain: 0.3, release: 0.08 },
    filter: { type: 'lowpass', from: 3200, to: 800, time: 0.12, q: 1.6 },
    partials: [
      { type: 'sawtooth', level: 0.9 },
      { type: 'square', ratio: 2, level: 0.16, decay: 0.06 },
    ],
    noise: { level: 0.24, decay: 0.008, type: 'highpass', frequency: 2600 },
  },
  {
    id: 'upright',
    label: 'Upright',
    hint: 'Double bass: short, dark, a thump of body under it. Walk with this one.',
    program: 32,
    gain: 1.15,
    env: { attack: 0.01, decay: 0.26, sustain: 0.1, release: 0.14 },
    filter: { type: 'lowpass', from: 1400, to: 380, time: 0.14, q: 1 },
    partials: [
      { type: 'triangle', level: 1 },
      { type: 'sine', ratio: 2, level: 0.22, decay: 0.12 },
      { type: 'sawtooth', level: 0.18, decay: 0.05 },
    ],
    noise: { level: 0.16, decay: 0.02, type: 'bandpass', frequency: 900 },
  },
  {
    id: 'synth',
    label: 'Synth bass',
    hint: 'Saw through a filter that closes as the note goes.',
    program: 38,
    gain: 0.9,
    env: { attack: 0.005, decay: 0.3, sustain: 0.5, release: 0.07 },
    filter: { type: 'lowpass', from: 2600, to: 280, time: 0.13, q: 5 },
    partials: [
      { type: 'sawtooth', level: 1 },
      { type: 'square', ratio: 0.5, level: 0.3 },
    ],
  },
  {
    id: 'acid',
    label: 'Acid',
    hint: 'Squelch. A resonant sweep on every note.',
    program: 39,
    gain: 0.8,
    env: { attack: 0.003, decay: 0.16, sustain: 0.35, release: 0.05 },
    filter: { type: 'lowpass', from: 3400, to: 200, time: 0.07, q: 12 },
    partials: [
      { type: 'sawtooth', level: 1 },
      { type: 'square', detune: 8, level: 0.25 },
    ],
  },
  {
    id: 'fm',
    label: 'FM bass',
    hint: 'A metallic click over a solid fundamental.',
    program: 36,
    gain: 0.95,
    env: { attack: 0.002, decay: 0.3, sustain: 0.35, release: 0.08 },
    filter: { type: 'lowpass', from: 2400, to: 700, time: 0.1, q: 0.8 },
    partials: [
      { type: 'sine', level: 1, fm: { ratio: 2, index: 320, decay: 0.05 } },
      { type: 'sine', ratio: 3, level: 0.14, decay: 0.04 },
    ],
  },
];

/** Voices for the chords underneath. */
export const HARMONY_INSTRUMENTS = [
  {
    id: 'pad',
    label: 'Warm pad',
    hint: 'Soft and sustained. The one this app has always used.',
    program: 89,
    gain: 1,
    spread: 0.012,
    env: { attack: 0.04, decay: 0.4, sustain: 0.7, release: 0.12 },
    filter: { type: 'lowpass', from: 1800, q: 0.5 },
    partials: [
      { type: 'triangle', detune: -4, level: 1 },
      { type: 'sine', detune: 5, level: 0.7 },
    ],
  },
  {
    id: 'strings',
    label: 'Strings',
    hint: 'Bowed — slow in, slow out.',
    program: 48,
    gain: 0.85,
    spread: 0.03,
    env: { attack: 0.12, decay: 0.5, sustain: 0.85, release: 0.3 },
    filter: { type: 'lowpass', from: 2400, q: 0.7 },
    partials: [
      { type: 'sawtooth', detune: -8, level: 0.6 },
      { type: 'sawtooth', detune: 9, level: 0.6 },
      { type: 'sawtooth', ratio: 0.5, level: 0.2 },
    ],
    vibrato: { rate: 4.6, depth: 9, delay: 0.4 },
  },
  {
    id: 'rhodes',
    label: 'Electric piano',
    hint: 'Tine piano: a bell on the attack, wood underneath.',
    program: 4,
    gain: 1.05,
    spread: 0.006,
    env: { attack: 0.004, decay: 0.6, sustain: 0.25, release: 0.15 },
    filter: { type: 'lowpass', from: 3200, to: 1200, time: 0.5, q: 0.7 },
    partials: [
      { type: 'sine', level: 1, fm: { ratio: 2, index: 220, decay: 0.12 } },
      { type: 'sine', ratio: 4, level: 0.12, decay: 0.08 },
    ],
  },
  {
    id: 'organ',
    label: 'Drawbar organ',
    hint: 'Flat as a board, and it never lets go.',
    program: 16,
    gain: 0.7,
    spread: 0,
    env: { attack: 0.01, decay: 0.05, sustain: 1, release: 0.06 },
    filter: { type: 'lowpass', from: 3400, q: 0.4 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 2, level: 0.45 },
      { type: 'sine', ratio: 3, level: 0.25 },
      { type: 'sine', ratio: 8, level: 0.08 },
    ],
  },
  {
    id: 'guitar',
    label: 'Nylon guitar',
    hint: 'Strummed, one string after the other.',
    program: 24,
    gain: 1.1,
    spread: 0.045,
    env: { attack: 0.004, decay: 0.45, sustain: 0.05, release: 0.12 },
    filter: { type: 'lowpass', from: 3600, to: 900, time: 0.2, q: 1 },
    partials: [
      { type: 'triangle', level: 1 },
      { type: 'sawtooth', level: 0.35, decay: 0.12 },
      { type: 'sine', ratio: 2, level: 0.2, decay: 0.3 },
    ],
    noise: { level: 0.18, decay: 0.01, type: 'highpass', frequency: 3000 },
  },
  {
    id: 'choir',
    label: 'Choir',
    hint: 'Ahh.',
    program: 52,
    gain: 1,
    spread: 0.05,
    env: { attack: 0.18, decay: 0.5, sustain: 0.85, release: 0.35 },
    filter: { type: 'lowpass', from: 1300, q: 5 },
    partials: [
      { type: 'sawtooth', detune: -7, level: 0.5 },
      { type: 'triangle', detune: 6, level: 0.6 },
    ],
    vibrato: { rate: 4.8, depth: 12, delay: 0.5 },
  },
  {
    id: 'crystal',
    label: 'Glass bells',
    hint: 'Struck glass with a long shimmer over the bar.',
    program: 98,
    gain: 0.8,
    spread: 0.06,
    env: { attack: 0.003, decay: 0.8, sustain: 0.05, release: 0.5 },
    filter: { type: 'highpass', from: 300, q: 0.5 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 2.76, level: 0.35, decay: 0.4 },
      { type: 'sine', ratio: 5.4, level: 0.12, decay: 0.2 },
    ],
  },
  {
    id: 'brass',
    label: 'Brass section',
    hint: 'Stabs that lean forward.',
    program: 61,
    gain: 0.8,
    spread: 0.02,
    env: { attack: 0.045, decay: 0.3, sustain: 0.7, release: 0.1 },
    filter: { type: 'lowpass', from: 600, to: 2800, time: 0.1, q: 2 },
    partials: [
      { type: 'sawtooth', detune: -5, level: 1 },
      { type: 'sawtooth', detune: 6, level: 0.6 },
      { type: 'square', ratio: 0.5, level: 0.15 },
    ],
  },
  {
    id: 'marimba',
    label: 'Marimba',
    hint: 'Wooden and short, so a held chord turns into a pattern.',
    program: 12,
    gain: 1.15,
    spread: 0.03,
    env: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.08 },
    filter: { type: 'lowpass', from: 3000, q: 0.6 },
    partials: [
      { type: 'sine', level: 1 },
      { type: 'sine', ratio: 4, level: 0.3, decay: 0.06 },
      { type: 'sine', ratio: 9.2, level: 0.08, decay: 0.03 },
    ],
  },
];

/**
 * Kits are not different drums — they are the same synthesis pushed around.
 * `pitch` tunes the whole kit, `decay` stretches every tail, `tone` opens or
 * closes the noise, and `lowpass` puts a lid on the lot.
 */
export const DRUM_KITS = [
  {
    id: 'studio',
    label: 'Studio',
    hint: 'Clean and neutral. The one this app has always used.',
    pitch: 1,
    decay: 1,
    tone: 1,
    gain: 1,
  },
  {
    id: '808',
    label: '808',
    hint: 'Booming kick, thin snare, a cowbell you can hear from space.',
    pitch: 0.82,
    decay: 1.9,
    tone: 0.85,
    gain: 1,
  },
  {
    id: '909',
    label: '909',
    hint: 'Punchy and bright. House and techno.',
    pitch: 1.08,
    decay: 0.8,
    tone: 1.35,
    gain: 1.05,
  },
  {
    id: 'tape',
    label: 'Tape lo-fi',
    hint: 'Dull, soft and a little worn, like a cassette.',
    pitch: 0.95,
    decay: 0.85,
    tone: 0.5,
    gain: 0.95,
    lowpass: 5200,
  },
  {
    id: 'toybox',
    label: 'Toy box',
    hint: 'Small, high and plastic.',
    pitch: 1.7,
    decay: 0.5,
    tone: 1.6,
    gain: 0.85,
  },
  {
    id: 'cardboard',
    label: 'Cardboard',
    hint: 'Boxy and dry. Everything sounds hit with a hand.',
    pitch: 1.15,
    decay: 0.4,
    tone: 0.8,
    gain: 1,
    lowpass: 9000,
  },
];

function byId(list, id) {
  return list.find((item) => item.id === id);
}

/** Looks up a lead voice, falling back to the default rather than throwing. */
export function leadInstrument(id) {
  return byId(LEAD_INSTRUMENTS, id) || LEAD_INSTRUMENTS[0];
}

export function harmonyInstrument(id) {
  return byId(HARMONY_INSTRUMENTS, id) || HARMONY_INSTRUMENTS[0];
}

export function bassInstrument(id) {
  return byId(BASS_INSTRUMENTS, id) || BASS_INSTRUMENTS[0];
}

export function drumKit(id) {
  return byId(DRUM_KITS, id) || DRUM_KITS[0];
}

/**
 * Turns a choice — an explicit id, or `auto` — into a concrete id. `auto`
 * draws from the seed, so the instrument is as reproducible as the notes.
 */
function resolve(list, choice, seed, salt) {
  const chosen = byId(list, choice);
  if (chosen) return chosen.id;
  return pick(makeRng(`${salt}:${seed ?? ''}`), list).id;
}

export function resolveLead(choice, seed) {
  return resolve(LEAD_INSTRUMENTS, choice, seed, 'lead');
}

export function resolveHarmony(choice, seed) {
  return resolve(HARMONY_INSTRUMENTS, choice, seed, 'harmony');
}

export function resolveBass(choice, seed) {
  return resolve(BASS_INSTRUMENTS, choice, seed, 'bass');
}

export function resolveKit(choice, seed) {
  return resolve(DRUM_KITS, choice, seed, 'kit');
}

/**
 * The four concrete voices a piece of music is played with. Sections keep the
 * choice rather than the result, so an `auto` section re-derives its sound from
 * its own seeds — which is what makes every rolled section a new colour.
 *
 * @param {object} music state.music, or a section's copy of it
 * @param {object} [rhythm] state.rhythm, or a section's copy of it
 * @returns {{lead: string, harmony: string, bass: string, kit: string}}
 */
export function resolveInstruments(music = {}, rhythm = {}) {
  return {
    lead: resolveLead(music.leadInstrument, music.melodySeed),
    harmony: resolveHarmony(music.harmonyInstrument, music.chordSeed),
    bass: resolveBass(music.bassInstrument, music.bassSeed),
    kit: resolveKit(rhythm?.kit, rhythm?.seed),
  };
}

/** Options for a <select>, with "let the seed decide" on top. */
export function instrumentOptions(list) {
  return [
    { value: AUTO, label: '🎲 From the seed' },
    ...list.map((item) => ({ value: item.id, label: item.label })),
  ];
}
