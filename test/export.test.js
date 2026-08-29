// The export path: the WAV writer, the MP4 muxer, and the renderer's booking.
//
// Everything here runs without a browser. The encoders that only exist in one
// are not tested by pretending — what is tested is the bytes we write
// ourselves, which is where the bugs that produce an unopenable file live.

import test from 'node:test';
import assert from 'node:assert/strict';

import { encodeWav, wavBytes } from '../src/music/wav.js';
import { audioSpecificConfig, muxAacMp4 } from '../src/music/mp4.js';
import { audioFormat, AUDIO_FORMATS, describeFormats } from '../src/music/export-audio.js';
import { canRender, songSeconds } from '../src/music/render.js';
import { songEvents } from '../src/music/audio.js';
import { Synth } from '../src/music/synth.js';

/** An AudioBuffer, as far as anything here is concerned. */
function fakeBuffer(planes, sampleRate = 44100) {
  return {
    sampleRate,
    numberOfChannels: planes.length,
    length: planes[0].length,
    duration: planes[0].length / sampleRate,
    getChannelData: (channel) => planes[channel],
  };
}

/** Reads a RIFF or ISO box tree back, so a test can ask what we wrote. */
function walk(bytes, from = 0, to = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxes = [];
  let at = from;
  while (at + 8 <= to) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    if (size < 8 || at + size > to) break;
    boxes.push({ type, at, size });
    at += size;
  }
  return boxes;
}

const find = (boxes, type) => boxes.find((box) => box.type === type);

// --- WAV --------------------------------------------------------------------

test('a WAV says how big it is, in both places it has to', () => {
  const frames = 64;
  const left = new Float32Array(frames).fill(0.5);
  const right = new Float32Array(frames).fill(-0.5);
  const bytes = encodeWav(fakeBuffer([left, right]));
  const view = new DataView(bytes.buffer);

  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
  assert.equal(bytes.length, 44 + frames * 2 * 2);
  // The RIFF size counts everything after the field itself.
  assert.equal(view.getUint32(4, true), bytes.length - 8);
  assert.equal(view.getUint32(40, true), frames * 2 * 2, 'the data chunk');
  assert.equal(view.getUint16(22, true), 2, 'two channels');
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(28, true), 44100 * 4, 'bytes per second');
  assert.equal(view.getUint16(32, true), 4, 'block align');
  assert.equal(view.getUint16(34, true), 16, 'bit depth');
  assert.equal(bytes.length, wavBytes({ seconds: frames / 44100 }));
});

test('samples are interleaved, and land where they should', () => {
  const left = Float32Array.from([0, 1, -1]);
  const right = Float32Array.from([0.5, -0.5, 0]);
  const bytes = encodeWav(fakeBuffer([left, right]));
  const view = new DataView(bytes.buffer, 44);

  assert.equal(view.getInt16(0, true), 0);
  assert.equal(view.getInt16(2, true), 16384, 'right channel follows left in the same frame');
  assert.equal(view.getInt16(4, true), 32767, 'full scale, not the wrap to -32768');
  assert.equal(view.getInt16(6, true), -16384);
  assert.equal(view.getInt16(8, true), -32768, 'the negative end goes all the way');
});

test('anything past full scale is clamped rather than wrapped', () => {
  const bytes = encodeWav(fakeBuffer([Float32Array.from([4, -4])], 8000));
  const view = new DataView(bytes.buffer, 44);
  assert.equal(view.getInt16(0, true), 32767);
  assert.equal(view.getInt16(2, true), -32768);
});

test('24-bit writes three bytes a sample, little end first', () => {
  const bytes = encodeWav(fakeBuffer([Float32Array.from([1, -1, 0])], 48000), { bitDepth: 24 });
  assert.equal(bytes.length, 44 + 3 * 3);
  const view = new DataView(bytes.buffer, 44);
  const at = (i) => view.getUint8(i) | (view.getUint8(i + 1) << 8) | (view.getUint8(i + 2) << 16);
  assert.equal(at(0), 8388607, 'full positive');
  assert.equal(at(3), 0x1000000 - 8388608, 'full negative, as a two-s complement');
  assert.equal(at(6), 0);
  assert.equal(new DataView(bytes.buffer).getUint16(34, true), 24, 'the header agrees');
});

test('a bit depth we cannot write is refused rather than mangled', () => {
  assert.throws(() => encodeWav(fakeBuffer([new Float32Array(4)]), { bitDepth: 8 }), /bit depth/i);
});

// --- MP4 --------------------------------------------------------------------

const aacFrames = (count, size = 24) => Array.from({ length: count }, (_, i) => ({
  data: new Uint8Array(size + i).fill(i + 1),
}));

test('an m4a is ftyp, moov and mdat, in that order', () => {
  const file = muxAacMp4({ frames: aacFrames(6), sampleRate: 44100, channels: 2 });
  const boxes = walk(file);
  assert.deepEqual(boxes.map((box) => box.type), ['ftyp', 'moov', 'mdat']);
  assert.equal(boxes[boxes.length - 1].at + boxes[boxes.length - 1].size, file.length,
    'the boxes account for every byte');
});

test('the sample table points at the frames it describes', () => {
  const frames = aacFrames(5);
  const file = muxAacMp4({ frames, sampleRate: 44100, channels: 2 });
  const boxes = walk(file);
  const mdat = find(boxes, 'mdat');

  // stco is nested six deep; find it by walking down the tree we wrote.
  const moov = find(boxes, 'moov');
  const trak = find(walk(file, moov.at + 8, moov.at + moov.size), 'trak');
  const mdia = find(walk(file, trak.at + 8, trak.at + trak.size), 'mdia');
  const minf = find(walk(file, mdia.at + 8, mdia.at + mdia.size), 'minf');
  const stbl = find(walk(file, minf.at + 8, minf.at + minf.size), 'stbl');
  const tables = walk(file, stbl.at + 8, stbl.at + stbl.size);
  assert.deepEqual(tables.map((box) => box.type), ['stsd', 'stts', 'stsc', 'stsz', 'stco']);

  const view = new DataView(file.buffer);
  const stco = find(tables, 'stco');
  assert.equal(view.getUint32(stco.at + 16), mdat.at + 8, 'the one chunk starts after the mdat header');

  const stsz = find(tables, 'stsz');
  assert.equal(view.getUint32(stsz.at + 16), frames.length, 'one entry per frame');
  frames.forEach((frame, i) => {
    assert.equal(view.getUint32(stsz.at + 20 + i * 4), frame.data.length);
  });

  // Every frame is 1024 samples, so stts should say so once rather than five times.
  const stts = find(tables, 'stts');
  assert.equal(view.getUint32(stts.at + 12), 1, 'one run');
  assert.equal(view.getUint32(stts.at + 16), frames.length);
  assert.equal(view.getUint32(stts.at + 20), 1024);
});

test('frames of different lengths become separate runs, and set the duration', () => {
  const frames = [
    { data: new Uint8Array(10), duration: 1024 },
    { data: new Uint8Array(10), duration: 1024 },
    { data: new Uint8Array(10), duration: 512 },
  ];
  const file = muxAacMp4({ frames, sampleRate: 48000, channels: 1 });
  const view = new DataView(file.buffer);
  const moov = find(walk(file), 'moov');
  // mvhd is the first box in moov, and its duration field is the fifth word.
  const mvhd = find(walk(file, moov.at + 8, moov.at + moov.size), 'mvhd');
  assert.equal(view.getUint32(mvhd.at + 20), 48000, 'timescale is the sample rate');
  assert.equal(view.getUint32(mvhd.at + 24), 1024 + 1024 + 512, 'duration is in samples');
});

test('the media data is the frames, end to end and unaltered', () => {
  const frames = aacFrames(4, 8);
  const file = muxAacMp4({ frames, sampleRate: 44100, channels: 2 });
  const mdat = find(walk(file), 'mdat');
  const payload = file.slice(mdat.at + 8, mdat.at + mdat.size);
  assert.deepEqual([...payload], frames.flatMap((frame) => [...frame.data]));
});

test('the decoder configuration says AAC-LC at the right rate', () => {
  // 44100 is index 4: 00010 0100 0010 000 -> 0x12 0x10
  assert.deepEqual([...audioSpecificConfig(44100, 2)], [0x12, 0x10]);
  assert.deepEqual([...audioSpecificConfig(48000, 1)], [0x11, 0x88]);
  assert.throws(() => audioSpecificConfig(44101, 2), /index/);
});

test("the encoder's own configuration is used when it gives one", () => {
  const description = Uint8Array.from([0x11, 0x90]);
  const file = muxAacMp4({
    frames: aacFrames(2), sampleRate: 48000, channels: 2, description,
  });
  // It is in there exactly once, inside the esds descriptor.
  const hay = [...file].join(',');
  assert.ok(hay.includes([...description].join(',')), 'the config survives into the file');
});

test('an export with nothing in it fails loudly rather than writing a broken file', () => {
  assert.throws(() => muxAacMp4({ frames: [], sampleRate: 44100, channels: 2 }), /no frames/i);
});

// --- formats ----------------------------------------------------------------

test('every format knows what to call itself and what to write', () => {
  for (const format of AUDIO_FORMATS) {
    assert.ok(format.id && format.label && format.ext && format.mime, format.id);
    assert.ok(['pcm', 'aac', 'recorder'].includes(format.kind), format.kind);
    if (format.kind !== 'pcm') assert.ok(format.recorder?.length, `${format.id} needs a fallback`);
  }
  assert.equal(audioFormat('mp3').ext, 'mp3');
  assert.equal(audioFormat('nonsense').id, 'wav', 'an unknown format falls back to the one that always works');
});

test('WAV is available with no browser at all; the codecs are not', async () => {
  const formats = await describeFormats();
  const wav = formats.find((format) => format.id === 'wav');
  assert.equal(wav.available, true);
  assert.equal(wav.via, 'pcm');
  assert.equal(wav.realtime, false);
  // Node has neither WebCodecs nor MediaRecorder, which is what the dialog
  // greys out rather than offering.
  for (const format of formats.filter((entry) => entry.kind !== 'pcm')) {
    assert.equal(format.available, false, format.id);
  }
});

// --- the renderer -----------------------------------------------------------

const loop = () => ({
  tempo: 120,
  chordVoicings: [[60, 64, 67], [57, 60, 64]],
  stepsPerChord: 16,
  melody: [{ midi: 72, step: 0, length: 4 }],
  bass: [{ midi: 36, step: 0, length: 8 }],
  rhythm: { tracks: [{ id: 'kick', pattern: [true, false, false, false], velocities: [100, 0, 0, 0] }] },
  totalSteps: 32,
});

test('a render is as long as the song, plus room for the last note to finish', () => {
  const song = loop();
  // 32 steps at 120bpm is four seconds, and the tail is added on top.
  const once = songSeconds(song, { tail: 0 });
  assert.ok(Math.abs(once - 4) < 1e-9, `four seconds, got ${once}`);
  assert.ok(Math.abs(songSeconds(song, { passes: 3, tail: 0 }) - 12) < 1e-9);
  assert.ok(songSeconds(song) > once, 'the tail is not free');
});

test('there is nothing to render into without a browser, and it says so', () => {
  assert.equal(canRender(), typeof globalThis.OfflineAudioContext === 'function');
});

test('the events an export books are the events playback books', () => {
  const song = loop();
  const events = songEvents(new Synth(), song).events;
  assert.ok(events.length > 0);
  // Ordered, because both the transport and the renderer walk them in order.
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].at >= events[i - 1].at, 'events come out sorted');
  }
  // Muting a part removes its events and leaves the rest alone.
  const quiet = songEvents(new Synth(), {
    ...song,
    parts: {
      chords: true, melody: false, bass: false, drums: false,
    },
  }).events;
  assert.equal(quiet.length, 2, 'two chords and nothing else');
});
