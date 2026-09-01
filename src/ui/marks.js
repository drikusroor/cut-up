// The thumbs.
//
// The Train tab is the thorough way to teach the model what you like, and it is
// also twenty minutes of concentrated work that most people will do once. This
// is the other way: two buttons on every section card and every song, pressed
// once, in passing, about music you were already listening to for your own
// reasons. It says far less than a rated hand does — "yes" or "no", and nothing
// about which of the tune, the chords and the groove you meant — and it is
// weighted to match, so a month of thumbs nudges the model rather than shoving
// it. See ml/judgements.js for what a mark actually is and what it is worth.
//
// Pressing the lit thumb again clears it, because "I have changed my mind and
// now have no view" is a thing you need to be able to say and is otherwise
// unsayable.

import { el } from './dom.js';

/**
 * A pair of thumbs, wired to the store the Train tab owns.
 *
 * @param {object} ctx the app shell — its `marks` is put there by the Train tab,
 *   which boots after the tabs that draw these, so it is read at click time
 *   rather than captured
 * @param {object} spec
 * @param {object[]} spec.sections the music this is an opinion about
 * @param {number[]} [spec.order] the running order, for a whole song
 * @param {string} [spec.name] what to call it in the toast
 * @param {string} [spec.digest] a human-readable line stored with the mark
 * @param {string} [spec.about] "section A", "this song" — for the button titles
 * @param {() => void} [spec.onChange] told after the answer has gone in
 */
export function markButtons(ctx, {
  sections, order = null, name = '', digest = '', about = 'this', onChange,
}) {
  const current = ctx.marks?.of?.(sections, order) ?? null;
  const press = async (rating) => {
    if (!ctx.marks) return;
    await ctx.marks.set(sections, rating, { name, digest, order });
    onChange?.();
  };

  const thumb = (rating, glyph, verb) => el('button', {
    type: 'button',
    class: `btn ghost mark-btn${current === rating ? ' is-on' : ''}`,
    title: current === rating
      ? `You marked ${about} ${verb} — press again to take it back`
      : `Tell the model ${about} is ${verb}`,
    'aria-pressed': String(current === rating),
    'aria-label': `Mark ${about} as ${verb}`,
    onclick: () => press(rating),
  }, [glyph]);

  return el('span', { class: 'mark-buttons' }, [
    thumb(1, '👍', 'good'),
    thumb(0, '👎', 'not good'),
  ]);
}

/**
 * The distinct sections of a running order and the shape they are heard in.
 *
 * A song is stored as its parts plus a list of which part comes when, rather
 * than as one copy of the chorus per time you hear it — so marking a four
 * minute song costs about what marking its sections would, and the seams the
 * model is taught are the seams that are actually in it.
 *
 * @param {object[]} sections the drawer
 * @param {Array<{sectionId: string}>} arrangement the running order
 * @returns {{sections: object[], order: number[]}}
 */
export function songShape(sections = [], arrangement = []) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const index = new Map();
  const distinct = [];
  const order = [];
  for (const item of arrangement) {
    const section = byId.get(item?.sectionId);
    if (!section) continue;
    if (!index.has(section.id)) {
      index.set(section.id, distinct.length);
      distinct.push(section);
    }
    order.push(index.get(section.id));
  }
  return { sections: distinct, order };
}
