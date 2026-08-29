// Rendering a song to samples, faster than you can listen to it.
//
// Playback books a second or two at a time because it is racing a clock. An
// OfflineAudioContext has no clock to race: it runs as fast as the machine can
// manage and hands back the finished samples. Everything else is the same
// graph, the same voices and the same master bus, so what comes out is what
// you were hearing rather than a second opinion of it.
//
// The one thing it keeps from the transport is the rolling window. A
// seven-minute arrangement is around seventy thousand notes, and building all
// of their nodes before rendering starts is how a tab runs out of memory. So
// the render is suspended every few seconds, the next stretch is booked, and
// it is resumed — which also happens to be the only honest way to say how far
// along it is.

import { songEvents } from './audio.js';
import { masterChain, Synth } from './synth.js';

/** How much of the song is booked at a time, in seconds of finished audio. */
const WINDOW = 4;

/** Room after the last note for the reverbs, releases and cymbals to finish. */
const TAIL = 2.5;

/**
 * Is there an OfflineAudioContext to render into? Every browser this app runs
 * in has one; node, where the tests live, does not.
 */
export function canRender() {
  return typeof globalThis.OfflineAudioContext === 'function'
    || typeof globalThis.webkitOfflineAudioContext === 'function';
}

/**
 * How long a song runs, in seconds, before anyone renders it — so the export
 * dialog can say what it is about to make, and refuse the absurd.
 *
 * @param {object} song
 * @param {{passes?: number, tail?: number}} [options]
 */
export function songSeconds(song, { passes = 1, tail = TAIL } = {}) {
  const synth = new Synth();
  const { clock } = songEvents(synth, song);
  return clock.total * Math.max(1, passes) + tail;
}

/**
 * Renders a song to an AudioBuffer.
 *
 * @param {object} song what AudioEngine#play would take, minus the looping
 * @param {object} [options]
 * @param {number} [options.sampleRate] 44100 unless you want otherwise
 * @param {number} [options.channels] the synth is mono; two is for the players
 *   that still sulk at a mono file
 * @param {number} [options.passes] how many times round the loop
 * @param {number} [options.tail] silence after the last note, for the releases
 * @param {(done:number) => void} [options.onProgress] 0..1, per window
 * @param {{aborted:boolean}} [options.signal] anything with an `aborted` flag —
 *   checked at each window, so a cancelled export stops within a few seconds
 *   of audio rather than at the end of the song
 * @returns {Promise<AudioBuffer>}
 */
export async function renderSong(song, {
  sampleRate = 44100,
  channels = 2,
  passes = 1,
  tail = TAIL,
  onProgress,
  signal,
} = {}) {
  const Ctor = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (!Ctor) throw new Error('This browser cannot render audio offline.');

  // The events have to know which synth they are playing through, and the
  // synth has to know which context it is building in, so the context comes
  // first and its length is worked out from a throwaway pass over the clock.
  const rounds = Math.max(1, Math.round(passes));
  const seconds = songSeconds(song, { passes: rounds, tail });
  const frames = Math.ceil(seconds * sampleRate);
  const ctx = new Ctor(channels, frames, sampleRate);
  const synth = new Synth(ctx, masterChain(ctx));
  synth.setInstruments(song.instruments || {});
  synth.setFeel(song.feel);
  synth.setTuning(song.tuning, song.rootPc ?? 0);
  // The same desk the transport plays through, so a bounce comes out mixed the
  // way you left it rather than flat.
  synth.setMix(song.mix);

  const { events, clock } = songEvents(synth, song);
  // A loop exported twice round is the same list of events twice over, an
  // interval apart — the same thing the transport does when it wraps.
  const pass = clock.total;

  let cursor = 0;
  let round = 0;
  /** Books everything that sounds before `until`, in seconds from the top. */
  const bookUntil = (until) => {
    while (round < rounds) {
      if (cursor >= events.length) {
        round += 1;
        cursor = 0;
        continue;
      }
      const event = events[cursor];
      const at = round * pass + event.at;
      if (at >= until) return;
      try {
        event.play(at);
      } catch {
        // One note the browser will not build must not take the render with it.
      }
      cursor += 1;
    }
  };

  // Suspension times have to land on a render quantum, and every one of them
  // has to be asked for before rendering starts.
  const quantum = 128 / sampleRate;
  const stops = [];
  for (let at = WINDOW; at < seconds; at += WINDOW) {
    stops.push(Math.round(at / quantum) * quantum);
  }

  bookUntil(WINDOW);
  onProgress?.(0);

  for (const at of stops) {
    // eslint-disable-next-line no-loop-func
    ctx.suspend(at).then(() => {
      if (signal?.aborted) {
        // Nothing more is booked, so the rest of the file renders as silence
        // and the caller throws it away.
        ctx.resume();
        return;
      }
      bookUntil(at + WINDOW);
      onProgress?.(Math.min(1, at / seconds));
      ctx.resume();
    }).catch(() => {
      // A context that finished before this suspension could be honoured.
    });
  }

  const buffer = await ctx.startRendering();
  if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
  onProgress?.(1);
  return buffer;
}
