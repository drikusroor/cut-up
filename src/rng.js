// Seeded pseudo-randomness. Every generator in the app runs off one of these,
// so a seed always reproduces the same cut-up, progression or rhythm.

/** Hashes an arbitrary string into a 32-bit integer seed. */
export function hashSeed(str) {
  let h = 1779033703 ^ String(str).length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Mulberry32. Small, fast, and good enough for shuffling paper strips.
 * @param {string|number} seed
 * @returns {() => number} float in [0, 1)
 */
export function makeRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random integer in [min, max] inclusive. */
export function randInt(rng, min, max) {
  if (max < min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

/** Uniformly picks one element. Returns undefined for an empty list. */
export function pick(rng, list) {
  if (!list || list.length === 0) return undefined;
  return list[Math.floor(rng() * list.length)];
}

/**
 * Picks one element from a list of `{ value, weight }` entries.
 * Falls back to a uniform pick if every weight is zero.
 */
export function pickWeighted(rng, entries) {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (total <= 0) return pick(rng, entries)?.value;
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= Math.max(0, entry.weight);
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}

/** Fisher-Yates on a copy. */
export function shuffle(rng, list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** True with probability p. */
export function chance(rng, p) {
  return rng() < p;
}

/** A short, human-typable random seed like "loud-ember-42". */
export function randomSeed() {
  const bits = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${Date.now().toString(36).slice(-4)}${bits}`;
}
