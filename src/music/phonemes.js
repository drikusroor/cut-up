// Turning writing into sounds — the front half of a text-to-speech synthesiser.
//
// A singer needs three things from a line of text: which sounds to make, where
// one syllable ends and the next begins, and what shape the mouth is in for
// each of them. This file answers all three, from spelling alone, with no
// dictionary to download.
//
// The sounds are stored as *formants*: the two or three resonances of the
// throat and mouth that make an "ee" an "ee" and an "oo" an "oo". Sing a
// buzzing tone through three bandpass filters parked at 270, 2290 and 3010 Hz
// and a listener hears "ee", whatever pitch the buzz is at. That is the whole
// trick of a singing synthesiser, and it is why this one has no samples in it:
// a vowel is six numbers.
//
// Letters become sounds by ordered rewrite rules, in the manner of the old
// Naval Research Laboratory rules — try the longest, most specific spelling
// first, fall back to single letters. English spelling being what it is, the
// hundred or so words that break every rule are simply listed.

/**
 * @typedef {object} Phone
 * @property {'vowel'|'nasal'|'liquid'|'glide'|'fricative'|'aspirate'|'plosive'|'affricate'} kind
 * @property {[number, number, number]} [f] formant frequencies, in Hz
 * @property {[number, number, number]} [glide] where the formants end up, for
 *   diphthongs — "I" is a mouth moving from "ah" towards "ee"
 * @property {boolean} [voiced] whether the vocal folds are running
 * @property {number} [band] centre of the noise, for fricatives
 * @property {number} [burst] centre of the click, for plosives
 * @property {number} [q] how narrow that noise is
 * @property {number} [level] how loud it is against the vowels
 * @property {number} [dur] how long it takes to say, in seconds
 * @property {number} [closure] silence before a plosive lets go
 */

/** The vowels. Everything else in a syllable is decoration around one of these. */
export const VOWELS = {
  i: { kind: 'vowel', f: [270, 2290, 3010] }, // beet, iets
  I: { kind: 'vowel', f: [390, 1990, 2550] }, // bit, pit
  e: { kind: 'vowel', f: [400, 2200, 2700] }, // Dutch "ee"
  E: { kind: 'vowel', f: [530, 1840, 2480] }, // bet, bed
  a: { kind: 'vowel', f: [660, 1720, 2410] }, // cat
  A: { kind: 'vowel', f: [730, 1090, 2440] }, // father, "aa"
  Q: { kind: 'vowel', f: [700, 1150, 2500] }, // Dutch short "a" in kat
  O: { kind: 'vowel', f: [570, 840, 2410] }, // thought, bot
  o: { kind: 'vowel', f: [450, 800, 2830] }, // Dutch "oo"
  U: { kind: 'vowel', f: [440, 1020, 2240] }, // book
  u: { kind: 'vowel', f: [300, 870, 2240] }, // boot, boek
  V: { kind: 'vowel', f: [640, 1190, 2390] }, // but
  '@': { kind: 'vowel', f: [500, 1500, 2500] }, // the unstressed one, everywhere
  3: { kind: 'vowel', f: [490, 1350, 1690] }, // bird
  y: { kind: 'vowel', f: [290, 1750, 2200] }, // Dutch "uu"
  2: { kind: 'vowel', f: [370, 1900, 2200] }, // Dutch "eu"
  9: { kind: 'vowel', f: [420, 1600, 2300] }, // Dutch short "u" in bus
  // Diphthongs: one mouth shape sliding into another.
  aI: { kind: 'vowel', f: [730, 1090, 2440], glide: [390, 1990, 2550] }, // my
  aU: { kind: 'vowel', f: [730, 1090, 2440], glide: [440, 1020, 2240] }, // how
  OI: { kind: 'vowel', f: [570, 840, 2410], glide: [390, 1990, 2550] }, // boy
  eI: { kind: 'vowel', f: [530, 1840, 2480], glide: [390, 1990, 2550] }, // day
  oU: { kind: 'vowel', f: [450, 800, 2830], glide: [440, 1020, 2240] }, // go
  EI: { kind: 'vowel', f: [530, 1840, 2480], glide: [390, 1990, 2550] }, // Dutch ij/ei
  '9Y': { kind: 'vowel', f: [420, 1600, 2300], glide: [290, 1750, 2200] }, // Dutch ui
  AU: { kind: 'vowel', f: [570, 840, 2410], glide: [440, 1020, 2240] }, // Dutch ou/au
};

/** Everything that is not a vowel: the consonants, with how they are made. */
export const CONSONANTS = {
  // Nasals — voiced, formants low and damped, air out through the nose.
  m: { kind: 'nasal', voiced: true, f: [250, 1100, 2100], dur: 0.06, level: 0.5 },
  n: { kind: 'nasal', voiced: true, f: [250, 1700, 2600], dur: 0.055, level: 0.5 },
  N: { kind: 'nasal', voiced: true, f: [250, 2300, 2700], dur: 0.06, level: 0.5 },
  // Liquids and glides — vowels in all but name, so they simply have formants.
  l: { kind: 'liquid', voiced: true, f: [360, 1300, 2600], dur: 0.055, level: 0.8 },
  r: { kind: 'liquid', voiced: true, f: [420, 1300, 1600], dur: 0.055, level: 0.8 },
  w: { kind: 'glide', voiced: true, f: [300, 610, 2200], dur: 0.05, level: 0.8 },
  j: { kind: 'glide', voiced: true, f: [250, 2300, 3000], dur: 0.05, level: 0.8 },
  // Fricatives — a hiss, with the folds running or not.
  f: { kind: 'fricative', voiced: false, band: 1500, q: 1.1, level: 0.5, dur: 0.085 },
  v: { kind: 'fricative', voiced: true, band: 1400, q: 1.1, level: 0.35, dur: 0.07 },
  T: { kind: 'fricative', voiced: false, band: 2300, q: 1.4, level: 0.4, dur: 0.08 }, // thin
  D: { kind: 'fricative', voiced: true, band: 1800, q: 1.4, level: 0.3, dur: 0.06 }, // this
  s: { kind: 'fricative', voiced: false, band: 5800, q: 2.2, level: 0.9, dur: 0.09 },
  z: { kind: 'fricative', voiced: true, band: 5200, q: 2.2, level: 0.5, dur: 0.075 },
  S: { kind: 'fricative', voiced: false, band: 2900, q: 1.6, level: 0.95, dur: 0.095 }, // sh
  Z: { kind: 'fricative', voiced: true, band: 2600, q: 1.6, level: 0.55, dur: 0.075 },
  x: { kind: 'fricative', voiced: false, band: 1300, q: 1, level: 0.6, dur: 0.08 }, // Dutch g
  G: { kind: 'fricative', voiced: true, band: 1150, q: 1, level: 0.4, dur: 0.07 },
  h: { kind: 'aspirate', voiced: false, band: 1200, q: 0.6, level: 0.32, dur: 0.055 },
  // Plosives — a moment of nothing, then a click.
  p: { kind: 'plosive', voiced: false, burst: 900, q: 0.9, level: 0.5, dur: 0.05, closure: 0.03 },
  b: { kind: 'plosive', voiced: true, burst: 700, q: 0.9, level: 0.35, dur: 0.045, closure: 0.022 },
  t: { kind: 'plosive', voiced: false, burst: 3800, q: 1.3, level: 0.6, dur: 0.05, closure: 0.03 },
  d: { kind: 'plosive', voiced: true, burst: 3000, q: 1.3, level: 0.4, dur: 0.045, closure: 0.022 },
  k: { kind: 'plosive', voiced: false, burst: 2200, q: 1.1, level: 0.55, dur: 0.055, closure: 0.032 },
  g: { kind: 'plosive', voiced: true, burst: 1700, q: 1.1, level: 0.38, dur: 0.045, closure: 0.024 },
  // Affricates — a plosive that lets go into a hiss.
  tS: { kind: 'affricate', voiced: false, burst: 2600, band: 2900, q: 1.6, level: 0.8, dur: 0.1, closure: 0.028 },
  dZ: { kind: 'affricate', voiced: true, burst: 2200, band: 2600, q: 1.6, level: 0.6, dur: 0.09, closure: 0.02 },
};

const PHONES = { ...VOWELS, ...CONSONANTS };

/** What one phone is made of, or null if nobody knows. */
export function phoneInfo(id) {
  return PHONES[id] || null;
}

/** True for the sounds a syllable can be built around. */
export function isVowel(id) {
  return PHONES[id]?.kind === 'vowel';
}

/** Every phone this file can produce, for tests and for the curious. */
export function phoneIds() {
  return Object.keys(PHONES);
}

// --- the rule engine --------------------------------------------------------

/**
 * A rule is: this spelling, in this context, is these sounds.
 *
 * `before` is matched against everything to the left of the position and
 * `after` against everything to the right, which is how "c" knows to be an /s/
 * in *city* and a /k/ in *cat*. `#` in a context means the edge of the word.
 */
function rule(spelling, phones, context = {}) {
  return {
    spelling,
    phones: phones ? phones.split(' ') : [],
    // Wrapped, because a context is often a list of alternatives and an
    // unwrapped `a|b$` anchors only the last of them.
    before: context.before ? new RegExp(`(?:${context.before})$`) : null,
    after: context.after ? new RegExp(`^(?:${context.after})`) : null,
  };
}

/**
 * Walks a word left to right, taking the first rule that matches at each
 * position. Rules are grouped by first letter so a long word is not a scan of
 * the whole table per character.
 */
function compile(rules) {
  const byLetter = new Map();
  for (const r of rules) {
    const key = r.spelling[0];
    if (!byLetter.has(key)) byLetter.set(key, []);
    byLetter.get(key).push(r);
  }
  // Longest spelling first, so "tion" is tried before "t".
  for (const list of byLetter.values()) list.sort((a, b) => b.spelling.length - a.spelling.length);
  return byLetter;
}

function runRules(word, byLetter) {
  const out = [];
  let i = 0;
  while (i < word.length) {
    const candidates = byLetter.get(word[i]) || [];
    let matched = null;
    for (const r of candidates) {
      if (!word.startsWith(r.spelling, i)) continue;
      if (r.before && !r.before.test(`#${word.slice(0, i)}`)) continue;
      if (r.after && !r.after.test(`${word.slice(i + r.spelling.length)}#`)) continue;
      matched = r;
      break;
    }
    if (!matched) {
      // A letter with no rule is a letter we cannot say; skip it rather than
      // stopping, so one stray character never silences a whole line.
      i += 1;
      continue;
    }
    for (const p of matched.phones) {
      if (PHONES[p]) out.push({ p, at: i, len: matched.spelling.length });
    }
    i += matched.spelling.length;
  }
  return out;
}

// --- English ----------------------------------------------------------------

/** A consonant letter, for contexts. */
const C = '[bcdfghjklmnpqrstvwxz]';
const V = '[aeiouy]';
/** Vowel, one consonant, silent e — the spelling that makes a vowel long. */
const MAGIC_E = `${C}e(s|d)?#`;

const EN_RULES = compile([
  // Endings first: they are the most reliable thing in English spelling.
  rule('tion', 'S @ n'),
  rule('sion', 'Z @ n', { before: V }),
  rule('sion', 'S @ n'),
  rule('cious', 'S @ s'),
  rule('tious', 'S @ s'),
  rule('cial', 'S @ l'),
  rule('tial', 'S @ l'),
  rule('ough', 'V f', { after: '#' }),
  rule('ough', 'oU'),
  rule('augh', 'A f', { after: 't?#' }),
  rule('igh', 'aI'),
  rule('eigh', 'eI'),
  rule('ing', 'I N', { after: '#' }),
  rule('ed', 'I d', { before: '[td]', after: '#' }),
  rule('ed', 't', { before: '[csfkpx]|sh|ch', after: '#' }),
  rule('ed', 'd', { before: C, after: '#' }),
  rule('es', 'I z', { before: '[sxz]|sh|ch', after: '#' }),
  rule('le', '@ l', { before: C, after: '#' }),
  rule('re', '@ r', { before: C, after: '#' }),
  rule('ful', 'f U l', { after: '#' }),
  rule('ness', 'n @ s', { after: '#' }),
  rule('ment', 'm @ n t', { after: '#' }),
  rule('ly', 'l i', { after: '#' }),

  // A doubled consonant is one sound; it is the vowel before it that it
  // changes, and the vowel rules read that off the spelling themselves.
  rule('bb', 'b'),
  rule('dd', 'd'),
  rule('ff', 'f'),
  rule('gg', 'g'),
  rule('ll', 'l'),
  rule('mm', 'm'),
  rule('nn', 'n'),
  rule('pp', 'p'),
  rule('rr', 'r'),
  rule('ss', 's'),
  rule('tt', 't'),
  rule('zz', 'z'),

  // Two-letter spellings.
  rule('ch', 'k', { before: '#', after: '(r|l)' }),
  rule('ch', 'tS'),
  rule('sh', 'S'),
  rule('th', 'D', { before: '#', after: 'e(y|m|n|re|se)?#' }),
  rule('th', 'T'),
  rule('ph', 'f'),
  rule('gh', '', { before: V }),
  rule('gh', 'g'),
  rule('ck', 'k'),
  rule('kn', 'n', { before: '#' }),
  rule('wr', 'r', { before: '#' }),
  rule('wh', 'w'),
  rule('qu', 'k w'),
  rule('ng', 'N', { after: '#|[^aeiouy]' }),
  rule('ng', 'N g'),
  rule('dg', 'dZ', { after: '[eiy]' }),
  rule('tch', 'tS'),
  rule('sc', 's', { after: '[eiy]' }),

  // Vowel digraphs.
  rule('eau', 'oU'),
  rule('ee', 'i'),
  rule('ea', 'E', { after: '(d|th|lth|sure|ther)#' }),
  rule('ea', 'i'),
  rule('ie', 'i'),
  rule('ei', 'i', { before: 'c' }),
  rule('ei', 'eI'),
  rule('ey', 'i', { after: '#' }),
  rule('ey', 'eI'),
  rule('ai', 'eI'),
  rule('ay', 'eI'),
  rule('oa', 'oU'),
  rule('oe', 'oU'),
  rule('oo', 'U', { after: '[kd]' }),
  rule('oo', 'u'),
  rule('ou', 'u', { after: 'p#' }),
  rule('ou', 'aU'),
  rule('ow', 'oU', { after: '#|n#|ing#' }),
  rule('ow', 'aU'),
  rule('oi', 'OI'),
  rule('oy', 'OI'),
  rule('au', 'O'),
  rule('aw', 'O'),
  rule('eu', 'j u'),
  rule('ew', 'j u'),
  rule('ui', 'u', { before: '[jr]' }),
  rule('ue', 'u'),

  // Vowel plus r, which is a different vowel in English.
  rule('ar', 'A r'),
  rule('er', '3', { after: '#' }),
  rule('er', '3 r'),
  rule('ir', '3 r'),
  rule('ur', '3 r'),
  rule('yr', '3 r'),
  rule('or', 'O r'),
  rule('oor', 'O r'),

  // Single vowels: long before a silent e or an open syllable, short otherwise.
  rule('a', 'eI', { after: MAGIC_E }),
  rule('a', 'eI', { after: `${C}${V}` }),
  rule('a', '@', { before: '#', after: `${C}${C}` }),
  rule('a', 'a'),
  rule('e', 'i', { after: MAGIC_E }),
  rule('e', '', { after: '#', before: `${V}${C}+` }),
  rule('e', 'i', { after: `${C}${V}`, before: '#' }),
  rule('e', 'E'),
  rule('i', 'aI', { after: MAGIC_E }),
  rule('i', 'aI', { after: `${C}${V}`, before: `#${C}?` }),
  rule('i', 'I'),
  rule('o', 'oU', { after: MAGIC_E }),
  rule('o', 'oU', { after: `${C}${V}` }),
  rule('o', 'oU', { after: '#' }),
  rule('o', 'O'),
  rule('u', 'j u', { after: MAGIC_E }),
  rule('u', 'V'),
  rule('y', 'i', { after: '#', before: `.${C}` }),
  rule('y', 'aI', { after: '#', before: `#${C}?` }),
  rule('y', 'j', { before: '#' }),
  rule('y', 'I'),

  // Single consonants.
  rule('b', 'b'),
  rule('c', 's', { after: '[eiy]' }),
  rule('c', 'k'),
  rule('d', 'd'),
  rule('f', 'f'),
  rule('g', 'dZ', { after: '[ey]' }),
  rule('g', 'g'),
  rule('h', 'h'),
  rule('j', 'dZ'),
  rule('k', 'k'),
  rule('l', 'l'),
  rule('m', 'm'),
  rule('n', 'n'),
  rule('p', 'p'),
  rule('q', 'k'),
  rule('r', 'r'),
  rule('s', 'z', { before: `${V}`, after: '#' }),
  rule('s', 's'),
  rule('t', 't'),
  rule('v', 'v'),
  rule('w', 'w'),
  rule('x', 'k s'),
  rule('z', 'z'),
]);

/**
 * The words that break the rules, which in English are the words you use most.
 * Cheaper than making the rules cleverer, and more accurate.
 */
const EN_WORDS = {
  a: '@', the: 'D @', of: 'V v', to: 't u', and: 'a n d', in: 'I n', is: 'I z',
  it: 'I t', you: 'j u', that: 'D a t', he: 'h i', was: 'w V z', for: 'f O r',
  on: 'O n', are: 'A r', as: 'a z', with: 'w I D', his: 'h I z', they: 'D eI',
  i: 'aI', at: 'a t', be: 'b i', this: 'D I s', have: 'h a v', from: 'f r V m',
  or: 'O r', one: 'w V n', had: 'h a d', by: 'b aI', word: 'w 3 r d', but: 'b V t',
  not: 'n O t', what: 'w V t', all: 'O l', were: 'w 3 r', we: 'w i', when: 'w E n',
  your: 'j O r', can: 'k a n', said: 's E d', there: 'D E r', use: 'j u z',
  an: 'a n', each: 'i tS', which: 'w I tS', she: 'S i', do: 'd u', how: 'h aU',
  their: 'D E r', if: 'I f', will: 'w I l', up: 'V p', other: 'V D 3 r',
  about: '@ b aU t', out: 'aU t', many: 'm E n i', then: 'D E n', them: 'D E m',
  these: 'D i z', so: 's oU', some: 's V m', her: 'h 3 r', would: 'w U d',
  make: 'm eI k', like: 'l aI k', him: 'h I m', into: 'I n t u', time: 't aI m',
  has: 'h a z', look: 'l U k', two: 't u', more: 'm O r', write: 'r aI t',
  go: 'g oU', see: 's i', number: 'n V m b 3 r', no: 'n oU', way: 'w eI',
  could: 'k U d', people: 'p i p @ l', my: 'm aI', than: 'D a n', first: 'f 3 r s t',
  water: 'w O t 3 r', been: 'b I n', call: 'k O l', who: 'h u', oil: 'OI l',
  now: 'n aU', find: 'f aI n d', long: 'l O N', down: 'd aU n', day: 'd eI',
  did: 'd I d', get: 'g E t', come: 'k V m', made: 'm eI d', may: 'm eI',
  part: 'p A r t', over: 'oU v 3 r', new: 'n u', sound: 's aU n d', take: 't eI k',
  only: 'oU n l i', little: 'l I t @ l', work: 'w 3 r k', know: 'n oU',
  place: 'p l eI s', year: 'j I r', live: 'l I v', me: 'm i', back: 'b a k',
  give: 'g I v', most: 'm oU s t', very: 'v E r i', good: 'g U d', through: 'T r u',
  says: 's E z', great: 'g r eI t', where: 'w E r', help: 'h E l p', put: 'p U t',
  again: '@ g E n', because: 'b I k O z', eye: 'aI', eyes: 'aI z', done: 'd V n',
  gone: 'g O n', love: 'l V v', above: '@ b V v', money: 'm V n i', mother: 'm V D 3 r',
  father: 'f A D 3 r', night: 'n aI t', light: 'l aI t', right: 'r aI t',
  sight: 's aI t', high: 'h aI', sign: 's aI n', heart: 'h A r t', half: 'h A f',
  walk: 'w O k', talk: 't O k', blood: 'b l V d', flood: 'f l V d', friend: 'f r E n d',
  front: 'f r V n t', build: 'b I l d', busy: 'b I z i', women: 'w I m I n',
  once: 'w V n s', whole: 'h oU l', sure: 'S U r', sugar: 'S U g 3 r',
  machine: 'm @ S i n', ocean: 'oU S @ n', though: 'D oU', thought: 'T O t',
  laugh: 'l a f', hour: 'aU 3 r', our: 'aU 3 r', fire: 'f aI 3 r', wire: 'w aI 3 r',
  air: 'E r', hair: 'h E r', ever: 'E v 3 r', never: 'n E v 3 r', every: 'E v r i',
  another: '@ n V D 3 r', brother: 'b r V D 3 r', does: 'd V z', goes: 'g oU z',
  should: 'S U d', house: 'h aU s', why: 'w aI', white: 'w aI t', while: 'w aI l',
  city: 's I t i', body: 'b O d i', head: 'h E d', dead: 'd E d', bread: 'b r E d',
  break: 'b r eI k', wind: 'w I n d', rain: 'r eI n', snow: 's n oU',
  smoke: 's m oU k', bone: 'b oU n', stone: 's t oU n', river: 'r I v 3 r',
  radio: 'r eI d i oU', window: 'w I n d oU', shadow: 'S a d oU',
};

// --- Dutch ------------------------------------------------------------------

/**
 * Dutch spelling is close to regular, so the rules do nearly all of it. The one
 * thing they have to know is the difference between an open and a closed
 * syllable — *maken* is long, *makken* is short — which here is "a single
 * consonant followed by another vowel means the vowel before it is long".
 */
const NL_OPEN = `${C}${V}`;

const NL_RULES = compile([
  rule('sch', 's', { after: '#|e#' }), // -isch, -ische
  rule('sch', 's x'),
  rule('ch', 'x'),
  rule('ng', 'N'),
  rule('nk', 'N k'),
  rule('sj', 'S'),
  rule('tj', 'tS'),
  rule('th', 't'),
  rule('qu', 'k w'),
  rule('ij', 'EI'),
  rule('ei', 'EI'),
  rule('ui', '9Y'),
  rule('ou', 'AU'),
  rule('au', 'AU'),
  rule('oe', 'u'),
  rule('eu', '2'),
  rule('ie', 'i'),
  rule('aa', 'A'),
  rule('ee', 'e', { after: '#' }), // "twee", "zee"
  rule('ee', 'e'),
  rule('oo', 'o'),
  rule('uu', 'y'),
  rule('aai', 'A j'),
  rule('ooi', 'o j'),
  rule('oei', 'u j'),
  rule('eeuw', 'e w'),
  rule('ieuw', 'i w'),
  rule('uw', 'y w'),

  rule('a', 'A', { after: `${NL_OPEN}|#` }),
  rule('a', 'Q'),
  rule('e', '@', { after: '#', before: '.' }), // a final -e is always a schwa
  rule('e', '@', { after: '[lr]#|n[dt]?#' }), // -er, -el, -en, -end
  rule('e', 'e', { after: NL_OPEN }),
  rule('e', '@', { before: '#[gbv]' }), // the ge-, be- and ver- prefixes
  rule('e', 'E'),
  rule('i', 'i', { after: '#' }),
  rule('i', 'I'),
  rule('o', 'o', { after: `${NL_OPEN}|#` }),
  rule('o', 'O'),
  rule('u', 'y', { after: `${NL_OPEN}|#` }),
  rule('u', '9'),
  rule('y', 'i'),

  rule('bb', 'b'),
  rule('dd', 'd'),
  rule('ff', 'f'),
  rule('gg', 'x'),
  rule('kk', 'k'),
  rule('ll', 'l'),
  rule('mm', 'm'),
  rule('nn', 'n'),
  rule('pp', 'p'),
  rule('rr', 'r'),
  rule('ss', 's'),
  rule('tt', 't'),
  rule('zz', 'z'),

  rule('b', 'p', { after: '#' }), // final devoicing: heb, web
  rule('b', 'b'),
  rule('c', 's', { after: '[eiy]' }),
  rule('c', 'k'),
  rule('d', 't', { after: '#' }), // hand, brood
  rule('d', 'd'),
  rule('f', 'f'),
  rule('g', 'x'),
  rule('h', 'h'),
  rule('j', 'j'),
  rule('k', 'k'),
  rule('l', 'l'),
  rule('m', 'm'),
  rule('n', 'n'),
  rule('p', 'p'),
  rule('r', 'r'),
  rule('s', 's'),
  rule('t', 't'),
  rule('v', 'v'),
  rule('w', 'v'),
  rule('x', 'k s'),
  rule('z', 'z'),
]);

const NL_WORDS = {
  de: 'd @', het: 'h @ t', een: '@ n', en: 'E n', van: 'v Q n', ik: 'I k',
  je: 'j @', is: 'I s', dat: 'd Q t', op: 'O p', te: 't @', zijn: 'z EI n',
  er: 'E r', maar: 'm A r', als: 'Q l s', voor: 'v o r', met: 'm E t',
  ze: 'z @', die: 'd i', niet: 'n i t', aan: 'A n', ook: 'o k', we: 'v @',
  hij: 'h EI', naar: 'n A r', me: 'm @', wat: 'v Q t', mijn: 'm EI n',
  zo: 'z o', heeft: 'h e f t', dan: 'd Q n', nog: 'n O x', uit: '9Y t',
  bij: 'b EI', over: 'o v @ r', hem: 'h E m', haar: 'h A r', door: 'd o r',
  meer: 'm e r', geen: 'x e n', hun: 'h 9 n', nu: 'n y', ben: 'b E n',
  waar: 'v A r', hoe: 'h u', want: 'v Q n t', dit: 'd I t', werd: 'v E r t',
  tijd: 't EI t', licht: 'l I x t', nacht: 'n Q x t', water: 'v A t @ r',
  hart: 'h Q r t', hand: 'h Q n t', ogen: 'o G @ n', huis: 'h 9Y s',
  stad: 's t Q t', weg: 'v E x', zee: 'z e', lucht: 'l 9 x t', vuur: 'v y r',
  regen: 'r e G @ n', sneeuw: 's n e w', wind: 'v I n t', ijzer: 'EI z @ r',
};

const LANGS = {
  en: { rules: EN_RULES, words: EN_WORDS },
  nl: { rules: NL_RULES, words: NL_WORDS },
};

/**
 * Sounds one word out.
 *
 * @param {string} word
 * @param {'en'|'nl'} [lang]
 * @returns {Array<{p: string, at: number, len: number}>} the phones, each
 *   remembering which letters it came from so a syllable can be spelled back
 */
export function phonemise(word, lang = 'en') {
  const clean = String(word || '').toLowerCase().replace(/[^a-zà-ÿ']/g, '');
  if (!clean) return [];
  const { rules, words } = LANGS[lang] || LANGS.en;
  const listed = words[clean];
  if (listed) {
    // A listed word has no letter-by-letter mapping, so its phones all point at
    // the whole word — it is one syllable's worth of spelling either way.
    return listed.split(' ').filter((p) => PHONES[p])
      .map((p) => ({ p, at: 0, len: clean.length }));
  }
  return runRules(deaccent(clean), rules);
}

function deaccent(word) {
  return word.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Consonant clusters a syllable is allowed to start with. */
const LEGAL_ONSETS = new Set([
  'pr', 'br', 'tr', 'dr', 'kr', 'gr', 'fr', 'Tr', 'Sr', 'vr',
  'pl', 'bl', 'kl', 'gl', 'fl', 'sl', 'Sl',
  'sp', 'st', 'sk', 'sm', 'sn', 'sw', 'sx',
  'kw', 'tw', 'dw', 'sf', 'Sp', 'St', 'Sn', 'Sm', 'Sv',
]);

/**
 * Splits a run of phones into syllables, one per vowel.
 *
 * Consonants between two vowels go to whichever side can have them: the
 * following syllable takes as many as it could legally start with, and the rest
 * close the one before. That is the maximal-onset principle, and it is why
 * *harbour* comes out har-bour rather than harb-our.
 *
 * @param {Array<{p: string}>} phones
 * @returns {Array<Array<{p: string}>>}
 */
export function syllabifyPhones(phones) {
  const nuclei = [];
  phones.forEach((phone, index) => {
    if (isVowel(phone.p)) nuclei.push(index);
  });
  if (!nuclei.length) return phones.length ? [phones] : [];

  const cuts = [0];
  for (let n = 1; n < nuclei.length; n++) {
    const gapStart = nuclei[n - 1] + 1;
    const gap = phones.slice(gapStart, nuclei[n]).map((x) => x.p);
    let onset = 0;
    if (gap.length === 1) {
      onset = 1;
    } else if (gap.length >= 2) {
      const pair = gap.slice(-2).join('');
      onset = LEGAL_ONSETS.has(pair) ? 2 : 1;
    }
    cuts.push(nuclei[n] - onset);
  }
  cuts.push(phones.length);

  const out = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const slice = phones.slice(cuts[i], cuts[i + 1]);
    if (slice.length) out.push(slice);
  }
  return out;
}

/** Prefixes that are never the stressed syllable of a word. */
const WEAK_PREFIX = /^(be|de|re|con|com|in|un|ex|a|pre|pro|ge|ver|ont|her)$/;

/**
 * One word, as syllables ready to sing.
 *
 * @param {string} word
 * @param {'en'|'nl'} [lang]
 * @returns {Array<{text: string, phones: string[], stressed: boolean}>}
 */
export function wordSyllables(word, lang = 'en') {
  const phones = phonemise(word, lang);
  if (!phones.length) return [];
  const groups = syllabifyPhones(phones);
  const written = String(word || '');
  const cuts = spellingCuts(groups, written);

  return groups.map((group, index) => {
    const text = written.slice(cuts[index], cuts[index + 1]) || written;
    const first = groups[0].map((x) => x.p).join('');
    return {
      text,
      phones: group.map((x) => x.p),
      // No dictionary of stress here, so: the first syllable, unless it is one
      // of the prefixes that never takes it.
      stressed: groups.length === 1
        || (index === 0
          ? !WEAK_PREFIX.test(text.toLowerCase())
          : index === 1 && WEAK_PREFIX.test(first)),
    };
  });
}

/**
 * Where to break the *spelling* so each syllable can be shown as it is written.
 *
 * The phones remember which letters they came from, so the break goes at the
 * first letter of the next syllable's first sound — through the middle of it
 * when one sound is spelled with several letters, which is what puts the break
 * in "run-ning" and "sin-ging" where a reader expects it.
 */
function spellingCuts(groups, written) {
  const listed = groups.every((group) => group.every((x) => x.at === groups[0][0].at));
  if (listed) {
    // A word taken from the exceptions list has no letter-by-letter mapping, so
    // its spelling is simply shared out evenly.
    return groups.map((_, index) => Math.round((index * written.length) / groups.length))
      .concat(written.length);
  }
  const cuts = [0];
  for (let i = 1; i < groups.length; i++) {
    const head = groups[i][0];
    const at = head.at + Math.floor(head.len / 2);
    cuts.push(Math.min(written.length, Math.max(cuts[i - 1], at)));
  }
  cuts.push(written.length);
  return cuts;
}

/**
 * A line of text, as a flat run of singable syllables.
 *
 * @param {string} text
 * @param {'en'|'nl'} [lang]
 * @returns {Array<{text: string, phones: string[], word: string, stressed: boolean,
 *   wordStart: boolean, wordEnd: boolean}>}
 */
export function lineSyllables(text, lang = 'en') {
  const key = `${lang}\u0000${text}`;
  const hit = lineCache.get(key);
  if (hit) return hit;
  const out = [];
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const syllables = wordSyllables(word, lang);
    syllables.forEach((syllable, index) => {
      out.push({
        ...syllable,
        word,
        wordStart: index === 0,
        wordEnd: index === syllables.length - 1,
      });
    });
  }
  // The piano roll re-sets the words on every frame of a drag, so the same line
  // is sounded out over and over. It is a pure function of its arguments, so
  // the last few answers are simply kept.
  if (lineCache.size > 256) lineCache.clear();
  lineCache.set(key, out);
  return out;
}

const lineCache = new Map();

/** How many notes a line of words wants. Handy for a readout. */
export function countSyllables(text, lang = 'en') {
  return lineSyllables(text, lang).length;
}
