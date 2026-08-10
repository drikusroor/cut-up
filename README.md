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

### Reshaping the melody by hand

The piano roll is editable. Drag a note up and down to change its pitch, left
and right to move it in time, or drag its right-hand edge to make it longer or
shorter. Double-click empty space to add a note; alt-click or right-click one to
take it out.

None of that overwrites what the generator produced. The generated line stays
underneath as the *base*, and every edit you make is filed as a deviation from
it — a delta on a note, a note struck out, a note drawn in. So:

- Edited notes are drawn <span>🟢</span> green, over a dashed ghost of where the
  note started, and you can see at a glance how far you have pulled the line
  away from the machine's version.
- **Undo** (or Ctrl+Z) steps back through your edits, and **Reset to generated**
  throws the whole ledger away and gives you the original line back.
- Transforms are the machine's move, so they rewrite the base — and because
  notes keep their identity through a retrograde or a bar shuffle, the notes you
  dragged stay dragged.
- Rerolling the melody starts you clean: a new line is a new set of notes, and
  deltas aimed at the old ones would land on strangers.

### The bass

The bass is optional — one checkbox in the **Bass** box — and it is the only
part written against the others rather than on its own. It looks in three
directions at once:

- **At the kit.** Its onsets are read off the drum pattern, so wherever the kick
  moves the bass moves with it. Change the drums and the line is rewritten
  against the new ones, from the same seed; toggle a kick step by hand and the
  bass follows it, while toggling a hat leaves the line exactly where it was,
  because it was never listening to that.
- **At the melody.** Pitches are scored against whatever the tune is doing at
  that moment — go the other way when it moves, stay off the note it is already
  sitting on, and never land a semitone under it. That is the *Against the
  melody* slider.
- **At the chords.** Every chord change gets a note under it, and the note
  before a change is usually an approach into the root of the next one: a
  semitone below, a step in the key, or the fifth above falling onto it. It also
  *leans* into changes — hitting the new root an eighth early and holding it over
  the bar line — and answers a tom fill or a crash by getting busy with it.

Five styles: **root notes** (foundation and nothing else), **locked to the
kick** (plays where the kick plays), **walking** (a note on every beat, walking
into the next root), **driving eighths**, and **counterpoint** (fills the gaps
the melody leaves). *Root ↔ walking* is how far it strays from the root and how
hard it leans; *density* is how many notes; *register* is which octave it sits
in. It has its own seed, so you can keep a bass line you like while rolling the
melody, or roll it on its own until it sits right.

It is drawn in the piano roll too, in blue underneath the melody, so you can see
the counterpoint. It is not draggable — it is written against two other parts,
so it is rolled rather than edited.

### Sound

Each of the three pitched parts gets its own instrument, chosen in the **Sound**
box. Nine voices for the melody — saw lead, square bleep, plucked string, FM
bell, breathy flute, electric organ, synth brass, glass, vox — nine for the
harmony underneath: warm pad, strings, electric piano, drawbar organ, nylon
guitar, choir, glass bells, brass section, marimba — and seven for the bass:
fingered, sub, picked, upright, synth, acid, FM. All synthesised, no samples;
each one is a stack of oscillators, an envelope and a filter, described as data
in `src/music/instruments.js`, so adding another is adding a recipe rather than
writing code. ▶ next to each box plays it.

All three default to **🎲 From the seed**, which takes the instrument from the
same seed that produced the notes. So a new progression arrives in a new
harmony, a new melody arrives in a new voice — and typing an old seed back in
brings its instrument back with it. Pin one from the list if you want to keep
it while you roll everything else.

## Song

A loop is not a song. The **Song** tab keeps a drawer of *sections* and the
running order you build out of them.

**Save as section** freezes everything the Chords and Rhythm tabs are showing —
key, progression, melody, your hand edits, the bass line, the drum pattern, and
every seed — under a name. Body sections are named A, B, C as you go; intros, middle eights
and outros take their role as a name. Then carry on working: the drawer keeps
the old one.

Each saved section can be:

| | |
| --- | --- |
| **＋ Song** | Drop it into the running order. |
| **Edit** | Open it back up in the other tabs, exactly as you left it. |
| **Fork** | Copy it into a new section, so you can take a variation somewhere else without losing the original. **Fork a variation** does the same and rolls a new melody over the same chords — the quick way to get a B out of an A. |

The running order is a row of chips: reorder them with ‹ ›, set how many times
each one repeats, and drop them out again with ✕. **Auto-arrange** lays out
everything you have saved in the obvious order — intro, sections, middle eight,
outro. A song is therefore an optional intro, one or more sections, and an
optional outro, with anything in between you care to put there.

Sections carry their own key, chords, melody, bass, drum pattern *and
instruments*, so the kit and the harmony really do change with the section — the
shelf prints the voices under each card. A section stores the *choice* rather
than the result, so one left on "from the seed" re-derives its sound from its
own seeds:
every section you roll turns up in a different colour, and none of them drift
when you go back to them. Tempo, swing and which parts sound stay global — they
live in the transport.

## Rhythm

A step sequencer with five generators: **euclidean** (pulses spread as evenly as
possible — the maths behind a lot of world percussion), **backbeat**, **pure
chance**, **cut-up** (generate a bar, chop it into beats, shuffle), and
**polyrhythm** (every piece gets its own pulse count, so the parts pull apart
and only line up again at the top). Set steps per bar (8, 12 for 6/8, or 16),
bars, density, and how much bar 2 drifts from bar 1. Click any step to edit it
by hand, or a row's name to hear that piece on its own.

Sixteen pieces: kick, snare, clap, rim, tom, conga, closed and open hat, ride,
crash, shaker, tambourine, cowbell, woodblock, clave and triangle. They are not
generated by name but by *role* — anything that behaves like a hi-hat is written
like a hi-hat — so a shaker knows to keep time, a clave plays a clave rather
than a euclidean guess at one, a crash lands once at the top of the phrase, and
a tom fill waits for the last bar. 🎲 next to the kit picks a whole plausible
kit at random: always a kick, always something on 2 and 4, always a timekeeper,
then a couple of extras.

**Kit sound** re-voices the lot without changing a note — *studio*, *808*,
*909*, *tape lo-fi*, *toy box*, *cardboard*. A kit is not a different set of
drums; it tunes them, stretches their tails and puts a lid on the top. Like the
instruments, it defaults to taking its choice from the seed.

## Seeds

Every tab has its own seed box, and every generator runs off it, so the same
seed and settings always give back the same words, chords, melody or pattern.
Write down the ones you like; type one back in to hear it again. The dice
button rolls a fresh seed for that part alone — a new progression under the
same melody idea, a new melody over chords you want to keep, or a new bass line
under both.

Melody transforms, rhythm cut-ups and hand-edited steps are changes made *on
top* of what the seed produced, so they are not replayed by it — and a saved
section keeps all of them, seeds included, so it always plays back the way you
left it.

## Playing and exporting

The transport at the bottom is shared: tempo, swing, and which parts sound.
Whichever part is longest sets the loop length and the shorter ones repeat to
fill it, so a two-bar drum pattern keeps playing under a four-bar progression.
Space bar toggles playback. Everything is synthesised with the Web Audio API —
no samples, no libraries.

Play follows the tab you are on: on Chords or Rhythm it loops the idea in front
of you, and on the Song tab it plays the arrangement from the top, section by
section. The readout next to Export MIDI tells you which.

**Export MIDI** writes a type-1 file with chords, melody, bass and drums on
separate tracks (drums on channel 10), swing baked in, ready to drag into any DAW — the
loop, or the whole song if that is what you are playing. Each instrument carries
a General MIDI program number, so the file opens on roughly the patch you were
hearing; a song whose sections change voice writes a program change at each
join.

## Development

```sh
npm test                        # 84 unit tests, no dependencies
node tools/build-wordlists.mjs  # regenerate data/words.*.json
```

```
index.html          markup for all four tabs
styles.css
src/
  rng.js            seeded randomness — every generator runs off this
  cutup.js          strips, fold-in, verbasizer, line assembly
  lyrics.js         ties the text primitives into one call
  words.js          dictionary loading, imagery banks, rarity bands
  sources.js        built-in seed texts
  music/
    theory.js       scales, chords, progressions, voicing, chord parsing
    melody.js       melody generation, cut-up transforms, the hand-edit ledger
    bass.js         the bass line, written against the drums and the melody
    rhythm.js       euclidean and friends, and the kit written by role
    instruments.js  synth recipes for lead, harmony, bass and the drum kits
    sections.js     saved sections and the running order built from them
    arrange.js      lays the parts out over the loop, or sections end to end
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
