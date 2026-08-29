// The mixer drawer: five channel strips in the transport.
//
// It sits with Feel and Tuning because it is the same kind of thing — a
// property of the whole piece rather than of the tab you happen to be on — and
// because you want it in reach while something is playing. Nothing here is
// regenerated: a fader moves the graph that is already running, so you mix
// while the song goes round rather than stopping to mix.

import { $, el } from './dom.js';
import {
  dbLabel,
  defaultChannel,
  defaultMix,
  describeMix,
  EQ_BANDS,
  EQ_RANGE,
  levelLabel,
  LEVEL_RANGE,
  MIXER_TRACKS,
  normalizeMix,
  panLabel,
} from '../music/mixer.js';

const PERCENT = (v) => `${Math.round(Number(v) * 100)}%`;

/**
 * @param {object} ctx the app shell — its state, its save, and syncMix, which
 *   is what pushes a moved fader into the running graph
 */
export function initMixer(ctx) {
  const { state, save } = ctx;

  const ui = {
    strips: $('#mixer-strips'),
    summary: $('#mixer-summary'),
    on: $('#mixer-on'),
    master: $('#mixer-master'),
    masterOut: $('#out-mixer-master'),
    reverbSize: $('#mixer-reverb-size'),
    reverbSizeOut: $('#out-mixer-reverb-size'),
    reverbDamp: $('#mixer-reverb-damp'),
    reverbDampOut: $('#out-mixer-reverb-damp'),
    reset: $('#mixer-reset'),
  };

  /** Every control of every strip, so applyState can pour the mix back in. */
  const strips = new Map();

  /**
   * One knob. They are all the same shape — a range, a readout, and a write
   * back into the channel — so they are built rather than written out.
   */
  function knob({
    track, key, label, min, max, step, format,
  }) {
    const input = el('input', {
      type: 'range', min, max, step, 'aria-label': `${track.label} ${label}`,
    });
    const out = el('output');
    const render = () => { out.textContent = format(input.value); };
    input.addEventListener('input', () => {
      channelOf(track.id)[key] = Number(input.value);
      render();
      // Live: the desk is adjusted under the playing song rather than rebuilt.
      ctx.syncMix?.();
      renderSummary();
      save();
    });
    render();
    return {
      key,
      input,
      render,
      node: el('label', { class: 'mix-knob' }, [
        el('span', { class: 'mix-knob-name' }, [label]), input, out,
      ]),
    };
  }

  function channelOf(id) {
    if (!state.mix.tracks[id]) state.mix.tracks[id] = defaultChannel(id);
    return state.mix.tracks[id];
  }

  /** A mute or a solo — the two buttons that are not knobs. */
  function toggle(track, key, label, title) {
    const button = el('button', {
      type: 'button', class: `mix-toggle mix-${key}`, title, 'aria-pressed': 'false',
    }, [label]);
    button.addEventListener('click', () => {
      const channel = channelOf(track.id);
      channel[key] = !channel[key];
      applyToggles();
      ctx.syncMix?.();
      renderSummary();
      save();
    });
    return button;
  }

  function buildStrip(track) {
    const knobs = [
      knob({
        track, key: 'level', label: 'Level', min: LEVEL_RANGE[0], max: LEVEL_RANGE[1], step: 0.01, format: levelLabel,
      }),
      knob({
        track, key: 'pan', label: 'Pan', min: -1, max: 1, step: 0.02, format: panLabel,
      }),
      ...EQ_BANDS.map((band) => knob({
        track,
        key: band.id,
        label: band.label,
        min: EQ_RANGE[0],
        max: EQ_RANGE[1],
        step: 0.5,
        format: dbLabel,
      })),
      knob({
        track, key: 'compress', label: 'Squeeze', min: 0, max: 1, step: 0.05, format: (v) => (Number(v) ? PERCENT(v) : 'open'),
      }),
      knob({
        track, key: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.05, format: (v) => (Number(v) ? PERCENT(v) : 'dry'),
      }),
    ];
    const mute = toggle(track, 'mute', 'M', `Silence the ${track.label.toLowerCase()}`);
    const solo = toggle(track, 'solo', 'S', `Hear only the ${track.label.toLowerCase()}`);
    strips.set(track.id, { knobs, mute, solo });

    return el('div', { class: 'mix-strip', dataset: { track: track.id } }, [
      el('div', { class: 'mix-head' }, [
        el('span', { class: 'mix-name', title: track.hint }, [track.label]),
        el('div', { class: 'mix-buttons' }, [mute, solo]),
      ]),
      ...knobs.map((k) => k.node),
    ]);
  }

  ui.strips.replaceChildren(...MIXER_TRACKS.map(buildStrip));

  /** Mutes, solos and the greying-out that says what is actually being heard. */
  function applyToggles() {
    const soloed = MIXER_TRACKS.some((track) => channelOf(track.id).solo);
    for (const track of MIXER_TRACKS) {
      const channel = channelOf(track.id);
      const strip = strips.get(track.id);
      strip.mute.setAttribute('aria-pressed', String(Boolean(channel.mute)));
      strip.mute.classList.toggle('is-on', Boolean(channel.mute));
      strip.solo.setAttribute('aria-pressed', String(Boolean(channel.solo)));
      strip.solo.classList.toggle('is-on', Boolean(channel.solo));
      const silent = channel.mute || (soloed && !channel.solo);
      strip.mute.closest('.mix-strip')?.classList.toggle('is-silent', silent);
    }
  }

  function renderSummary() {
    ui.summary.textContent = describeMix(state.mix);
  }

  /** Reads the state into every control — after a load, or a reset. */
  function applyState() {
    state.mix = normalizeMix(state.mix);
    ui.on.checked = state.mix.on !== false;
    ui.master.value = String(state.mix.master);
    ui.masterOut.textContent = levelLabel(state.mix.master);
    ui.reverbSize.value = String(state.mix.reverb.size);
    ui.reverbSizeOut.textContent = PERCENT(state.mix.reverb.size);
    ui.reverbDamp.value = String(state.mix.reverb.damp);
    ui.reverbDampOut.textContent = PERCENT(state.mix.reverb.damp);
    for (const track of MIXER_TRACKS) {
      const channel = channelOf(track.id);
      for (const control of strips.get(track.id).knobs) {
        control.input.value = String(channel[control.key] ?? 0);
        control.render();
      }
    }
    applyToggles();
    renderSummary();
    ui.strips.classList.toggle('is-off', state.mix.on === false);
  }

  // --- master, reverb and the switch ----------------------------------------

  ui.master.addEventListener('input', () => {
    state.mix.master = Number(ui.master.value);
    ui.masterOut.textContent = levelLabel(state.mix.master);
    ctx.syncMix?.();
    renderSummary();
    save();
  });

  for (const [input, out, key] of [
    [ui.reverbSize, ui.reverbSizeOut, 'size'],
    [ui.reverbDamp, ui.reverbDampOut, 'damp'],
  ]) {
    input.addEventListener('input', () => {
      state.mix.reverb = { ...state.mix.reverb, [key]: Number(input.value) };
      out.textContent = PERCENT(input.value);
      ctx.syncMix?.();
      save();
    });
  }

  ui.on.addEventListener('change', () => {
    state.mix.on = ui.on.checked;
    ui.strips.classList.toggle('is-off', !ui.on.checked);
    ctx.syncMix?.();
    save();
  });

  ui.reset.addEventListener('click', () => {
    state.mix = defaultMix();
    applyState();
    ctx.syncMix?.();
    save();
  });

  applyState();

  return {
    applyState,
    /** What the desk is doing, for anyone who wants to say so. */
    describe: () => describeMix(state.mix),
  };
}
