// Word banks.
//
// Two kinds:
//   1. The big frequency dictionaries in /data, fetched lazily. ~14k words per
//      language, ordered by corpus frequency, so a slice of the array is a
//      "rarity band".
//   2. A small hand-picked imagery bank per language — concrete nouns, bodies,
//      weather, machines, colours. Frequency lists are full of abstractions and
//      chatter; these are the words that actually put a picture in your head.

export const IMAGERY = {
  en: [
    'ash', 'anchor', 'antenna', 'amber', 'attic', 'axle',
    'bone', 'brass', 'bruise', 'basement', 'beacon', 'bramble', 'breath', 'bridge',
    'candle', 'cargo', 'cathedral', 'chalk', 'cinder', 'clock', 'coastline', 'copper', 'crow', 'curtain',
    'diesel', 'dust', 'drift', 'drum', 'dynamo',
    'ember', 'engine', 'estuary', 'eyelid',
    'feather', 'ferry', 'filament', 'flint', 'fog', 'frost', 'furnace',
    'garden', 'glass', 'glacier', 'gravel', 'gutter',
    'hammer', 'harbour', 'hollow', 'horizon', 'hunger', 'hymn',
    'ice', 'iron', 'ivory',
    'jaw', 'jetty', 'junction',
    'kerosene', 'kettle', 'knuckle',
    'ladder', 'lantern', 'lightning', 'linen', 'lung',
    'magnet', 'marble', 'marrow', 'mercury', 'midnight', 'mirror', 'moth', 'motorway',
    'needle', 'neon', 'nettle', 'north',
    'ocean', 'orchard', 'orbit', 'oxide',
    'paper', 'pavement', 'pigeon', 'pistol', 'planet', 'pollen', 'powerline', 'pulse',
    'quarry', 'quiet',
    'radio', 'rain', 'razor', 'ribcage', 'river', 'rust',
    'salt', 'scaffold', 'shoreline', 'siren', 'skin', 'smoke', 'snow', 'solder', 'spine', 'static', 'steam', 'stone',
    'telephone', 'thistle', 'thunder', 'tide', 'tinder', 'tower', 'traffic', 'tunnel',
    'undertow',
    'valve', 'velvet', 'vinegar', 'voltage',
    'wallpaper', 'wasp', 'water', 'weather', 'whisper', 'window', 'wire', 'wolf', 'wound',
    'yard', 'yellow',
    'burning', 'broken', 'cold', 'crooked', 'electric', 'empty', 'hollowed', 'hungry',
    'quiet', 'rusted', 'silver', 'sodium', 'sunken', 'wet', 'wild', 'wound-up',
    'bleeding', 'breaking', 'burning', 'circling', 'drowning', 'falling', 'humming',
    'leaning', 'rattling', 'running', 'shaking', 'sinking', 'sleeping', 'turning', 'waiting',
  ],
  nl: [
    'as', 'anker', 'antenne', 'appel', 'asfalt',
    'been', 'beton', 'bliksem', 'bloed', 'boot', 'brug', 'buik',
    'dak', 'damp', 'deur', 'diesel', 'draad', 'droogte', 'duif', 'duin',
    'eb', 'ijzer', 'engel', 'erf',
    'fabriek', 'fiets', 'fluit',
    'gebouw', 'gelui', 'gips', 'glas', 'gracht', 'grind', 'gruis',
    'haven', 'hagel', 'hart', 'heuvel', 'hemel', 'hond', 'honger', 'huid',
    'kaars', 'kade', 'kanaal', 'kerk', 'ketel', 'keuken', 'klok', 'koper', 'kraai', 'krant',
    'ladder', 'lamp', 'lantaarn', 'licht', 'long', 'lucht',
    'maan', 'magneet', 'meeuw', 'mist', 'molen', 'mond', 'motor', 'muur',
    'nacht', 'naald', 'nevel', 'noorden',
    'olie', 'oever', 'ochtend',
    'papier', 'polder', 'poort', 'radio', 'raam', 'regen', 'rivier', 'roest', 'rook', 'ruit',
    'schaduw', 'schip', 'sirene', 'sleutel', 'sloot', 'sneeuw', 'spiegel', 'spoor', 'staal',
    'stad', 'stem', 'stof', 'stoom', 'storm', 'straat', 'stroom', 'suiker',
    'tafel', 'tegel', 'telefoon', 'toren', 'trein', 'tunnel',
    'vlam', 'vlieger', 'vloer', 'vogel', 'vonk', 'vuur',
    'water', 'weiland', 'wind', 'winter', 'wolk', 'wond', 'wortel',
    'zand', 'zee', 'zeil', 'zilver', 'zomer', 'zon', 'zout', 'zwaluw',
    'gebroken', 'hongerig', 'ijskoud', 'kapot', 'koud', 'leeg', 'nat', 'roestig',
    'scheef', 'stil', 'verzopen', 'wild', 'zilveren', 'zwart',
    'brandend', 'draaiend', 'drijvend', 'kloppend', 'rennend', 'ritselend',
    'schuivend', 'slapend', 'trillend', 'vallend', 'wachtend', 'zinkend',
  ],
};

/** Bare-bones cache so we only fetch each dictionary once. */
const cache = new Map();

/**
 * Loads a frequency dictionary. Resolves to a frequency-ordered word array.
 * @param {'en'|'nl'} lang
 * @param {(url: string) => Promise<Response>} [fetcher] injectable for tests
 * @returns {Promise<string[]>}
 */
export async function loadDictionary(lang, fetcher = fetch) {
  if (cache.has(lang)) return cache.get(lang);
  const promise = fetcher(new URL(`../data/words.${lang}.json`, import.meta.url))
    .then((res) => {
      if (!res.ok) throw new Error(`Could not load ${lang} dictionary (HTTP ${res.status})`);
      return res.json();
    })
    .then((data) => data.words)
    .catch((err) => {
      cache.delete(lang);
      throw err;
    });
  cache.set(lang, promise);
  return promise;
}

/**
 * Takes a rarity band out of a frequency-ordered dictionary.
 *
 * @param {string[]} dict
 * @param {number} rarity 0 = everyday words, 1 = the far tail
 * @param {number} [width] fraction of the dictionary the band spans
 * @returns {string[]}
 */
export function rarityBand(dict, rarity, width = 0.35) {
  if (!dict.length) return [];
  const span = Math.max(1, Math.floor(dict.length * width));
  const maxStart = Math.max(0, dict.length - span);
  const start = Math.round(clamp01(rarity) * maxStart);
  return dict.slice(start, start + span);
}

function clamp01(n) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}
