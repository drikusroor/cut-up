// Small DOM helpers. Not a framework — just the four things we do repeatedly.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/**
 * Creates an element.
 * @param {string} tag
 * @param {object} [props] attributes; `class`, `text` and `html` are special
 * @param {Array<Node|string>} [children]
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

/** Fills a <select> from `{value, label}` entries. */
export function fillSelect(select, options, selected) {
  select.replaceChildren(
    ...options.map((o) => el('option', { value: o.value, selected: String(o.value) === String(selected) }, [o.label])),
  );
}

let toastTimer = null;
export function toast(message) {
  const existing = $('.toast');
  if (existing) existing.remove();
  const node = el('div', { class: 'toast', role: 'status' }, [message]);
  document.body.append(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 1800);
}

export async function copyText(text, label = 'Copied') {
  if (!text) return toast('Nothing to copy');
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    // Clipboard API needs a secure context; fall back to a manual selection.
    const area = el('textarea', { style: 'position:fixed;opacity:0' }, [text]);
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast(label);
  }
  return undefined;
}

export function download(filename, data, mime = 'text/plain') {
  const blob = data instanceof Uint8Array ? new Blob([data], { type: mime }) : new Blob([data], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Binds a range input to its <output> readout. */
export function bindSlider(input, output, format = (v) => Number(v).toFixed(2)) {
  const update = () => { output.textContent = format(input.value); };
  input.addEventListener('input', update);
  update();
}
