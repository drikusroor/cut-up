// Turning a rendered song into a file someone can play.
//
// There are three ways a browser will make one, and which of them exists
// depends on the browser rather than on us:
//
//   PCM         we write the WAV ourselves. Always there, always exact.
//   WebCodecs   the browser encodes AAC and hands back frames, which mp4.js
//               wraps in an .m4a. Faster than listening to it.
//   MediaRecorder  the last resort: play the finished audio into a recorder
//               and keep what comes out. It works for whatever codecs the
//               browser will record, and it takes as long as the song does.
//
// No encoder is bundled, because bundling one would mean shipping a megabyte
// of somebody else's C to everyone who only wanted a WAV. What the browser can
// do, it does; what it cannot, the dialog says plainly instead of pretending.

import { muxAacMp4 } from './mp4.js';
import { encodeWav } from './wav.js';

/**
 * The formats worth offering, best first.
 *
 * `recorder` lists the MIME types to try if MediaRecorder is doing the work;
 * the first one it admits to supporting wins.
 */
export const AUDIO_FORMATS = [
  {
    id: 'wav',
    label: 'WAV',
    ext: 'wav',
    mime: 'audio/wav',
    kind: 'pcm',
    blurb: 'Uncompressed, and exactly what was rendered. About 10 MB a minute.',
  },
  {
    id: 'm4a',
    label: 'M4A (AAC)',
    ext: 'm4a',
    mime: 'audio/mp4',
    kind: 'aac',
    codec: 'mp4a.40.2',
    // Only the spelling that names AAC. A browser asked for a plain
    // 'audio/mp4' may well hand back Opus inside it, and an .m4a that only
    // plays in a browser is worse than not offering one.
    recorder: ['audio/mp4;codecs=mp4a.40.2'],
    blurb: 'AAC, small, and plays on everything from a phone to a car stereo.',
  },
  {
    id: 'mp3',
    label: 'MP3',
    ext: 'mp3',
    mime: 'audio/mpeg',
    kind: 'recorder',
    recorder: ['audio/mpeg'],
    blurb: 'The one everybody has a player for — where the browser will make one.',
    // Worth spelling out: this one is missing almost everywhere, and it is not
    // the browser being old.
    missing: 'Almost no browser ships an MP3 encoder, and this one does not. '
      + 'Export a WAV and convert it, or send the M4A instead.',
  },
  {
    id: 'opus-webm',
    label: 'Opus (WebM)',
    ext: 'webm',
    mime: 'audio/webm',
    kind: 'recorder',
    recorder: ['audio/webm;codecs=opus', 'audio/webm'],
    blurb: 'The best sound per byte, if whatever you are sending it to takes it.',
  },
  {
    id: 'opus-ogg',
    label: 'Opus (Ogg)',
    ext: 'ogg',
    mime: 'audio/ogg',
    kind: 'recorder',
    recorder: ['audio/ogg;codecs=opus', 'audio/ogg'],
    blurb: 'The same codec in the container Firefox prefers.',
  },
];

export function audioFormat(id) {
  return AUDIO_FORMATS.find((format) => format.id === id) || AUDIO_FORMATS[0];
}

/** Which of a format's MIME types this browser will record, if any. */
export function recorderMime(format) {
  const Recorder = globalThis.MediaRecorder;
  if (!Recorder?.isTypeSupported) return null;
  return (format.recorder || []).find((mime) => {
    try {
      return Recorder.isTypeSupported(mime);
    } catch {
      return false;
    }
  }) || null;
}

/** A quarter second of nothing — enough to make the encoder produce frames. */
function silence(sampleRate, channels, seconds = 0.25) {
  const length = Math.round(sampleRate * seconds);
  const plane = new Float32Array(length);
  return {
    sampleRate, numberOfChannels: channels, length, duration: seconds, getChannelData: () => plane,
  };
}

let aacProbe = null;

/**
 * Encodes a moment of silence and asks the browser to read it back.
 *
 * The AAC frames come from the browser but the container around them is ours,
 * and a container the browser itself cannot open is not one to hand to
 * anybody. So the whole path is tried once, on something small, before it is
 * offered — and if it fails, the format falls back to the recorder that made
 * the browser's own file format rather than ours.
 */
async function aacRoundTrips(sampleRate, channels) {
  if (aacProbe !== null) return aacProbe;
  const Offline = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  try {
    const blob = await encodeAac(silence(sampleRate, channels), { bitrate: 128000 });
    await new Offline(1, 128, sampleRate).decodeAudioData(await blob.arrayBuffer());
    aacProbe = true;
  } catch {
    aacProbe = false;
  }
  return aacProbe;
}

/**
 * What this browser can actually write, and how.
 *
 * `via` is 'pcm', 'webcodecs' or 'recorder'; only the last of those is
 * realtime, and the dialog says so rather than letting a four-minute export
 * look like it has hung.
 *
 * @param {{sampleRate?: number, channels?: number, bitrate?: number}} [audio]
 * @returns {Promise<Array<object>>} the formats, each with `available`, `via`
 *   and `realtime` filled in
 */
export async function describeFormats({
  sampleRate = 44100, channels = 2, bitrate = 192000,
} = {}) {
  const Encoder = globalThis.AudioEncoder;
  return Promise.all(AUDIO_FORMATS.map(async (format) => {
    const described = { ...format, available: false, via: null, realtime: false };
    if (format.kind === 'pcm') {
      return { ...described, available: true, via: 'pcm' };
    }
    if (format.kind === 'aac' && Encoder?.isConfigSupported) {
      try {
        const { supported } = await Encoder.isConfigSupported({
          codec: format.codec, sampleRate, numberOfChannels: channels, bitrate,
        });
        if (supported && await aacRoundTrips(sampleRate, channels)) {
          return { ...described, available: true, via: 'webcodecs' };
        }
      } catch {
        // An encoder that will not answer the question is an encoder we do not
        // use; fall through to the recorder.
      }
    }
    const mime = recorderMime(format);
    if (mime) {
      return {
        ...described, available: true, via: 'recorder', realtime: true, recorderMime: mime,
      };
    }
    return described;
  }));
}

/** Waits until the encoder has room, so a long song does not queue in memory. */
function drain(encoder, limit = 8) {
  if (encoder.encodeQueueSize <= limit) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (encoder.encodeQueueSize > limit) return;
      clearInterval(timer);
      resolve();
    }, 10);
  });
}

/**
 * AAC, through WebCodecs, wrapped in an .m4a.
 *
 * @param {AudioBuffer} buffer
 * @param {{bitrate?: number, onProgress?: (done:number)=>void, signal?: {aborted:boolean}}} [options]
 * @returns {Promise<Blob>}
 */
export async function encodeAac(buffer, { bitrate = 192000, onProgress, signal } = {}) {
  const Encoder = globalThis.AudioEncoder;
  const Frame = globalThis.AudioData;
  if (!Encoder || !Frame) throw new Error('This browser has no AAC encoder.');

  const { sampleRate, length } = buffer;
  const channels = buffer.numberOfChannels;
  const planes = [];
  for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));

  const frames = [];
  let description = null;
  let failure = null;

  const encoder = new Encoder({
    output: (chunk, metadata) => {
      const config = metadata?.decoderConfig?.description;
      if (config && !description) description = new Uint8Array(config.buffer ?? config).slice();
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      frames.push({ data, duration: (chunk.duration ?? 0) * sampleRate / 1e6 });
    },
    error: (error) => { failure = error; },
  });
  encoder.configure({
    codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate,
  });

  // A second of audio at a time: small enough that cancelling is quick, big
  // enough that the per-call overhead is nothing.
  const block = sampleRate;
  try {
    for (let at = 0; at < length; at += block) {
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      if (failure) throw failure;
      const frameCount = Math.min(block, length - at);
      // WebCodecs takes planar audio as one array with the channels end to end.
      const data = new Float32Array(frameCount * channels);
      for (let c = 0; c < channels; c++) {
        data.set(planes[c].subarray(at, at + frameCount), c * frameCount);
      }
      const audio = new Frame({
        format: 'f32-planar',
        sampleRate,
        numberOfFrames: frameCount,
        numberOfChannels: channels,
        timestamp: Math.round((at / sampleRate) * 1e6),
        data,
      });
      encoder.encode(audio);
      audio.close();
      onProgress?.(Math.min(1, (at + frameCount) / length));
      // eslint-disable-next-line no-await-in-loop
      await drain(encoder);
    }
    await encoder.flush();
  } finally {
    try {
      encoder.close();
    } catch {
      // Already closed by the error that brought us here.
    }
  }
  if (failure) throw failure;

  return new Blob([muxAacMp4({
    frames, sampleRate, channels, description, bitrate,
  })], { type: 'audio/mp4' });
}

/**
 * The realtime path: play the finished audio into a MediaRecorder and keep
 * what falls out. Nothing is heard — the recorder's destination is not
 * connected to the speakers — but it does take as long as the song lasts.
 *
 * @param {AudioBuffer} buffer
 * @param {string} mime what MediaRecorder said it supports
 * @param {{bitrate?: number, onProgress?: (done:number)=>void, signal?: {aborted:boolean}}} [options]
 * @returns {Promise<Blob>}
 */
export function recordBuffer(buffer, mime, { bitrate = 192000, onProgress, signal } = {}) {
  const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
  const Recorder = globalThis.MediaRecorder;
  if (!Ctor || !Recorder) throw new Error('This browser cannot record audio.');

  return new Promise((resolve, reject) => {
    const ctx = new Ctor({ sampleRate: buffer.sampleRate });
    const destination = ctx.createMediaStreamDestination();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);

    const recorder = new Recorder(destination.stream, { mimeType: mime, audioBitsPerSecond: bitrate });
    const parts = [];
    let ticker = null;
    let settled = false;

    const cleanup = () => {
      clearInterval(ticker);
      try {
        source.stop();
      } catch {
        // Already finished.
      }
      ctx.close().catch(() => {});
    };

    recorder.ondataavailable = (event) => {
      if (event.data?.size) parts.push(event.data);
    };
    recorder.onerror = (event) => {
      settled = true;
      cleanup();
      reject(event.error || new Error('The recorder stopped unexpectedly.'));
    };
    recorder.onstop = () => {
      cleanup();
      if (settled) return;
      if (signal?.aborted) reject(new DOMException('Export cancelled', 'AbortError'));
      else resolve(new Blob(parts, { type: mime.split(';')[0] }));
    };

    const seconds = buffer.duration;
    const started = () => {
      recorder.start(1000);
      source.start();
      const from = ctx.currentTime;
      ticker = setInterval(() => {
        if (signal?.aborted) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        onProgress?.(Math.min(1, (ctx.currentTime - from) / seconds));
      }, 200);
      // A recorder stopped on the last sample loses the last packet, so it is
      // given a moment past the end of the song.
      source.onended = () => setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 250);
    };

    // A context made inside a click is usually running already; on iOS it is
    // not, and a recorder fed by a suspended context records silence.
    if (ctx.state === 'running') started();
    else ctx.resume().then(started, reject);
  });
}

/**
 * Encodes a rendered buffer into the chosen format.
 *
 * @param {AudioBuffer} buffer
 * @param {object} format an entry from describeFormats()
 * @param {{bitDepth?: number, bitrate?: number, onProgress?: (done:number)=>void,
 *   signal?: {aborted:boolean}}} [options]
 * @returns {Promise<Blob>}
 */
export async function encodeAudio(buffer, format, options = {}) {
  if (format.via === 'pcm' || format.kind === 'pcm') {
    const bytes = encodeWav(buffer, { bitDepth: options.bitDepth || 16 });
    options.onProgress?.(1);
    return new Blob([bytes], { type: 'audio/wav' });
  }
  if (format.via === 'webcodecs') return encodeAac(buffer, options);
  const mime = format.recorderMime || recorderMime(format);
  if (!mime) throw new Error(`This browser cannot write ${format.label}.`);
  return recordBuffer(buffer, mime, options);
}
