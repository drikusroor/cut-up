# Cut-Up

A scissors-and-paste machine for songwriting, in the browser.

Brion Gysin and William Burroughs cut printed pages into strips and reassembled
them at random; David Bowie did the same with a pile of newspapers, and later
with a program he called the Verbasizer, to write lyrics for *Diamond Dogs* and
*Outside*. This does that for you — and then does the same trick to chord
progressions, melodies and drum patterns, sings the one on the other, mixes the
result, and keeps what you liked.

Everything runs client-side. No build step, no dependencies, nothing uploaded.

## Run it

The app fetches its dictionaries as JSON, so it needs to be served over HTTP
rather than opened as a `file://` URL:

```sh
python3 -m http.server 8000     # or: npx http-server -p 8000
```

Then open <http://localhost:8000>. Any static host works — drop the folder on
GitHub Pages, Netlify, or a Raspberry Pi, and it works the same.

One optional extra: `npm run taste` serves the same files from a small local
Node server that can also *write* — it records what you tell it on the [Train](#train)
tab straight into the repository. Everything else, on every host, still runs
entirely in the browser.

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
(★ files them in the Keepers pad, which persists in your browser). They can also
be [sung](#the-voice). The app also
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

### The voice

Tick **Sing the words on the melody** in the **Voice** box and the two halves of
the app meet: the lines from the Words tab are sung by the tune from this one.

There is no speech engine behind this and nothing is downloaded. A vowel is
three resonances of the throat — park bandpass filters at 270, 2290 and 3010 Hz,
buzz a sawtooth through them, and a listener hears "ee"; move them to 730, 1090
and 2440 and the same buzz says "ah". So the whole singer is a table of numbers
in `src/music/phonemes.js` and about two hundred lines of Web Audio. Consonants
are the same filters plus a band of noise: a hiss for *s* and *f*, a moment of
silence and then a click for *t* and *k*, the nose for *m* and *n*.

Getting from letters to those sounds is done by ordered rewrite rules — try the
longest spelling first, fall back to single letters, and check the letters
either side, which is how *c* knows to be an /s/ in *city* and a /k/ in *cat*.
English spelling being what it is, the hundred-odd words that break every rule
are simply listed. Dutch is close enough to regular that the rules do nearly all
of it; the one thing they have to know is that a vowel is long in an open
syllable and short in a closed one, so *maken* and *makken* come out different.
Switch the word bank to Dutch and the singer switches with it.

Three ways to hear it, in **Through**:

| | |
| --- | --- |
| **Sung** | The synthesiser on its own. A voice made of three bandpass filters. |
| **Vocoder** | A real fourteen-band channel vocoder: the synthesised speech is split into bands, each band's energy is measured, and those measurements open the same bands of a sawtooth playing the melody. The robot choir. |
| **Talk box** | The same vocoder with the melody's own instrument as the carrier, which is what a tube in the corner of your mouth does to a guitar amp. |

The vocoder is the real thing rather than an imitation of one, and it needs no
script processor to be it: an envelope follower is a rectifier and a lowpass,
and in Web Audio an envelope is an audio signal, so it can be connected straight
to a gain's `gain`. Sibilance is let past the bank rather than reconstructed
through it, because a vocoder asked to rebuild an *s* out of a sawtooth gives
you a whistle.

Six singers — alto, soprano, tenor, bass, a small voice, and breath — which are
mostly one number each: how long the throat is, and so how far up or down all
the formants move together. The android has no vibrato and no drift.

#### How the words land on the notes

Setting a lyric is the oldest job in songwriting and mostly a matter of counting,
so the machine does it the way a person does:

- **Phrases come from the rests.** Wherever the tune stops for a beat or more,
  that is a breath, and a line of words goes between two breaths. A melody with
  room in it sings better than one with none.
- **More notes than syllables** and a vowel is held across several of them — a
  melisma, the reason *Gloria* can last eight bars. Which syllable gets it is
  not random: it goes to the end of a word, and preferentially to the end of the
  line. *Held vowels* is how willing it is. A held note slides onto its next
  pitch rather than restriking the word.
- **More syllables than notes** and the long notes are divided until the words
  fit — never below one step, because two syllables on a semiquaver is a
  stutter.
- **Still too many** and the rest of the line moves on to the next phrase rather
  than being thrown away. The readout under the box says so.

The syllables are drawn on the piano roll over the notes they are sung on, with
a ‿ on the notes that are only holding the vowel before them — so it reads like
a lead sheet, and you can see a line that scans badly before you hear it.

The words are taken live from the Words tab, so rerolling the lyrics re-sings
the tune; pick **The Keepers** or type your own instead.

The switch is global, the way tempo and tuning are: turn it on and everything
sings, the song already in the drawer included. Each idea gets its own share of
the lyric — the first starts at the first line, the next further down, and a
song longer than its lyric comes round again, which is what a chorus is. The
same switch appears in the composer on the Song tab, because that is where you
are when you want it.

Saving a section *while it is singing* freezes those words into it, so it goes
on singing that verse after the Words tab has moved on. A section that was not
saved singing has no opinion, and follows the switch.

The voice is a part of its own in the transport, so you can hear it without the
lead synth doubling it, or vice versa.

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
| **▶** | Play just that section on its own, at its own time signature. |
| **＋ Song** | Drop it into the running order. |
| **Edit** | Open it back up in the other tabs, exactly as you left it. |
| **Fork** | Copy it into a new section, so you can take a variation somewhere else without losing the original. **Fork a variation** does the same and rolls a new melody over the same chords — the quick way to get a B out of an A. |
| **↻ Regenerate ▾** | Roll it again. See below. |
| **📚** | File it in the library, to use in another song. |

The running order is a row of chips: reorder them with ‹ ›, set how many times
each one repeats, and drop them out again with ✕. **Auto-arrange** lays out
everything you have saved in the obvious order — intro, sections, middle eight,
outro. A song is therefore an optional intro, one or more sections, and an
optional outro, with anything in between you care to put there.

While the song is playing, **⏮ Previous section** and **Next section ⏭** jump
the playhead straight to the start of the section before or after the one
that is currently sounding — a seek, not a restart, so the transport just
carries on from there.

Sections carry their own key, chords, melody, bass, drum pattern, time
signature *and* instruments, so the kit and the harmony really do change with
the section — the shelf prints the voices under each card, and opening a section
counted in 3/4 brings the 3/4 back with it. A section stores the *choice* rather
than the result, so one left on "from the seed" re-derives its sound from its
own seeds:
every section you roll turns up in a different colour, and none of them drift
when you go back to them. Tempo, feel, tuning, the mix and which parts sound
stay global — they live in the transport.

### Rolling a section again

A section is a frozen set of *settings* as much as a frozen set of notes: the
key, the shape of the tune, how dense the drums are, every seed. So it can be
rolled again without being rebuilt by hand — and the button on each card has two
halves, because there are two things you mean by that.

**↻ Regenerate**, the left half, rolls the lot: new chords, new tune, new bass
line, new drum pattern, new voices, all off the section's own settings. What
comes back is another take of the same idea rather than a different idea — same
length, same density, same shape of line, different roll of the dice.

**▾**, the right half, opens the same machinery with the parts laid out:

| | |
| --- | --- |
| **Chords** | A new progression, same length, same key unless you change it. |
| **Melody** | A new tune over whatever the chords are. |
| **Bass** | A new line, written against the drums and the tune. |
| **Rhythm** | A new drum pattern, same style and density. |
| **Instruments** | New voices for the four players, and nothing else. |

Everything you leave unticked survives untouched, notes and all — which is how
you keep the chords you like and roll only the tune over them. There is also a
**key**: leave the chords alone and change the tonic and the whole section is
simply *moved* there, notes and all, because a chorus a fourth up is the same
chorus. Change the mode and it cannot be moved, only rewritten, so the chords
are rolled whatever the boxes say.

Two more things it will not do. A section written without chords — the drums-only
count-in the composer puts at the top of a song — does not get handed a
progression, and one written without a tune does not get handed one either:
rolling changes what a section is made of, never what it is.

A roll keeps the section's id, so it keeps its place in the running order and
every repeat of it changes together — roll the chorus and all four choruses
change. If you would rather not risk what you have, tick **leave the original
alone** and the new take is filed beside it. Write a **seed** in and the same
section rolled with the same seed comes out the same way twice, so a take you
have rolled past can be got back.

### Compose a whole song

The other way round: press **🎼 Compose a song** and it writes one, then puts
the pieces in the drawer for you to argue with.

A song is not more loop. It is *contrast and return* — a verse sets something
up, the next part goes somewhere else, and when the first thing comes back it
means more than it did. The Beatles did it with a middle eight that changes key,
or drops to the relative minor, or arrives in a different time signature, or is
simply louder and busier than the verse around it. Mozart did it with a rondo:
A, somewhere else, A again, and the A you hear the third time is not quite the A
you heard the first. That is what this writes.

It picks a **shape** — AABA, ABABCB, ABACA, a rondo, a suite — and works out how
many bars each part has to be for the whole thing to last as long as you asked.
Two to four ideas and about two and a half minutes by default; up to six ideas
and twelve minutes if you want a side of a record.

Then every letter after the first is pulled deliberately away from the home one.
The moves it has are the ones a songwriter has:

| | |
| --- | --- |
| **Key** | The relative major or minor, the parallel one, up a fourth or a fifth, or up to the flat sixth — the borrowed, cinematic one. |
| **Mode** | The same tonic heard as Dorian, Phrygian, Lydian, Mixolydian, harmonic minor. |
| **Time** | A section counted in 3/4, 6/8, 5/4 or 7/8 while the rest is in four. |
| **Tempo** | A section pushed a few per cent faster, or pulled back — and codas that slow to a stop. |
| **Timbre** | Another lead, another instrument under it, another kit. A middle eight always changes colour, because that is the contrast people hear first. |
| **Dynamics** | Held back at 70%, or flat out at 120%, written into the velocities of every part. |
| **Density** | Busier and more chromatic, or more air in it; chords moving twice as fast or held twice as long. |
| **Arrangement** | A breakdown with no drums, or no bass; the tune an octave up; half the length. |

Nothing is repeated unchanged forever, either. When a section comes back it may
come back **altered**: a new tune over the same chords, stripped to nothing,
harder with a crash on the front — or, the last time round, up a semitone. Those
arrive as their own sections, named `A′` and `A″`, with the same progression
underneath, so a key lift really is the same chords a semitone higher.

Around all of it: an **intro** made out of the opening of something you are
about to hear — the chords alone, the tune with no band, or drums counting you
in — and a **coda** that fades out, tags, slows to a stop, or lands on one last
chord. The fade is real: it holds, then ramps every part down to nothing across
the last block, and it is in the exported MIDI as well as in the playback.

Under **Everything you can lean on** are the dials: how many ideas, the shape,
how far the sections travel from each other, how much a repeat is altered,
whether it may change key, time signature or tempo, whether it picks its own
tempo, and the song's seed. Every song is written off that one seed, so typing
it back in writes the same song again.

What comes out is not a special object. It is sections and a running order —
open any of them, roll the melody, drag a note, change the kit, reorder the
chips, delete the coda. The composer has no privileged state; it is a very fast
way of doing what the tab already does by hand.

## Library

A saved section lives in the drawer on the Song tab, and the drawer belongs to
the song you have open. The **Library** tab is the shelf behind it: things kept
by name, across songs, across sessions, and — as files — across machines.

There are two shelves, and they are different things on purpose.

**Saved sections** are loose ideas. A chorus that works, a drum pattern you keep
coming back to, a middle eight you wrote for something that went nowhere. The
📚 button on any card on the Song tab files one here; **＋ Song** on the shelf
copies it into whatever you have open now, and ▶ plays it where it stands.

**Saved songs** are the whole desk: every section, the running order, the tempo,
the time signature, the feel, the tuning, the mix, which parts are switched on,
the idea still open on the other tabs, and the words it was all cut up from.
**Open** puts you back where you were rather than merely playing you something —
it asks first, because it replaces what you have.

### Files

Both shelves write files, and both read them:

| | |
| --- | --- |
| **`.cutsec`** | one section, or several — an idea to send somebody, or to keep beside the lyrics |
| **`.cutsong`** | the whole song, everything listed above |

They are plain JSON with a header naming the format and a version, so they are
readable, diffable and mailable, and a file from a newer version of Cut-Up is
refused with a sentence rather than half-loaded into what you were working on.
Nothing in a file is ever evaluated — everything is checked and clamped on the
way in, because the whole point of a shareable file is that it came from
somewhere else. Drop one anywhere on the Library tab to read it in, or use
**⤒ Open a file**.

This is the format to keep if you care about a song. MIDI carries the notes and
a WAV carries the sound, but neither carries the *idea*: the seeds, the
settings, the hand edits, the mix, the words.

### Where it is kept

In your browser, in IndexedDB, and the reason is size. A section is around 4 KB
of JSON; a six-part song with all its sections is around 50 KB. That is nothing
once, but a library is not once — a year of this is hundreds of sections and
dozens of songs, tens of megabytes, and `localStorage` is about five for the
whole origin, shared with the app's own state, read and written synchronously on
the main thread. IndexedDB is asynchronous and measured in hundreds of megabytes;
the line under the shelf tells you how much this browser has offered the page,
and how much you have used.

Where IndexedDB will not open — an old browser, some private windows — it falls
back to `localStorage`, and where that fails too it keeps the library in memory
for the session so the page still runs and the file buttons still work. The line
under the shelf says which of the three you are on. Nothing ever leaves the
machine either way, which is also why a file is worth exporting: a browser's
storage is not a backup.

## Train

The composer picks everything off weighted dice. The dice are good — they know
what a cadence is and what a middle eight is for — but they do not know what
*you* like. This tab is where you tell it, by playing a card game against your
own taste, and where those answers become a small neural network that the
composer then writes with.

### What it actually is

It is worth being straight about this, because "a neural network that writes
songs" is not what this is and could not be.

A model that generates music note by note needs hundreds of thousands of
examples. One person rating sections in the evening will produce a few hundred
opinions in a year. Those are different problems by three orders of magnitude,
and anything claiming to bridge them with your data is fooling you.

So the network here does not write anything. It **listens and judges** — you
show it a section and it guesses how you would have rated it. That is a problem
that fits the data you can realistically give it, and it is enough, because the
generator can produce a thousand candidates a second. Ask it for a section, get
eight, keep the one the model likes best. A few hundred opinions become a
composer that leans your way, without ever needing the millions of songs a
generative model would want.

### The game

Press **Skip this hand** or open the tab and it deals two or three sections out
of the composer's own deck — the same generators, the same seeds, the same
range of keys, meters and contrasts that a composed song is made of. That
matters: a model trained on music from a different distribution than the one it
will be asked to judge has learned to answer a question nobody will ask it.

For each section you are asked four things — the tune, the chords, the groove,
and the whole — and for each join between two sections, one: **do these belong
in the same song?** Five buttons, from *No* to *Love it*.

It is built for the keyboard, because the honest description of this activity
is a grind:

| key | |
|---|---|
| <kbd>1</kbd>–<kbd>5</kbd> | answer the highlighted question and move to the next |
| <kbd>Space</kbd> | play whatever that question is about |
| <kbd>↑</kbd> <kbd>↓</kbd> | move the cursor without answering |
| <kbd>Enter</kbd> | save the hand and deal the next |

**Leave anything you have no opinion about unanswered.** A skipped question is
stored as silence, not as a middling score — the model needs to be able to tell
"that melody is bad" from "I didn't say". And if a hand turns out to contain
something you actually want, **＋ Keep these** puts the sections on the Song tab
like anything else you saved.

### Where your answers go

Serve the app with `npm run taste` instead of `npm start` and a small local
server records every answer straight into `data/taste.jsonl` as you give it. An
evening's session is then a `git diff`.

```sh
npm run taste          # the app on :8000, recording to data/taste.jsonl
npm run train          # fit the model, write models/taste.json
npm run train -- --dry # fit and report, write nothing
```

Without that server — `npm start`, or the live site on GitHub Pages — the tab
still works, but it has nowhere to write: judgements are kept in the browser and
**⤓ Export** hands you a `.jsonl` to drop into `data/` yourself. Start the
recording server later and anything stranded in the browser is pushed through on
the way past.

Two files are committed, and they are not equal in value:

- **`data/taste.jsonl`** — your opinions. The valuable one. Weights can be
  refitted in ten seconds; an evening of listening cannot be got back.
- **`models/taste.json`** — the weights, derived from the above by
  `npm run train`. If it is ever lost or goes stale, retrain it.

There is no music in `taste.jsonl`. Each line stores the *seed the sections were
dealt from*, because dealing is deterministic — twelve characters puts the exact
same bars back on the table a year later. That is why a thousand rounds is a few
hundred kilobytes, and why changing how the music is measured never costs you a
single opinion you gave: the trainer re-deals every round and re-measures it
from scratch.

### Whether to believe it

The number the tab reports is not how well the model fits your answers — any
model fits your answers, that is what fitting means. It is **how often it
agreed with you about music it was never trained on**, measured by splitting
your rounds into folds and testing each fold against a model that never saw it.

The metric is *ranking*: given two things you rated differently, does it put
them in the right order? That is the only question the composer ever asks it,
and it has an honest floor — a coin gets 50%.

```
Agreement with you, on rounds it was not trained on:
  As a whole  ██████████·········  73.9%  (128 answers)
  The tune    █████████··········  72.3%  (128 answers)
  The chords  ████···············  59.8%  (128 answers)
  The groove  ████████████·······  80.1%  (128 answers)
  Together    ██████████·········  74.2%  (66 answers)

              0.5 ─────────────── 1.0   (0.5 is a coin)
```

That figure then **gates the model's own influence**. The *How much say it gets
when composing* slider is multiplied by how far above a coin the model actually
got, so one that has not beaten chance has no say at any setting, and the
composer behaves exactly as it did before there was a model at all. Rate
everything at random and you will get a model that reports ~50% and changes
nothing — which is the correct outcome, and the reason the number is worth
reading.

Expect roughly: under 30 rounds, noise. Around 60–100, something faintly real.
Past a few hundred, a composer that noticeably leans your way. It is a thing to
come back to, not an afternoon.

### What it hears

The model cannot hear audio. Every section reaches it as ~80 numbers, each one
something a musician would actually say — the proportion of melodic intervals
that are leaps, whether the snare is on the backbeat, how often a two-note
gesture comes back, whether the bass locks to the kick, how far the chords move
by fourths. Joins get another ~30 about the seam itself: the distance round the
circle of fifths, whether the bar changes underneath, the interval from the last
note of one section to the first of the next.

Choosing those numbers is most of the work, and it is why this can learn
anything from fifty examples rather than fifty thousand — the listening has
already been done, in `src/music/features.js`. The model's job is only to work
out which of them you care about.

### How it composes with it

With a model that has earned a say, each idea in a song is auditioned: several
candidates are generated and rendered, the model scores them, and the winner is
*drawn* rather than declared — stacked by rank, with the odds set by how much
the model has earned. The favourite usually wins; the outsider sometimes does.
A model that is right 70% of the time is wrong 30% of the time, and a composer
that always took its top pick would inherit every blind spot it has and stop
surprising you.

Second and later sections are judged on two things at once and have to pass
both: whether the section is any good, and whether it belongs in the same song
as the one before it. A gorgeous idea in the wrong key is still the wrong key.

Given the same seed it still writes the same song back. The model changes what
gets chosen, never that the choosing is repeatable.

## Rhythm

A step sequencer with five generators: **euclidean** (pulses spread as evenly as
possible — the maths behind a lot of world percussion), **backbeat**, **pure
chance**, **cut-up** (generate a bar, chop it into beats, shuffle), and
**polyrhythm** (every piece gets its own pulse count, so the parts pull apart
and only line up again at the top). How many steps are in a bar is the time
signature's business — see [Time](#time) — so what you set here is bars,
density, and how much bar 2 drifts from bar 1. Click any step to edit it by
hand, or a row's name to hear that piece on its own.

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

## Time

Next to the tempo is the time signature: how many beats in a bar, and what kind
of beat. Type `7` over the `4`, or pick an `8` underneath, and everything moves
with it — the sequencer draws a bar of that length, the chord length is measured
in those bars, and the melody and bass are cut onto the new beat. A step is
always a sixteenth note, so 4/4 is 16 steps, 3/4 is 12, 7/8 is 14.

Compound meters are counted properly: 6/8 is two dotted beats rather than six
eighths, so the snare lands where a drummer would put it and not on every
eighth. The exported MIDI carries the signature, so a DAW draws the same bar
lines you were looking at.

Changing it re-cuts the parts from the same seeds — it is the same idea counted
differently rather than a new one. Hand edits on the melody go the way they go
on any reroll, because the notes they were pinned to no longer exist.

## Feel

A sequencer plays exactly on the grid. Nobody else does. The **Feel** drawer in
the transport has one slider for how loose the whole band is, and then two per
player:

- **Off the grid** — how far that part's notes wander off their step, at
  random. The deviations pile up around zero rather than spreading flat, so most
  notes are nearly right and a few are noticeably out, which is what a player's
  timing actually looks like when you measure it.
- **Rush ↔ lag** — which side of the beat that part sits on, all the time. A
  drummer who pushes, a bass that plays behind it. This is the one that changes
  how a groove feels rather than how tidy it is.

It is seeded like everything else here, so the same seed is the same take, and
the MIDI export is the take you just heard rather than a second, differently
sloppy one. At zero it is a machine again, note for note.

## Tuning

The **Tuning** drawer holds two ideas that share the same arithmetic.

**Temperament** is where the notes are. *Divisions of the octave* is normally
12 — the piano — and anything else keeps the twelve notes of the key and the
chords you already know, and puts them on the nearest steps of a finer ladder.
19 and 31 flatten the thirds, 17 sharpens them, 24 lands back on the piano
because it contains it. The tonic and the octave never move, so it bends the
colour of a key rather than drifting out of it. There are also the old unequal
temperaments — just intonation, Pythagorean, quarter-comma meantone — which are
measured from whatever key you are in, so the home key is the one that is sweet.

**Detune** is where the players are. *Instrument detune* gives each part a fixed
offset, which is a section that tuned five minutes ago; *note-to-note drift*
wobbles each note on its own, which is a singer rather than a piano. Both come
off the tuning seed, so a piece keeps the same slightly-wrong tuning every time
you play it.

MIDI export writes the melody and the bass as pitch bends — one per note, with
the bend range declared in the file — so a microtonal line survives the trip
into a DAW. The chord track cannot be bent note by note on one channel, so it is
left on the nearest keys.

## Mix

The **Mix** drawer in the transport is a five-channel desk: the melody, the
voice riding on it, the chords, the bass and the kit. Each channel has the strip
a desk has, in the order a desk has it:

- **Level** and **Pan** — where it sits, and where it sits between the speakers.
- **Low / Mid / High** — a wide, gentle three-band EQ (a shelf at 160 Hz, a bell
  at 1 kHz, a shelf at 4.8 kHz), for carving room out of the middle rather than
  for surgery.
- **Squeeze** — one knob of compression. A real compressor has four controls and
  they interact; this walks the threshold down as it walks the ratio up, which is
  the diagonal across those four that people actually use, and gives some of what
  it takes back so that turning it up does not only ever make a part quieter.
- **Reverb** — a send, post-fader, to one shared plate. The plate's *size* and
  *damping* are under the strips.
- **M** and **S** — mute and solo. Soloing anything silences everything that is
  not soloed, which is the quickest way to hear what one instrument is actually
  doing.

Then a master fader, **Flatten** to put everything back at unity, and **Desk in
circuit** to take the whole thing out and hear it without.

Two things worth knowing. The first is that the desk is *live*: moving a fader
adjusts the graph that is already running, so you mix while the song goes round
rather than stopping to mix. Only the reverb is ever rebuilt, and only when its
size or damping moves.

The second is that the mix travels with the song. It is plain data, like the
tempo, so playback and the offline renderer build the same desk from it and
[an exported file](#export-audio) comes out mixed the way you left it. It is
saved with a [song file](#files) too.

The part switches next to the transport's tempo are a different thing and stay a
different thing: they leave a part *out of the arrangement*, which is what the
MIDI and audio exports honour. Muting on the desk only turns it down.

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

The transport at the bottom is shared: tempo, time signature, swing, feel,
tuning, [the mix](#mix), and which parts sound.
Whichever part is longest sets the loop length and the shorter ones repeat to
fill it, so a two-bar drum pattern keeps playing under a four-bar progression.
Space bar toggles playback. Everything is synthesised with the Web Audio API —
no samples, no libraries.

Play follows the tab you are on: on Chords or Rhythm it loops the idea in front
of you, and on the Song tab it plays the arrangement from the top, section by
section. The readout next to Export MIDI tells you which.

**Export MIDI** writes a type-1 file with chords, melody, bass and drums on
separate tracks (drums on channel 10), swing and the humanizer's nudges baked
in, the time signature on the tempo track, ready to drag into any DAW — the
loop, or the whole song if that is what you are playing. A song whose sections
change tempo or time signature writes those changes onto the tempo track as
well, so a DAW draws the bar lines where you heard them. Each instrument carries
a General MIDI program number, so the file opens on roughly the patch you were
hearing; a song whose sections change voice writes a program change at each
join. A sung melody carries its words out too, as the lyric meta events a
karaoke player and every serious DAW read — one syllable on the note it starts
on, and nothing on the notes it is held over.

### Export audio

**Export audio** renders the same thing to a sound file: the loop you have
open, one saved section from the shelf (the ⤓ Audio button on its card), or the
whole arrangement. Muted parts are left out, exactly as they are in the MIDI —
including the voice, so a song with the melody muted and the voice left on
exports as the sung line and nothing else. A loop can be sent round more than
once, if four bars is shorter than you wanted.

The render is offline — the whole song is synthesised as fast as the machine
can manage rather than in real time, through the same voices, the same singer,
the same humanizer, the same desk and the same master bus you were listening
to. How much faster than
real time depends on how busy the arrangement is and what you are on, but it is
never slower, and a bar tells you how far along it is.

What it can be written *as* depends on the browser, and the dialog says which
is which rather than guessing:

| Format | How it is made | Where |
| --- | --- | --- |
| **WAV** 16- or 24-bit | written here, byte by byte | everywhere |
| **M4A** (AAC) | the browser's own encoder, in a container written here | Chrome, Edge and Safari — wherever it has an AAC encoder |
| **Opus** in WebM or Ogg | recorded through MediaRecorder | Chrome and Firefox, whichever container they will record |
| **MP3** | MediaRecorder, where a browser offers it | almost nowhere |

Nothing is bundled to make this work — no encoder library, no build step, still
a folder of text files. That is also the catch: almost no browser will encode
MP3, so the dialog greys it out and says so. A WAV converts to one in a second
with anything.

Anything recorded rather than encoded is captured in real time, because that is
the only way MediaRecorder works: a three-minute song takes three minutes to
write, and the dialog says so before you start rather than after. A WAV never
is. An M4A only is on a browser that will record AAC but not encode it, which
the dialog has already worked out by the time you open it.

Before the M4A is offered at all, a quarter second of silence is encoded,
wrapped and handed back to the browser to decode. The AAC frames come from the
browser but the container around them is ours, and a file it cannot read itself
is not one worth handing to anybody.

## Development

```sh
npm test                        # 240 unit tests, no dependencies
npm start                       # serve the app
npm run taste                   # serve it, recording judgements to data/taste.jsonl
npm run train                   # fit models/taste.json from data/taste.jsonl
node tools/build-wordlists.mjs  # regenerate data/words.*.json
```

```
index.html          markup for all six tabs
styles.css
src/
  rng.js            seeded randomness — every generator runs off this
  cutup.js          strips, fold-in, verbasizer, line assembly
  lyrics.js         ties the text primitives into one call
  words.js          dictionary loading, imagery banks, rarity bands
  sources.js        built-in seed texts
  music/
    theory.js       scales, chords, progressions, voicing, chord parsing
    meter.js        time signatures: how long a bar is and how it is counted
    melody.js       melody generation, cut-up transforms, the hand-edit ledger
    bass.js         the bass line, written against the drums and the melody
    rhythm.js       euclidean and friends, and the kit written by role
    humanize.js     the seeded timing deviations that stop it sounding perfect
    tuning.js       temperaments, microtonal divisions, and instrument detune
    instruments.js  synth recipes for lead, harmony, bass and the drum kits
    phonemes.js     spelling to sounds, and what each sound's formants are
    vocal.js        setting a lyric to a tune, and timing the sounds in a note
    sections.js     saved sections and the running order built from them
    regenerate.js   rolling a section again — all of it, or one part of it
    compose.js      writes a whole song: shape, contrast, variation, bookends
    mixer.js        the desk: five channels, EQ, compression and one plate
    arrange.js      lays the parts out over the loop, or sections end to end
    midi.js         a small type-1 MIDI writer
    synth.js        the voices, the kit, the singer and the master bus
    audio.js        the transport: the clock, and one pass as a list of events
    render.js       the same events booked into an OfflineAudioContext
    wav.js          a WAV writer: a header and the samples
    mp4.js          a minimal .m4a container for the browser's AAC frames
    export-audio.js what this browser can write, and which path writes it
    features.js     what a section looks like to a machine: the ~80 numbers
  library/
    format.js       the .cutsec and .cutsong formats: writing, reading, checking
    store.js        the shelf itself — IndexedDB, or the next best thing
  ml/
    net.js          a multilayer perceptron, backward pass included, no deps
    model.js        the taste model: one shared trunk, four heads and a join
    train.js        folds, early stopping, and the held-out number that gates it
    judgements.js   the .jsonl record format — seeds and opinions, no music
    store.js        loading and saving, with or without a server behind it
  ui/               one module per tab, one for each of the transport's drawers,
                    one for the export and regenerate dialogs, plus DOM helpers
  main.js           state, persistence, tabs, transport
data/
  words.*.json      the dictionaries
  taste.jsonl       your judgements, one round per line — the file worth keeping
models/
  taste.json        the trained weights, derived from the above
tools/
  build-wordlists.mjs  regenerate the dictionaries
  train-taste.mjs      fit the model and write models/taste.json
  taste-server.mjs     the app plus somewhere to put your answers
test/               node:test suites
```

Adding a language means adding it to `tools/build-wordlists.mjs` (the upstream
corpus covers dozens), writing an imagery bank and glue words for it in
`src/words.js` and `src/cutup.js`, and adding an `<option>` to the language
select. To have it *sung* as well, add a rule table and a list of exceptions to
`src/music/phonemes.js` — the phones themselves are shared, so a new language is
spellings, not sounds.

## Credits

Word banks derived from
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
(OpenSubtitles 2018), licensed CC BY-SA 4.0. The seed texts were written for
this project. Everything else is generated in your browser.
