// What a phone changes about the shell.
//
// The panels themselves are the same panels; what a small screen needs is
// somewhere to put the things you are not using this minute. Three jobs:
//
//   - fold each box of settings shut behind its own legend, so a tab opens on
//     what you are making rather than on the knobs that make it;
//   - fold the back half of the transport behind a "More" button, so the fixed
//     bar is one row instead of five;
//   - measure the bar and tell the page how far to keep clear of it, rather
//     than guessing at a number of rems per breakpoint.
//
// The first two only apply below the width at which the layout is two columns;
// above it every rule here is inert and the markup lays out as it always did.

import { $, $$ } from './dom.js';

const NARROW = '(max-width: 860px)';
const OPEN_KEY = 'cut-up:open-groups';

/**
 * Which settings groups the reader has opened, remembered between visits.
 * `fresh` says nothing has ever been stored, which is the only time we get to
 * choose a group's state for them.
 */
function loadOpen() {
  let stored = null;
  try {
    stored = localStorage.getItem(OPEN_KEY);
  } catch {
    // Storage turned off: fold everything and forget it afterwards.
  }
  try {
    const raw = JSON.parse(stored || '[]');
    return { open: new Set(Array.isArray(raw) ? raw : []), fresh: stored === null };
  } catch {
    return { open: new Set(), fresh: true };
  }
}

function saveOpen(open) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify([...open]));
  } catch {
    // A browser with storage turned off still gets the folding, just not the
    // memory of it.
  }
}

/**
 * Gives every settings box a header you can tap to fold it away.
 *
 * The button is there on every width; it is the stylesheet that decides
 * whether it is drawn. The legend stays in the markup for wide screens and is
 * hidden on narrow ones, so the same words are never announced twice.
 */
function foldSettings() {
  const { open, fresh } = loadOpen();

  for (const set of $$('.controls > fieldset')) {
    const legend = set.querySelector(':scope > legend');
    if (!legend) continue;

    const panel = set.closest('.panel')?.id || '';
    const key = `${panel}/${legend.textContent.trim()}`;
    // The composer is the whole reason to be on the Song tab, so on a first
    // visit it is the one box that starts open. After that the reader's own
    // choices decide, closing it included.
    const startsOpen = fresh ? set.classList.contains('composer') : open.has(key);
    if (startsOpen) open.add(key);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'fieldset-toggle';
    toggle.textContent = legend.textContent;
    toggle.setAttribute('aria-expanded', String(startsOpen));

    set.classList.add('collapsible');
    set.classList.toggle('is-collapsed', !startsOpen);
    legend.after(toggle);

    toggle.addEventListener('click', () => {
      const nowOpen = set.classList.contains('is-collapsed');
      set.classList.toggle('is-collapsed', !nowOpen);
      toggle.setAttribute('aria-expanded', String(nowOpen));
      if (nowOpen) open.add(key); else open.delete(key);
      saveOpen(open);
    });
  }

  if (fresh) saveOpen(open);
}

/**
 * The transport's back half — time signature, swing, the part switches, the
 * drawers and the exports — behind one button when there is no room for it.
 */
function foldTransport(narrow) {
  const more = $('#transport-more');
  const rest = $('#transport-rest');
  if (!more || !rest) return;

  const apply = () => {
    if (narrow.matches) {
      // Re-entering a narrow window shuts it again: the point of the button is
      // that the bar is one row until you ask for the rest.
      rest.hidden = more.getAttribute('aria-expanded') !== 'true';
    } else {
      // On a wide screen the wrapper is `display: contents` and there is
      // nothing to fold, so it must never be left hidden by a resize.
      rest.hidden = false;
    }
  };

  more.addEventListener('click', () => {
    const nowOpen = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(nowOpen));
    apply();
  });

  narrow.addEventListener('change', apply);
  apply();
}

/**
 * Keeps the tab you are on inside the strip. Six tabs do not fit across a
 * phone, so the one that is open can easily be the one scrolled off the end —
 * on a reload onto the Train tab, most of all.
 */
function followTabs() {
  const strip = $('.tabs');
  if (!strip) return;

  const reveal = (tab) => {
    if (!tab || strip.scrollWidth <= strip.clientWidth) return;
    tab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  };

  for (const tab of $$('.tab')) tab.addEventListener('click', () => reveal(tab));
  reveal($('.tab.is-active'));
}

/**
 * Publishes the transport's height as `--transport-h`, which is what the page's
 * bottom padding and the toast are drawn against. It wraps to a different
 * number of rows at every width, and to none at all on the Words tab, so the
 * clearance is measured rather than assumed.
 */
function trackTransportHeight() {
  const transport = $('#transport');
  if (!transport) return;

  const measure = () => {
    const height = transport.hidden ? 0 : transport.offsetHeight;
    document.documentElement.style.setProperty('--transport-h', `${height}px`);
  };

  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(measure).observe(transport);
  }
  // A hidden element stops being observed, so watch the attribute that hides
  // it as well: leaving the Words tab is the moment the bar appears.
  new MutationObserver(measure).observe(transport, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  window.addEventListener('resize', measure);
  measure();
}

export function initCompact() {
  foldSettings();
  followTabs();
  foldTransport(window.matchMedia(NARROW));
  trackTransportHeight();
}
