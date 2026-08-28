// The export dialog: pick a format, watch the bar, get a file.
//
// The two slow halves are kept apart on purpose. Rendering is the same for
// every format and is over in a few seconds; encoding is either just as quick
// or, when the browser will only give us a MediaRecorder, exactly as long as
// the song. The status line says which of those is happening, because a bar
// that sits still for three minutes without explaining itself is a bug as far
// as anyone watching it is concerned.

import { $, download, el, fillSelect, toast } from './dom.js';
import { canRender, renderSong, songSeconds } from '../music/render.js';
import { describeFormats, encodeAudio } from '../music/export-audio.js';
import { clockTime } from '../music/sections.js';
import { wavBytes } from '../music/wav.js';

const SAMPLE_RATE = 44100;
const CHANNELS = 2;

/** The compressed formats are offered at these; WAV is offered at these depths. */
const BITRATES = [
  { value: '128000', label: '128 kbps' },
  { value: '192000', label: '192 kbps — good' },
  { value: '256000', label: '256 kbps' },
  { value: '320000', label: '320 kbps — best' },
];
const DEPTHS = [
  { value: '16', label: '16-bit — CD' },
  { value: '24', label: '24-bit — studio' },
];

/** "4.2 MB", or "812 KB" — a size you can hold in your head. */
function fileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * @param {object} ctx the app context — used for its audio engine, so an
 *   export can stop whatever is currently playing over it
 */
export function initExportAudio(ctx) {
  const ui = {
    dialog: $('#export-audio-dialog'),
    scope: $('#export-audio-scope'),
    format: $('#export-audio-format'),
    blurb: $('#export-audio-blurb'),
    quality: $('#export-audio-quality'),
    passes: $('#export-audio-passes'),
    passesField: $('#export-audio-passes-field'),
    estimate: $('#export-audio-estimate'),
    progress: $('#export-audio-progress'),
    bar: $('#export-audio-bar'),
    status: $('#export-audio-status'),
    close: $('#export-audio-close'),
    go: $('#export-audio-go'),
  };

  // What is being exported, and what to call the file when it lands.
  let request = null;
  // Asked of the browser once — the answer cannot change mid-session.
  let formats = null;
  let running = null;
  // What was picked last time, so the dialog does not forget between exports.
  let chose = null;

  const chosen = () => formats?.find((format) => format.id === ui.format.value) || formats?.[0];
  const passes = () => Math.max(1, Math.min(16, Math.round(Number(ui.passes.value) || 1)));

  function renderEstimate() {
    const format = chosen();
    if (!format || !request) return;
    const seconds = songSeconds(request.song, { passes: passes() });
    const size = format.kind === 'pcm'
      ? wavBytes({
        seconds, sampleRate: SAMPLE_RATE, channels: CHANNELS, bitDepth: Number(ui.quality.value) || 16,
      })
      : (seconds * (Number(ui.quality.value) || 192000)) / 8;
    ui.estimate.textContent = `${clockTime(seconds)} of audio, roughly ${fileSize(size)}.`
      + (format.realtime ? ' This one is recorded as it plays, so it takes that long to write.' : '');
  }

  function renderFormat() {
    const format = chosen();
    if (!format) return;
    fillSelect(
      ui.quality,
      format.kind === 'pcm' ? DEPTHS : BITRATES,
      format.kind === 'pcm' ? '16' : '192000',
    );
    ui.blurb.textContent = format.available
      ? format.blurb
      : format.missing
        || `This browser has no encoder for ${format.label}. WAV always works, and converts to anything.`;
    ui.quality.disabled = !format.available;
    ui.go.disabled = !format.available || Boolean(running);
    renderEstimate();
  }

  /**
   * Asks the browser what it can write, once, and fills the select every time
   * — the answer is fixed for the session, but the dialog is opened again and
   * again, and it should come back on the format you used last.
   */
  async function loadFormats() {
    if (!formats) {
      ui.format.replaceChildren(el('option', { value: '' }, ['Looking…']));
      formats = await describeFormats({ sampleRate: SAMPLE_RATE, channels: CHANNELS });
    }
    const usable = (id) => formats.some((format) => format.id === id && format.available);
    fillSelect(
      ui.format,
      formats.map((format) => ({
        value: format.id,
        label: format.available ? format.label : `${format.label} — not in this browser`,
      })),
      usable(chose) ? chose : formats.find((format) => format.available)?.id,
    );
  }

  function setProgress(fraction, message) {
    const done = Math.max(0, Math.min(1, fraction));
    ui.progress.hidden = false;
    ui.bar.value = done;
    // The number matters more than the bar on a long song: it is the
    // difference between "working" and "stuck".
    ui.status.textContent = done < 1 ? `${message} ${Math.round(done * 100)}%` : message;
  }

  function finish() {
    running = null;
    ui.go.textContent = '⤓ Export';
    ui.go.disabled = !chosen()?.available;
    ui.close.textContent = 'Close';
  }

  async function run() {
    const format = chosen();
    if (!format?.available || running) return;
    // Rendering and playing at once is two synths' worth of work for no
    // reason, and a realtime capture would be fighting for the same hardware.
    ctx.audio.stop();

    const signal = { aborted: false };
    running = signal;
    ui.go.disabled = true;
    ui.go.textContent = 'Exporting…';
    ui.close.textContent = 'Cancel';
    setProgress(0, 'Rendering…');

    try {
      // Rendering is the first two thirds of the bar when the encoder is fast,
      // and a rounding error when it is a recorder running in real time.
      const split = format.realtime ? 0.15 : 0.7;
      const buffer = await renderSong(request.song, {
        sampleRate: SAMPLE_RATE,
        channels: CHANNELS,
        passes: passes(),
        signal,
        onProgress: (done) => setProgress(done * split, 'Rendering…'),
      });
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');

      const encoding = format.realtime
        ? `Recording ${clockTime(buffer.duration)} of audio in real time…`
        : `Encoding ${format.label}…`;
      setProgress(split, encoding);
      const quality = Number(ui.quality.value) || (format.kind === 'pcm' ? 16 : 192000);
      const blob = await encodeAudio(buffer, format, {
        bitDepth: format.kind === 'pcm' ? quality : undefined,
        bitrate: format.kind === 'pcm' ? undefined : quality,
        signal,
        onProgress: (done) => setProgress(split + done * (1 - split), encoding),
      });

      setProgress(1, 'Done.');
      download(`${request.name}.${format.ext}`, blob, format.mime);
      toast(`Exported ${request.name}.${format.ext}`);
      finish();
      ui.dialog.close();
    } catch (error) {
      finish();
      if (error?.name === 'AbortError') {
        ui.progress.hidden = true;
        return;
      }
      setProgress(0, error?.message || 'The export failed.');
    }
  }

  ui.format.addEventListener('change', () => {
    chose = ui.format.value;
    renderFormat();
  });
  ui.quality.addEventListener('change', renderEstimate);
  // 'input' as well as 'change', so the estimate keeps up with the typing.
  ui.passes.addEventListener('input', renderEstimate);
  ui.go.addEventListener('click', run);
  ui.close.addEventListener('click', () => {
    if (running) {
      running.aborted = true;
      ui.status.textContent = 'Stopping…';
      return;
    }
    ui.dialog.close();
  });
  // Escape closes the dialog itself; an export in flight has to be told.
  ui.dialog.addEventListener('close', () => {
    if (running) running.aborted = true;
  });

  return {
    /**
     * @param {{song: object, name: string, label: string, loop?: boolean}} spec
     *   `label` is what the dialog says it is about to export; `loop` decides
     *   whether it offers to go round more than once
     */
    async open(spec) {
      if (!canRender()) return toast('This browser cannot render audio');
      request = spec;
      ui.scope.textContent = spec.label;
      ui.passesField.hidden = !spec.loop;
      if (!spec.loop) ui.passes.value = '1';
      ui.progress.hidden = true;
      ui.status.textContent = '';
      ui.bar.value = 0;
      ui.dialog.showModal();
      await loadFormats();
      renderFormat();
      return undefined;
    },
  };
}
