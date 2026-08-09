# Cut-Up

A scissors-and-paste machine for songwriting, in the browser.

Brion Gysin and William Burroughs cut printed pages into strips and reassembled
them at random; David Bowie did the same with a pile of newspapers, and later
with a program he called the Verbasizer, to write lyrics for *Diamond Dogs* and
*Outside*. This does that for you — and then does the same trick to chord
progressions, melodies and drum patterns.

Everything runs client-side. No build step, no dependencies, nothing uploaded.

## Run it

The app fetches its dictionaries as JSON, so it needs to be served over HTTP
rather than opened as a `file://` URL:

```sh
python3 -m http.server 8000     # or: npx http-server -p 8000
```

Then open <http://localhost:8000>. Any static host works — drop the folder on
GitHub Pages, Netlify, or a Raspberry Pi, and it works the same.

### Deploying

`.github/workflows/pages.yml` runs the tests and publishes the repository root
to GitHub Pages on every push to `main`. It needs **Settings → Pages → Build and
deployment → Source** set to **GitHub Actions**; with that set, the live site
lands at <https://drikusroor.github.io/cut-up/>.

Every path in the app is relative, so it works from a project subpath without
any base-URL configuration.

## Words

Three sources feed one pile of paper strips, and you set how much of each goes
in:

- **Your text** — paste a newspaper article, a page of a book, an email, old
  lyrics. There are also a few built-in seed texts in different registers
  (news report, field notes, technical manual) if you just want to play.
- **Dictionary** — 14,277 English and 14,590 Dutch words, ordered by how common
  they are in real speech. The *common ↔ rare* slider slides a window along
  that list, so you can ask for everyday language or for the long tail.
- **Imagery bank** — a hand-picked set of concrete nouns, textures and verbs
  (*kerosene*, *ribcage*, *undertow* / *gruis*, *meeuw*, *roest*).
  Frequency lists are full of abstractions and chatter; these put a picture in
  your head.

Four methods:

| Method | What it does |
| --- | --- |
| **Paper strips** | Cuts the source into 2–4 word strips and shuffles them. The classic. |
| **Loose words** | Cuts all the way down to single words. More chaos. |
| **Verbasizer** | Stacks the source sentences in a grid and reads each line across a different random row per column — keeps a ghost of the original grammar. |
| **Fold-in** | Gysin's fold-in: two texts laid over each other, read across the seam. Fill in the second text box. |

Lines you like can be **locked** (🔒 keeps them through a reroll) or **kept**
(★ files them in the Keepers pad, which persists in your browser). The app also
suggests a few titles from whatever it just produced.

Everything is seeded — see [Seeds](#seeds) — so a line you liked is never lost.

### Dutch

Switch the word-bank language and the dictionary, imagery bank, connective
words and seed texts all switch with it. The interface stays in English.

## Chords & melody

Pick a key and one of twelve scales (the modes, harmonic and melodic minor, the
pentatonics, blues). Then choose how the progression is built:

- **Functional** — weighted by how chords normally pull towards each other, so
  it comes out sounding like a song.
- **Pure chance** — any diatonic chord, no memory.
- **Modal vamp** — a two- or three-chord cell, looped and mutated.
- **Cut up my chords** — type in a progression (`Am7 F Cmaj7 G7`) and it gets
  chopped into strips and reshuffled, exactly like the words.

*Sevenths* controls how often a chord gets a fourth note; *chromatic spice*
throws in borrowed chords, secondary dominants, suspensions and chromatic
side-steps. Chords are voiced with voice leading, so the inversions stay close
together instead of leaping around. Lock any chord to keep it through a reroll,
or click it to hear it.

The melody generator runs over that progression — you set its shape (wander,
arch, descend, leaps), how busy it is, how strongly it sticks to chord tones,
how often it rests, and its range. Then you can cut *that* up too: retrograde,
inversion, bar shuffle, octave jumps.

## Rhythm

A step sequencer with four generators: **euclidean** (pulses spread as evenly as
possible — the maths behind a lot of world percussion), **backbeat**, **pure
chance**, and **cut-up** (generate a bar, chop it into beats, shuffle). Set
steps per bar (8, 12 for 6/8, or 16), bars, density, and how much bar 2 drifts
from bar 1. Click any step to edit it by hand.

## Seeds

Every tab has its own seed box, and every generator runs off it, so the same
seed and settings always give back the same words, chords, melody or pattern.
Write down the ones you like; type one back in to hear it again. The dice
button rolls a fresh seed for that part alone — a new progression under the
same melody idea, or a new melody over chords you want to keep.

Melody transforms, rhythm cut-ups and hand-edited steps are changes made *on
top* of what the seed produced, so they are not replayed by it.

## Playing and exporting

The transport at the bottom is shared: tempo, swing, and which parts sound.
Whichever part is longest sets the loop length and the shorter ones repeat to
fill it, so a two-bar drum pattern keeps playing under a four-bar progression.
Space bar toggles playback. Everything is synthesised with the Web Audio API —
no samples, no libraries.

**Export MIDI** writes a type-1 file with chords, melody and drums on separate
tracks (drums on channel 10), swing baked in, ready to drag into any DAW.

## Development

```sh
npm test                        # 43 unit tests, no dependencies
node tools/build-wordlists.mjs  # regenerate data/words.*.json
```

```
index.html          markup for all three tabs
styles.css
src/
  rng.js            seeded randomness — every generator runs off this
  cutup.js          strips, fold-in, verbasizer, line assembly
  lyrics.js         ties the text primitives into one call
  words.js          dictionary loading, imagery banks, rarity bands
  sources.js        built-in seed texts
  music/
    theory.js       scales, chords, progressions, voicing, chord parsing
    melody.js       melody generation and cut-up transforms
    rhythm.js       euclidean and friends
    arrange.js      lays the parts out over the loop, repeats included
    midi.js         a small type-1 MIDI writer
    audio.js        Web Audio playback
  ui/               one module per tab, plus DOM helpers
  main.js           state, persistence, tabs, transport
tools/              word-list build script
test/               node:test suites
```

Adding a language means adding it to `tools/build-wordlists.mjs` (the upstream
corpus covers dozens), writing an imagery bank and glue words for it in
`src/words.js` and `src/cutup.js`, and adding an `<option>` to the language
select.

## Credits

Word banks derived from
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(OpenSubtitles 2018), licensed CC BY-SA 4.0. The seed texts were written for
this project. Everything else is generated in your browser.
