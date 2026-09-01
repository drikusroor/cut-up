// The Library tab: a shelf that outlives the tab you have open.
//
// Two shelves, and they are different things on purpose. A *section* in the
// library is a loose idea you might use again — a chorus you like, a drum
// pattern that works, a middle eight you wrote for something else. A *song* is
// the whole desk: every section, the running order, the transport, the mix and
// the words, so that opening one puts you back where you were.
//
// Both are kept in the browser (see library/store.js) and both can be written
// out as a file (see library/format.js) to send to someone, put in a
// repository, or keep somewhere the browser cannot lose it.

import {
  $, download, el, toast,
} from './dom.js';
import { askText, confirmAction } from './prompt.js';
import { markButtons, songShape } from './marks.js';
import {
  applySong,
  byteSize,
  FILE_ACCEPT,
  parseFile,
  sectionFile,
  sectionFilename,
  serialize,
  sizeLabel,
  songFile,
  songFilename,
  songSnapshot,
  SONG_EXT,
  SECTION_EXT,
} from '../library/format.js';
import {
  estimate, list, put, remove, storageKind, STORES,
} from '../library/store.js';
import {
  buildSongPlan,
  clockTime,
  clone,
  forkSection,
  makeSection,
  nextSectionName,
  planSeconds,
  sectionSteps,
} from '../music/sections.js';
import { chordSymbol, keyLabel, keyUsesFlats } from '../music/theory.js';
import { meterInfo } from '../music/meter.js';

/** A time you can read at a glance: "today", "3 days ago", "12 Mar". */
function when(stamp) {
  if (!stamp) return '';
  const days = Math.floor((Date.now() - stamp) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return new Date(stamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * @param {object} ctx the app shell
 * @param {{song: object, words: object}} panels the tabs that have to be told
 *   when a whole song has been poured over the state
 */
export function initLibrary(ctx, panels) {
  const { state, save } = ctx;

  const ui = {
    songName: $('#library-song-name'),
    saveSong: $('#library-save-song'),
    exportSong: $('#library-export-song'),
    saveSection: $('#library-save-section'),
    importButton: $('#library-import'),
    importFile: $('#library-import-file'),
    songs: $('#library-songs'),
    sections: $('#library-sections'),
    status: $('#library-status'),
    songCount: $('#library-song-count'),
    sectionCount: $('#library-section-count'),
  };

  ui.importFile.setAttribute('accept', FILE_ACCEPT);

  /** What is on the shelves, as read back from the browser. */
  let songs = [];
  let sections = [];

  // --- putting things on the shelf ------------------------------------------

  async function saveSong({ name = ui.songName.value.trim() } = {}) {
    const title = name || `Song ${new Date().toLocaleDateString()}`;
    const snapshot = songSnapshot(state, { name: title });
    const plan = buildSongPlan(state.sections, state.arrangement);
    const record = {
      id: newId('song'),
      name: title,
      savedAt: Date.now(),
      // Enough to draw the card without reading the whole song back.
      meta: {
        parts: plan.blocks.length,
        sections: state.sections.length,
        seconds: planSeconds(plan, state.tempo),
        tempo: state.tempo,
        bytes: byteSize(snapshot),
      },
      song: snapshot,
    };
    await put(STORES.songs, record);
    ui.songName.value = title;
    await refresh();
    toast(`Saved “${title}” to the library`);
    return record;
  }

  /**
   * Puts one section on the shelf. Called from here for the idea you have
   * open, and from the Song tab's cards for one already in the drawer.
   */
  async function saveSection(section, { announce = true } = {}) {
    if (!section) return null;
    const record = {
      id: newId('lib'),
      name: section.name,
      savedAt: Date.now(),
      meta: {
        key: keyLabel(section.music?.rootPc ?? 0, section.music?.scaleId),
        kind: section.kind,
        bars: Math.max(1, Math.round(sectionSteps(section)
          / meterInfo(section.meter || state.meter).stepsPerBar)),
        notes: (section.music?.melody || []).length,
        bytes: byteSize(section),
      },
      section: clone(section),
    };
    await put(STORES.sections, record);
    await refresh();
    if (announce) toast(`${section.name} is in the library`);
    return record;
  }

  // --- taking them off it ---------------------------------------------------

  /**
   * Opens a saved song. Everything on the tabs is replaced, so it asks first
   * when there is work here that is not on the shelf.
   */
  async function openSong(record) {
    const risky = state.sections.length || state.music.chords.length;
    if (risky) {
      const yes = await confirmAction({
        title: `Open “${record.name}”?`,
        body: 'Everything you have open now — the sections in the drawer, the running order, '
          + 'the mix and the words — is replaced by what is in this song. Save the song you '
          + 'have first if you want to be able to come back to it.',
        confirmLabel: 'Open it',
        cancelLabel: 'Stay here',
      });
      if (!yes) return;
    }
    applySong(state, record.song);
    // Every panel is holding the old state; each one is told to read it again.
    panels.words?.applyState?.();
    ctx.applyLoadedSong?.();
    ui.songName.value = record.name;
    save();
    toast(`Opened “${record.name}”`);
  }

  /** Copies a library section into the song you have open. */
  function addSection(record, { arrange = true } = {}) {
    const copy = forkSection(record.section, state.sections);
    // A fork renames to the next free letter, which is right when it lands in
    // a drawer that may already have an A — but a section brought back by name
    // should keep the name you gave it where that is free.
    const taken = new Set(state.sections.map((s) => s.name));
    if (!taken.has(record.section.name)) copy.name = record.section.name;
    state.sections.push(copy);
    if (arrange) state.arrangement.push({ sectionId: copy.id, repeats: 1 });
    panels.song.render();
    save();
    toast(`${copy.name} added to the song`);
    return copy;
  }

  /**
   * Renames something on the shelf.
   *
   * A song carries its own name inside it as well — it is written into the
   * `.cutsong` file and shown when the song is opened — so both are set, or a
   * renamed song would go back to its old name the moment it was exported.
   */
  async function renameRecord(store, record) {
    const song = store === STORES.songs;
    const name = await askText({
      title: `Rename “${record.name}”`,
      body: song
        ? 'The name the song is filed under, and the one it takes with it into a file.'
        : 'The name this idea sits under on the shelf. Sections you drop into a song keep it, '
          + 'unless that letter is already taken in there.',
      label: 'Called',
      value: record.name,
      confirmLabel: 'Rename',
    });
    if (!name || name === record.name) return;
    const updated = { ...record, name };
    if (song && updated.song) updated.song = { ...updated.song, name };
    if (!song && updated.section) updated.section = { ...updated.section, name };
    // Whatever it is called now, it was saved when it was saved.
    await put(store, { ...updated, savedAt: record.savedAt });
    // The name box at the top is showing this song if it is the one you saved.
    if (song && ui.songName.value === record.name) ui.songName.value = name;
    await refresh();
    toast(`Renamed to “${name}”`);
  }

  /**
   * Takes something off the shelf for good.
   *
   * The library is the one place in the app where deleting something is not
   * recoverable by rolling the dice again — a song on this shelf may be the only
   * copy of an evening's work — so it asks, and it says what it is about to
   * lose rather than only that it is about to lose something.
   */
  async function removeRecord(store, record) {
    const song = store === STORES.songs;
    const meta = record.meta || {};
    const what = song
      ? `${meta.sections ?? 0} section${meta.sections === 1 ? '' : 's'}, the running order, `
        + 'the tempo, the mix and the words it was cut up from'
      : 'the chords, the tune, the hand edits and the drum pattern in it';
    const yes = await confirmAction({
      title: `Delete “${record.name}”?`,
      body: `Everything in it — ${what} — goes with it, and there is no undo. `
        + `Press ⤓ File first if you want a copy on disk${song && state.sections.length
          ? '; whatever you have open on the other tabs is untouched either way' : ''}.`,
      confirmLabel: 'Delete it',
    });
    if (!yes) return;
    await remove(store, record.id);
    await refresh();
    toast(`Deleted “${record.name}”`);
  }

  // --- files ----------------------------------------------------------------

  function exportSong(record) {
    const file = record
      ? { ...songFile(state, { name: record.name }), song: record.song }
      : songFile(state, { name: ui.songName.value.trim() || 'Untitled' });
    download(songFilename(file.song.name), serialize(file), 'application/json');
  }

  function exportSection(section) {
    download(sectionFilename(section), serialize(sectionFile(section)), 'application/json');
  }

  async function importFiles(files) {
    for (const file of files) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const parsed = parseFile(await file.text());
        if (parsed.kind === 'song') {
          const record = {
            id: newId('song'),
            name: parsed.song.name || file.name.replace(/\.[^.]+$/, ''),
            savedAt: Date.now(),
            meta: {
              parts: parsed.song.arrangement.length,
              sections: parsed.song.sections.length,
              seconds: planSeconds(
                buildSongPlan(parsed.song.sections, parsed.song.arrangement),
                parsed.song.tempo,
              ),
              tempo: parsed.song.tempo,
              bytes: byteSize(parsed.song),
              imported: true,
            },
            song: parsed.song,
          };
          // eslint-disable-next-line no-await-in-loop
          await put(STORES.songs, record);
          toast(`Imported “${record.name}” — it is on the shelf below`);
        } else {
          for (const section of parsed.sections) {
            // eslint-disable-next-line no-await-in-loop
            await saveSection(section, { announce: false });
          }
          toast(`Imported ${parsed.sections.length} section${parsed.sections.length === 1 ? '' : 's'}`);
        }
      } catch (error) {
        toast(error.message || 'That file could not be read');
      }
    }
    await refresh();
  }

  // --- drawing the shelves --------------------------------------------------

  function songCard(record) {
    const meta = record.meta || {};
    return el('div', { class: 'library-card' }, [
      el('div', { class: 'library-head' }, [
        el('span', { class: 'library-name', text: record.name }),
        el('span', { class: 'library-when', text: when(record.savedAt) }),
      ]),
      el('div', {
        class: 'library-meta',
        text: [
          `${meta.sections ?? 0} section${meta.sections === 1 ? '' : 's'}`,
          `${meta.parts ?? 0} in the running order`,
          meta.seconds ? clockTime(meta.seconds) : null,
          meta.tempo ? `${Math.round(meta.tempo)} bpm` : null,
          meta.bytes ? sizeLabel(meta.bytes) : null,
        ].filter(Boolean).join(' · '),
      }),
      el('div', { class: 'section-actions' }, [
        el('button', {
          type: 'button', class: 'btn ghost', title: 'Put this song back on the tabs', onclick: () => openSong(record),
        }, ['Open']),
        // A song you kept is a song you thought was worth keeping, and that is
        // worth telling the model — mostly about the order it is in.
        markButtons(ctx, {
          ...songShape(record.song?.sections, record.song?.arrangement),
          name: record.name,
          about: `“${record.name}”`,
          digest: `${record.name} · ${meta.sections ?? 0} sections`,
        }),
        el('button', {
          type: 'button', class: 'btn ghost', title: `Write it out as a ${SONG_EXT} file`, onclick: () => exportSong(record),
        }, ['⤓ File']),
        el('button', {
          type: 'button', class: 'btn ghost', title: 'Call it something else', onclick: () => renameRecord(STORES.songs, record),
        }, ['✎ Rename']),
        el('button', {
          type: 'button', class: 'btn ghost danger', title: 'Take it off the shelf', onclick: () => removeRecord(STORES.songs, record),
        }, ['🗑']),
      ]),
    ]);
  }

  function sectionCard(record) {
    const meta = record.meta || {};
    const music = record.section?.music || {};
    const flats = keyUsesFlats(music.rootPc ?? 0, music.scaleId);
    const chords = (music.chords || []).map((chord) => chordSymbol(chord, flats)).join(' ');
    return el('div', { class: `library-card kind-${record.section?.kind || 'main'}` }, [
      el('div', { class: 'library-head' }, [
        el('span', { class: 'library-name', text: record.name }),
        el('span', { class: 'library-when', text: when(record.savedAt) }),
      ]),
      el('div', {
        class: 'library-meta',
        text: [
          meta.key,
          meta.bars ? `${meta.bars} bars` : null,
          meta.notes ? `${meta.notes} notes` : null,
          meta.bytes ? sizeLabel(meta.bytes) : null,
        ].filter(Boolean).join(' · '),
      }),
      chords ? el('div', { class: 'section-chords', text: chords }) : null,
      el('div', { class: 'section-actions' }, [
        el('button', {
          type: 'button', class: 'btn ghost', title: 'Hear it', onclick: () => ctx.playCards?.([record.section], { meter: record.section.meter }),
        }, ['▶']),
        el('button', {
          type: 'button', class: 'btn ghost', title: 'Copy it into the song you have open', onclick: () => addSection(record),
        }, ['＋ Song']),
        markButtons(ctx, {
          sections: [record.section],
          name: record.name,
          about: `“${record.name}”`,
          digest: `${record.name} · ${meta.key || ''}`.trim(),
        }),
        el('button', {
          type: 'button', class: 'btn ghost', title: `Write it out as a ${SECTION_EXT} file`, onclick: () => exportSection(record.section),
        }, ['⤓ File']),
        el('button', {
          type: 'button', class: 'btn ghost', title: 'Call it something else', onclick: () => renameRecord(STORES.sections, record),
        }, ['✎ Rename']),
        el('button', {
          type: 'button', class: 'btn ghost danger', title: 'Take it off the shelf', onclick: () => removeRecord(STORES.sections, record),
        }, ['🗑']),
      ]),
    ]);
  }

  async function renderStatus() {
    const bytes = [...songs, ...sections].reduce((total, r) => total + (r.meta?.bytes || 0), 0);
    const where = {
      indexeddb: 'in this browser’s database',
      localstorage: 'in this browser’s local storage — an older browser, so keep files of anything you care about',
      memory: 'nowhere: this browser will not let the page store anything, so the library empties when you close the tab',
      unknown: 'in this browser',
    }[storageKind()];
    const room = await estimate();
    ui.status.textContent = `${songs.length + sections.length} things on the shelf, about `
      + `${sizeLabel(bytes)}, kept ${where}.`
      + (room ? ` The browser has offered this page about ${sizeLabel(room.quota)}.` : '')
      + ' Nothing here leaves the machine.';
  }

  async function refresh() {
    [songs, sections] = await Promise.all([list(STORES.songs), list(STORES.sections)]);

    ui.songs.replaceChildren(...(songs.length ? songs.map(songCard) : [
      el('p', { class: 'hint' }, [
        'No songs saved yet. “Save the song” keeps everything — sections, running order, '
        + 'transport, mix and words — under a name you can come back to.',
      ]),
    ]));
    ui.sections.replaceChildren(...(sections.length ? sections.map(sectionCard) : [
      el('p', { class: 'hint' }, [
        'No sections saved yet. Every card on the Song tab has a 📚 button that files it here, '
        + 'ready to drop into something else.',
      ]),
    ]));
    ui.songCount.textContent = songs.length ? `${songs.length}` : '';
    ui.sectionCount.textContent = sections.length ? `${sections.length}` : '';
    await renderStatus();
  }

  // --- events ---------------------------------------------------------------

  ui.saveSong.addEventListener('click', () => saveSong());
  ui.exportSong.addEventListener('click', () => exportSong(null));
  ui.saveSection.addEventListener('click', () => {
    const open = state.sections.find((s) => s.id === state.currentSectionId);
    if (open) {
      saveSection(open);
      return;
    }
    // Nothing is open as a section, but something is open — the loose idea on
    // the other tabs. Filing that is what the button obviously means, so it is
    // what it does, rather than telling you to go and do it somewhere else.
    if (!state.music.chords.length) {
      toast('Nothing to file yet — make a progression on the Chords tab first');
      return;
    }
    saveSection(makeSection({
      name: nextSectionName(state.sections, 'main'),
      kind: 'main',
      music: state.music,
      rhythm: state.rhythm,
      meter: state.meter,
    }));
  });
  ui.importButton.addEventListener('click', () => ui.importFile.click());
  ui.importFile.addEventListener('change', async () => {
    const files = [...(ui.importFile.files || [])];
    ui.importFile.value = '';
    if (files.length) await importFiles(files);
  });

  // Dropping a file anywhere on the tab opens it, which is how people who have
  // just been sent one will try to use it.
  const panel = $('#panel-library');
  panel.addEventListener('dragover', (event) => {
    event.preventDefault();
    panel.classList.add('is-dropping');
  });
  panel.addEventListener('dragleave', () => panel.classList.remove('is-dropping'));
  panel.addEventListener('drop', async (event) => {
    event.preventDefault();
    panel.classList.remove('is-dropping');
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) await importFiles(files);
  });

  refresh();

  return {
    refresh,
    /** The Song tab's “Save to library” button. */
    saveSong,
    /** The Song tab's 📚 button on a card. */
    saveSection,
    /** And its ⤓ one. */
    exportSection,
  };
}
