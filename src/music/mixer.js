// The mixing desk: five channels, a reverb and a master fader.
//
// Everything the app plays already knows which part it belongs to — the tune,
// the pads, the voice, the bass, the kit — so the only thing missing was
// somewhere for those five streams to arrive separately. This is that place.
// Each channel is the same strip you would find on any desk, in the order a
// desk puts it: level and pan, a three-band EQ to carve room out of the middle,
// a compressor to hold the loud bits down, and a send to one shared plate.
//
// The settings are plain data, so a song carries its mix the way it carries its
// tempo — which is what makes an exported file sound like the thing you mixed
// rather than like the thing before you mixed it.

/** The five things you can put a fader on, in the order they appear on the desk. */
export const MIXER_TRACKS = [
  { id: 'melody', label: 'Melody', hint: 'The tune, and the voice riding on it.' },
  { id: 'vocal', label: 'Voice', hint: 'The words, where a note has any.' },
  { id: 'chords', label: 'Chords', hint: 'The harmony under everything.' },
  { id: 'bass', label: 'Bass', hint: 'The bottom.' },
  { id: 'drums', label: 'Drums', hint: 'The kit.' },
];

export const TRACK_IDS = MIXER_TRACKS.map((track) => track.id);

/** How far a fader goes: silence, unity at 1, and a little to spare above it. */
export const LEVEL_RANGE = [0, 2];
/** How far the EQ bands bend, in decibels. */
export const EQ_RANGE = [-15, 15];

/** Where the three bands sit. Wide and gentle — this is tone, not surgery. */
export const EQ_BANDS = [
  { id: 'low', label: 'Low', frequency: 160, type: 'lowshelf' },
  { id: 'mid', label: 'Mid', frequency: 1000, type: 'peaking', q: 0.9 },
  { id: 'high', label: 'High', frequency: 4800, type: 'highshelf' },
];

/**
 * What "compression" means as one knob.
 *
 * A real compressor has four controls and they interact; a songwriting toy has
 * one, and it has to do something useful at every point along it. So the knob
 * walks the threshold down and the ratio up together, which is the diagonal
 * across those four controls that people actually use.
 */
export function compressorSettings(amount) {
  const drive = clamp(amount, 0, 1);
  return {
    threshold: -6 - drive * 30, // -6 dB down to -36 dB
    ratio: 1.5 + drive * 10.5, //  gentle levelling up to a proper squeeze
    knee: 24 - drive * 18, //  soft at first, harder as it bites
    attack: 0.012 - drive * 0.008,
    release: 0.28 - drive * 0.16,
    // Some of what a compressor takes off the top is given back, or turning it
    // up would only ever make a part quieter and nobody would use it.
    makeup: 1 + drive * 0.9,
  };
}

function clamp(value, low, high) {
  const number = Number(value);
  if (!Number.isFinite(number)) return low;
  return Math.min(high, Math.max(low, number));
}

/** One channel, straight up the middle and out of the way. */
export function defaultChannel(id = 'melody') {
  return {
    id,
    level: 1,
    pan: 0,
    low: 0,
    mid: 0,
    high: 0,
    reverb: 0,
    compress: 0,
    mute: false,
    solo: false,
  };
}

/**
 * The desk as it comes: everything at unity, nothing muted, a small room on
 * the sends that nothing is sent to yet.
 */
export function defaultMix() {
  const tracks = {};
  for (const track of MIXER_TRACKS) tracks[track.id] = defaultChannel(track.id);
  return {
    on: true,
    master: 1,
    reverb: { size: 0.4, damp: 0.5 },
    tracks,
  };
}

export function normalizeChannel(channel = {}, id = 'melody') {
  const base = defaultChannel(id);
  return {
    id,
    level: clamp(channel.level ?? base.level, LEVEL_RANGE[0], LEVEL_RANGE[1]),
    pan: clamp(channel.pan ?? base.pan, -1, 1),
    low: clamp(channel.low ?? base.low, EQ_RANGE[0], EQ_RANGE[1]),
    mid: clamp(channel.mid ?? base.mid, EQ_RANGE[0], EQ_RANGE[1]),
    high: clamp(channel.high ?? base.high, EQ_RANGE[0], EQ_RANGE[1]),
    reverb: clamp(channel.reverb ?? base.reverb, 0, 1),
    compress: clamp(channel.compress ?? base.compress, 0, 1),
    mute: Boolean(channel.mute),
    solo: Boolean(channel.solo),
  };
}

/** A mix read out of storage, a file, or a song someone sent you. */
export function normalizeMix(mix = {}) {
  const base = defaultMix();
  const tracks = {};
  for (const track of MIXER_TRACKS) {
    tracks[track.id] = normalizeChannel(mix?.tracks?.[track.id], track.id);
  }
  return {
    on: mix?.on !== false,
    master: clamp(mix?.master ?? base.master, LEVEL_RANGE[0], LEVEL_RANGE[1]),
    reverb: {
      size: clamp(mix?.reverb?.size ?? base.reverb.size, 0, 1),
      damp: clamp(mix?.reverb?.damp ?? base.reverb.damp, 0, 1),
    },
    tracks,
  };
}

/** True when the desk is doing nothing a straight wire would not do. */
export function isDefaultMix(mix) {
  const normal = normalizeMix(mix);
  const base = defaultMix();
  return JSON.stringify(normal) === JSON.stringify(base);
}

/**
 * What each fader is actually worth once mutes and solos have had their say.
 *
 * Solo is the one that has to be worked out rather than read: the moment
 * anything is soloed, everything that is not soloed is off, which is a
 * property of the desk and not of the channel you clicked.
 *
 * @returns {Record<string, number>} track id → gain, 0 when it is not heard
 */
export function effectiveLevels(mix) {
  const normal = normalizeMix(mix);
  const soloed = TRACK_IDS.some((id) => normal.tracks[id].solo);
  const levels = {};
  for (const id of TRACK_IDS) {
    const channel = normal.tracks[id];
    const heard = !channel.mute && (!soloed || channel.solo);
    levels[id] = heard ? channel.level * normal.master : 0;
  }
  return levels;
}

/** A one-line summary of what has been touched, for the drawer's label. */
export function describeMix(mix) {
  const normal = normalizeMix(mix);
  const soloed = TRACK_IDS.filter((id) => normal.tracks[id].solo);
  if (soloed.length) {
    const names = soloed.map((id) => MIXER_TRACKS.find((t) => t.id === id).label.toLowerCase());
    return `soloing ${names.join(' and ')}`;
  }
  const muted = TRACK_IDS.filter((id) => normal.tracks[id].mute);
  if (muted.length) {
    const names = muted.map((id) => MIXER_TRACKS.find((t) => t.id === id).label.toLowerCase());
    return `${names.join(', ')} muted`;
  }
  if (isDefaultMix(normal)) return 'flat — everything at unity';
  const touched = TRACK_IDS.filter((id) => {
    const channel = normal.tracks[id];
    const base = defaultChannel(id);
    return JSON.stringify(channel) !== JSON.stringify(base);
  });
  if (!touched.length) return `master at ${Math.round(normal.master * 100)}%`;
  return `${touched.length} channel${touched.length === 1 ? '' : 's'} set`;
}

/** Decibels, the way a desk writes them: "+3.0 dB", "−4.5 dB", "0 dB". */
export function dbLabel(value) {
  const db = Number(value) || 0;
  if (Math.abs(db) < 0.05) return '0 dB';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}

/** A fader position as a percentage, which is how people read a level. */
export function levelLabel(value) {
  return `${Math.round((Number(value) || 0) * 100)}%`;
}

/** "L40", "C", "R100" — where a channel sits between the speakers. */
export function panLabel(value) {
  const pan = Number(value) || 0;
  if (Math.abs(pan) < 0.02) return 'C';
  return `${pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(pan) * 100)}`;
}

/**
 * The plate: noise that decays, which is the cheapest honest reverb there is.
 *
 * `size` is how long the tail runs, `damp` how fast the top of it goes — a
 * bright hall at zero, a dead room at one. It is built once per setting rather
 * than per note, because a convolver's buffer is the expensive part.
 *
 * @param {BaseAudioContext} ctx
 * @param {{size?: number, damp?: number}} settings
 */
export function impulseResponse(ctx, { size = 0.4, damp = 0.5 } = {}) {
  const seconds = 0.35 + clamp(size, 0, 1) * 3.2;
  const rate = ctx.sampleRate;
  const frames = Math.max(1, Math.floor(seconds * rate));
  const buffer = ctx.createBuffer(2, frames, rate);
  const decay = 2.2 + clamp(damp, 0, 1) * 4;
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    // A tiny running average, tightened by `damp`, is a one-pole lowpass — the
    // difference between a plate and a bathroom.
    let last = 0;
    const smooth = 0.15 + clamp(damp, 0, 1) * 0.7;
    for (let i = 0; i < frames; i++) {
      const noise = Math.random() * 2 - 1;
      last += (noise - last) * (1 - smooth);
      data[i] = last * Math.pow(1 - i / frames, decay);
    }
  }
  return buffer;
}

/**
 * The desk, built in a context.
 *
 * Five strips, a shared reverb bus and a master fader, wired once and then
 * adjusted in place: moving a fader while the song is playing must not rebuild
 * the graph, or every touch of a slider would click. Only the reverb's own
 * buffer is ever remade, and only when its size or damping changes.
 *
 * The same class runs the live engine and the offline renderer, which is the
 * whole reason a bounce comes out mixed the way you left it.
 */
export class MixerRig {
  /**
   * @param {BaseAudioContext} ctx
   * @param {AudioNode} destination usually the master bus from masterChain()
   * @param {object} [mix]
   */
  constructor(ctx, destination, mix = defaultMix()) {
    this.ctx = ctx;
    this.destination = destination;
    this.settings = normalizeMix(mix);
    this.channels = {};
    this.reverbKey = '';
    // The first pass sets values outright; every later one ramps. A desk that
    // ramped from unity on the way in would leak the first few milliseconds of
    // a muted channel into an offline render, which is a click at the top of
    // every exported file.
    this.settled = false;

    // The one plate everything sends to, and its return. A context without a
    // convolver is a context without a reverb, not a context without a desk:
    // the sends go nowhere and every dry path is untouched.
    this.reverbIn = ctx.createGain();
    this.reverb = ctx.createConvolver ? ctx.createConvolver() : null;
    if (this.reverb) {
      this.reverbOut = ctx.createGain();
      this.reverbOut.gain.value = 0.9;
      this.reverbIn.connect(this.reverb).connect(this.reverbOut).connect(destination);
    }

    for (const track of MIXER_TRACKS) this.channels[track.id] = this.buildChannel();
    this.apply(this.settings);
  }

  /** One strip: in, EQ, compressor, pan, fader, out — plus a send off the top. */
  buildChannel() {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const bands = EQ_BANDS.map((band) => {
      const filter = ctx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.frequency;
      if (band.q) filter.Q.value = band.q;
      return filter;
    });
    const compressor = ctx.createDynamicsCompressor();
    const makeup = ctx.createGain();
    // StereoPannerNode is the one node in here a browser might not have; where
    // it is missing the channel is simply mono, which is a mix you can still
    // work with rather than a page that does not load.
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const fader = ctx.createGain();
    const send = ctx.createGain();
    send.gain.value = 0;

    let node = input;
    for (const band of bands) node = node.connect(band);
    node = node.connect(compressor).connect(makeup);
    if (panner) node = node.connect(panner);
    node.connect(fader);
    fader.connect(this.destination);
    // Post-fader, the way a desk defaults: turning a part down takes its
    // reverb with it instead of leaving a ghost of it in the room.
    fader.connect(send).connect(this.reverbIn);

    return {
      input, bands, compressor, makeup, panner, fader, send,
    };
  }

  /** Where a part's notes go in. Anything unrecognised goes straight out. */
  input(part) {
    return this.channels[part]?.input || this.destination;
  }

  /**
   * Moves every control to what the settings say, without rebuilding anything.
   * Called on every change, so it has to be cheap and it has to be complete.
   */
  apply(mix) {
    this.settings = normalizeMix(mix);
    const levels = effectiveLevels(this.settings);
    const now = this.ctx.currentTime ?? 0;
    // Short ramps rather than jumps: a fader that steps is a fader that clicks.
    const settled = this.settled;
    const set = (param, value) => {
      if (!param) return;
      if (!settled) {
        param.value = value;
        return;
      }
      try {
        param.setTargetAtTime(value, now, 0.01);
      } catch {
        param.value = value;
      }
    };

    for (const track of MIXER_TRACKS) {
      const channel = this.channels[track.id];
      const settings = this.settings.tracks[track.id];
      // The desk can be switched out entirely, which is the honest way to
      // compare a mix with no mix at all.
      const on = this.settings.on;
      channel.bands.forEach((filter, index) => {
        set(filter.gain, on ? settings[EQ_BANDS[index].id] : 0);
      });
      const comp = compressorSettings(on ? settings.compress : 0);
      set(channel.compressor.threshold, settings.compress > 0 && on ? comp.threshold : 0);
      set(channel.compressor.ratio, settings.compress > 0 && on ? comp.ratio : 1);
      set(channel.compressor.knee, comp.knee);
      set(channel.compressor.attack, comp.attack);
      set(channel.compressor.release, comp.release);
      set(channel.makeup.gain, settings.compress > 0 && on ? comp.makeup : 1);
      if (channel.panner) set(channel.panner.pan, on ? settings.pan : 0);
      set(channel.fader.gain, on ? levels[track.id] : 1);
      set(channel.send.gain, on ? settings.reverb : 0);
    }

    const key = `${this.settings.reverb.size}:${this.settings.reverb.damp}`;
    if (this.reverb && key !== this.reverbKey) {
      this.reverbKey = key;
      try {
        this.reverb.buffer = impulseResponse(this.ctx, this.settings.reverb);
      } catch {
        // A context that will not build a buffer is a context with no reverb;
        // the dry path is untouched either way.
      }
    }
    this.settled = true;
  }
}
