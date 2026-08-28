// A minimal MP4 writer, for putting AAC frames in an .m4a.
//
// The browser will encode AAC for us — WebCodecs does it in hardware where
// there is hardware — but it hands back bare frames with no container around
// them, and a bare AAC frame is not a file anyone can open. So: ftyp, a moov
// describing one audio track, and an mdat with the frames in it. Nothing else
// is needed for a file that plays everywhere, and everything else is left out.
//
// The layout, for anyone reading along with the spec (ISO/IEC 14496-12):
//
//   ftyp                 what kind of file this is
//   moov                 the index — read before a single sample is
//     mvhd               how long the movie is, and in what units
//     trak
//       tkhd             the track's own header
//       mdia
//         mdhd           the media's timescale: samples, for audio
//         hdlr           "this is sound"
//         minf
//           smhd         stereo balance, which we never touch
//           dinf/dref    where the media lives — here, in this file
//           stbl         the tables: what a sample is, when, how big, where
//     mdat               the frames themselves

const ZERO = new Uint8Array(0);

function ascii(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function u8(...values) {
  return new Uint8Array(values);
}

function u16(value) {
  return new Uint8Array([(value >> 8) & 0xff, value & 0xff]);
}

function u32(value) {
  // >>> because a 32-bit field with the top bit set is still a positive number.
  return new Uint8Array([
    (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff,
  ]);
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** size, type, payload — the shape of every box in the file. */
function box(type, ...parts) {
  const body = concat(parts);
  return concat([u32(body.length + 8), ascii(type), body]);
}

/** A box that starts with a version and three flag bytes. */
function fullBox(type, version, flags, ...parts) {
  return box(type, u8(version, (flags >> 16) & 0xff, (flags >> 8) & 0xff, flags & 0xff), ...parts);
}

/** The identity matrix every mp4 carries whether or not it has any picture. */
const MATRIX = concat([
  u32(0x00010000), u32(0), u32(0),
  u32(0), u32(0x00010000), u32(0),
  u32(0), u32(0), u32(0x40000000),
]);

/** MPEG-4 descriptors carry their length in a 7-bits-per-byte string. */
function descriptor(tag, ...parts) {
  const body = concat(parts);
  const length = body.length;
  // The four-byte form is always legal and always long enough, and saves
  // deciding how many bytes a length needs.
  return concat([
    u8(tag),
    u8(0x80 | ((length >> 21) & 0x7f), 0x80 | ((length >> 14) & 0x7f), 0x80 | ((length >> 7) & 0x7f), length & 0x7f),
    body,
  ]);
}

/** The sample rates AAC knows by index, in the order it numbers them. */
const AAC_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350,
];

/**
 * The two bytes that tell a decoder what it is about to decode: profile,
 * sample rate and channel count, packed five-four-four.
 *
 * The encoder normally hands this over itself; this is for the ones that do
 * not, and for the tests, which have no encoder at all.
 *
 * @param {number} sampleRate
 * @param {number} channels
 * @param {number} [objectType] 2 is AAC-LC, which is what everything plays
 */
export function audioSpecificConfig(sampleRate, channels, objectType = 2) {
  const index = AAC_RATES.indexOf(sampleRate);
  if (index < 0) throw new Error(`AAC has no index for ${sampleRate} Hz`);
  return new Uint8Array([
    (objectType << 3) | (index >> 1),
    ((index & 1) << 7) | (channels << 3),
  ]);
}

/** The descriptor tree that says "AAC, and here is its configuration". */
function esds(config, { bitrate, maxFrameBytes }) {
  return fullBox('esds', 0, 0, descriptor(
    0x03, // ES_Descriptor
    u16(1), // ES_ID
    u8(0), // no dependency, no URL, no OCR
    descriptor(
      0x04, // DecoderConfigDescriptor
      u8(0x40), // MPEG-4 audio
      u8(0x15), // an audio stream, upstream flag clear, reserved bit set
      u8((maxFrameBytes >> 16) & 0xff, (maxFrameBytes >> 8) & 0xff, maxFrameBytes & 0xff),
      u32(bitrate),
      u32(bitrate),
      descriptor(0x05, config), // DecoderSpecificInfo — the two bytes above
    ),
    descriptor(0x06, u8(0x02)), // SLConfigDescriptor: predefined, MP4 timing
  ));
}

/** Runs of equal durations, which is what stts is for. */
function timeToSample(durations) {
  const runs = [];
  for (const duration of durations) {
    const last = runs[runs.length - 1];
    if (last && last.delta === duration) last.count += 1;
    else runs.push({ count: 1, delta: duration });
  }
  return fullBox('stts', 0, 0, u32(runs.length), ...runs.flatMap((run) => [u32(run.count), u32(run.delta)]));
}

function sampleTable(frames, durations, {
  sampleRate, channels, bitrate, config,
}, dataOffset) {
  const maxFrameBytes = frames.reduce((max, frame) => Math.max(max, frame.data.length), 0);
  const mp4a = box(
    'mp4a',
    u8(0, 0, 0, 0, 0, 0), // reserved
    u16(1), // data reference index
    u16(0), u16(0), u32(0), // version, revision, vendor
    u16(channels),
    u16(16), // bits per sample, which for a compressed track is a formality
    u16(0), u16(0), // pre_defined, reserved
    u32(sampleRate << 16), // 16.16 fixed point
    esds(config, { bitrate, maxFrameBytes }),
  );

  return box(
    'stbl',
    fullBox('stsd', 0, 0, u32(1), mp4a),
    timeToSample(durations),
    // Everything in one chunk: one entry says so, and stco then needs one
    // offset rather than one per frame.
    fullBox('stsc', 0, 0, u32(1), u32(1), u32(frames.length), u32(1)),
    fullBox('stsz', 0, 0, u32(0), u32(frames.length), ...frames.map((frame) => u32(frame.data.length))),
    fullBox('stco', 0, 0, u32(1), u32(dataOffset)),
  );
}

/**
 * Wraps encoded AAC frames in an .m4a.
 *
 * @param {object} spec
 * @param {Array<{data: Uint8Array, duration?: number}>} spec.frames encoded
 *   frames in order; `duration` is in samples, and defaults to AAC's 1024
 * @param {number} spec.sampleRate
 * @param {number} spec.channels
 * @param {Uint8Array} [spec.description] the AudioSpecificConfig the encoder
 *   handed over; built from the rate and channel count if it did not
 * @param {number} [spec.bitrate] what to claim in the descriptor
 * @returns {Uint8Array} the whole file
 */
export function muxAacMp4({
  frames, sampleRate, channels, description, bitrate = 128000,
}) {
  if (!frames?.length) throw new Error('Nothing to mux: the encoder produced no frames.');
  const config = description?.length ? new Uint8Array(description) : audioSpecificConfig(sampleRate, channels);
  const durations = frames.map((frame) => Math.max(1, Math.round(frame.duration ?? 1024)));
  const duration = durations.reduce((sum, value) => sum + value, 0);

  const ftyp = box('ftyp', ascii('M4A '), u32(512), ascii('M4A '), ascii('mp42'), ascii('isom'));
  const media = concat(frames.map((frame) => frame.data));

  const build = (dataOffset) => {
    const table = sampleTable(frames, durations, {
      sampleRate, channels, bitrate, config,
    }, dataOffset);
    return box(
      'moov',
      fullBox(
        'mvhd', 0, 0,
        u32(0), u32(0), // made and last touched: never, which is honest
        u32(sampleRate), u32(duration),
        u32(0x00010000), // rate: normal speed
        u16(0x0100), // volume: full
        u16(0), u32(0), u32(0), // reserved
        MATRIX,
        ...Array.from({ length: 6 }, () => u32(0)), // pre_defined
        u32(2), // the id the next track would take
      ),
      box(
        'trak',
        fullBox(
          'tkhd', 0, 0x000007, // enabled, in the movie, in the preview
          u32(0), u32(0), u32(1), u32(0), u32(duration),
          u32(0), u32(0), // reserved
          u16(0), u16(0), // layer, alternate group
          u16(0x0100), u16(0), // volume, reserved
          MATRIX,
          u32(0), u32(0), // width and height, which sound does not have
        ),
        box(
          'mdia',
          fullBox('mdhd', 0, 0, u32(0), u32(0), u32(sampleRate), u32(duration), u16(0x55c4), u16(0)),
          fullBox('hdlr', 0, 0, u32(0), ascii('soun'), u32(0), u32(0), u32(0), ascii('SoundHandler\0')),
          box(
            'minf',
            fullBox('smhd', 0, 0, u16(0), u16(0)),
            box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1, ZERO))),
            table,
          ),
        ),
      ),
    );
  };

  // The sample table has to say where the frames are, and that depends on how
  // big the table is. One chunk means one offset, so its size does not change
  // when the number in it does: build the moov once to measure, then again
  // with the offset that measurement gives.
  const measured = build(0);
  const moov = build(ftyp.length + measured.length + 8);
  return concat([ftyp, moov, u32(media.length + 8), ascii('mdat'), media]);
}
