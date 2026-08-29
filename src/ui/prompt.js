// Two questions the app needs to be able to ask: "what shall I call it?" and
// "are you sure?".
//
// The browser has both of these built in and both of them are wrong here.
// `window.prompt` and `window.confirm` are the operating system's dialogs, not
// the app's: they arrive in a different typeface, they cannot say more than one
// sentence, and on a page that has spent some effort looking like a piece of
// studio equipment they look like an error. Worse, several browsers now let a
// page's second confirm be suppressed entirely, which for a delete button is
// not a cosmetic problem.
//
// So these are the same two questions asked with the app's own <dialog>
// elements, and they answer with a promise, which is what makes them read like
// the built-ins they replace:
//
//   if (await confirmAction({ ... })) remove(record);
//   const name = await askText({ value: section.name });
//
// Both resolve to null / false when the dialog is dismissed — with Escape, with
// the backdrop, with the Cancel button — so a caller only ever has to check for
// an answer rather than for a way of not answering.

import { $ } from './dom.js';

/**
 * Asks for a line of text.
 *
 * @param {object} options
 * @param {string} [options.title] the heading
 * @param {string} [options.body] a sentence under it, if there is one worth saying
 * @param {string} [options.label] what the box is for
 * @param {string} [options.value] what it starts with, selected and ready to replace
 * @param {string} [options.confirmLabel]
 * @returns {Promise<string|null>} the trimmed answer, or null if it was dismissed
 */
export function askText({
  title = 'Rename', body = '', label = 'Called', value = '', confirmLabel = 'Save',
} = {}) {
  const dialog = $('#ask-dialog');
  const input = $('#ask-input');
  $('#ask-title').textContent = title;
  $('#ask-body').textContent = body;
  $('#ask-body').hidden = !body;
  $('#ask-label').textContent = label;
  $('#ask-go').textContent = confirmLabel;
  input.value = value;

  return new Promise((resolve) => {
    // `close` fires however the dialog was dismissed, so the answer is read off
    // its return value rather than from whichever button was pressed — which is
    // what makes Escape behave the same as Cancel without any code saying so.
    const done = () => {
      dialog.removeEventListener('close', done);
      const answer = dialog.returnValue === 'ok' ? input.value.trim() : '';
      resolve(answer || null);
    };
    dialog.addEventListener('close', done);
    dialog.returnValue = '';
    dialog.showModal();
    input.focus();
    input.select();
  });
}

/**
 * Asks a yes-or-no question about something that cannot be undone.
 *
 * @param {object} options
 * @param {string} [options.title]
 * @param {string} [options.body] what is about to happen, in full — this is the
 *   whole point of the dialog and is worth more than one line
 * @param {string} [options.confirmLabel]
 * @param {string} [options.cancelLabel]
 * @returns {Promise<boolean>}
 */
export function confirmAction({
  title = 'Are you sure?', body = '', confirmLabel = 'Delete', cancelLabel = 'Keep it',
} = {}) {
  const dialog = $('#confirm-dialog');
  const go = $('#confirm-go');
  $('#confirm-title').textContent = title;
  $('#confirm-body').textContent = body;
  go.textContent = confirmLabel;
  $('#confirm-cancel').textContent = cancelLabel;

  return new Promise((resolve) => {
    const done = () => {
      dialog.removeEventListener('close', done);
      resolve(dialog.returnValue === 'ok');
    };
    dialog.addEventListener('close', done);
    dialog.returnValue = '';
    dialog.showModal();
    // The cancel button takes the focus, not the delete one: a dialog that
    // destroys something on a stray Enter is not a safeguard.
    $('#confirm-cancel').focus();
  });
}

/**
 * Wires the buttons up once, at boot. Kept here rather than in each caller so
 * that the two dialogs have exactly one set of handlers however many times
 * they are opened.
 */
export function initPrompts() {
  const close = (dialog, value) => () => {
    dialog.close(value);
  };
  const ask = $('#ask-dialog');
  const confirm = $('#confirm-dialog');
  $('#ask-go').addEventListener('click', close(ask, 'ok'));
  $('#ask-cancel').addEventListener('click', close(ask, ''));
  // Enter in the box is Save, which is what every rename box in every program
  // does and what people will try first.
  $('#ask-input').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    ask.close('ok');
  });
  $('#confirm-go').addEventListener('click', close(confirm, 'ok'));
  $('#confirm-cancel').addEventListener('click', close(confirm, ''));
}
