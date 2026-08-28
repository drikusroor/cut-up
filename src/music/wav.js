// A WAV writer: a 44-byte header and the samples, which is all a WAV is.
//
// Uncompressed and universal — every DAW, every phone, every ancient sampler
// opens one. It is the format to hand a file to something else in; the ones
// with a codec behind them are for sending to a person.

/** The header, in the order the RIFF spec puts it. */
function header({
  channels, sampleRate, bitDepth, dataBytes,
}) {
  const bytes = new Uint8Array(44);
  const view = new DataView(bytes.buffer);
  const ascii = (at, text) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  const blockAlign = channels * (bitDepth / 8);

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true); // everything after this field
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // a PCM fmt chunk is 16 bytes
  view.setUint16(20, 1, true); // 1 is uncompressed PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // bytes per second
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes;
}

/** One sample, clamped and rounded into however many bits it has to fit. */
function writeSample(view, at, value, bitDepth) {
  const clamped = Math.max(-1, Math.min(1, value));
  if (bitDepth === 24) {
    // Signed 24-bit, little end first — three bytes by hand, since DataView
    // has no opinion about them.
    // Asymmetric, like the 16-bit branch below: the bottom of the range is
    // one step further from zero than the top of it.
    const whole = Math.round(clamped * (clamped < 0 ? 8388608 : 8388607));
    const unsigned = whole < 0 ? whole + 0x1000000 : whole;
    view.setUint8(at, unsigned & 0xff);
    view.setUint8(at + 1, (unsigned >> 8) & 0xff);
    view.setUint8(at + 2, (unsigned >> 16) & 0xff);
    return;
  }
  // Asymmetric on purpose: -32768 is a real sample and 32768 is not one.
  view.setInt16(at, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
}

/**
 * Encodes an AudioBuffer as a WAV file.
 *
 * Takes anything shaped like one — `{sampleRate, numberOfChannels, length,
 * getChannelData(i)}` — so the tests can hand it a few hundred samples of a
 * sine wave rather than a browser.
 *
 * @param {AudioBuffer} buffer
 * @param {{bitDepth?: 16|24}} [options]
 * @returns {Uint8Array}
 */
export function encodeWav(buffer, { bitDepth = 16 } = {}) {
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error(`Unsupported bit depth: ${bitDepth}`);
  const channels = Math.max(1, buffer.numberOfChannels);
  const frames = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const dataBytes = frames * channels * bytesPerSample;

  const out = new Uint8Array(44 + dataBytes);
  out.set(header({
    channels, sampleRate: buffer.sampleRate, bitDepth, dataBytes,
  }));
  const view = new DataView(out.buffer, 44);

  // Planar in, interleaved out — WAV wants a frame at a time, both channels.
  const planes = [];
  for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));
  let at = 0;
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channels; c++) {
      writeSample(view, at, planes[c][frame], bitDepth);
      at += bytesPerSample;
    }
  }
  return out;
}

/** How big a WAV of this length would be, without making one. */
export function wavBytes({
  seconds, sampleRate = 44100, channels = 2, bitDepth = 16,
}) {
  return 44 + Math.ceil(seconds * sampleRate) * channels * (bitDepth / 8);
}
