// Tiny DOM helpers and the icon set.

/** h('div', { class: 'x', onclick }, child, 'text', ...) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, value);
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

const STROKE = 'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"';

const PATHS = {
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M12.6 8.5l-2.1 4.6 2.6 2.1 1 5.3M10.5 13.1L8 14.6l-.6 3.6M12.6 8.5l3 2 2.4.5M13.1 15.2l3 1.9.6 3.4"/>',
  rail: '<rect x="5" y="3" width="14" height="14" rx="3.2"/><path d="M5 11h14M9 21l2-4M15 21l-2-4"/><circle cx="9" cy="14.2" r=".9"/><circle cx="15" cy="14.2" r=".9"/>',
  bus: '<rect x="4" y="4" width="16" height="13" rx="2.6"/><path d="M4 11h16M7 20v-3M17 20v-3"/><circle cx="8" cy="14.2" r=".9"/><circle cx="16" cy="14.2" r=".9"/>',
  taxi: '<path d="M5 15l1.6-5a2 2 0 0 1 1.9-1.4h7a2 2 0 0 1 1.9 1.4L19 15"/><rect x="3.5" y="15" width="17" height="4" rx="1.6"/><path d="M10 5.5h4v3.1h-4z"/>',
  flag: '<path d="M6 21V4M6 5h11l-2 3.5 2 3.5H6"/>',
  pin: '<path d="M12 21s-6-5.6-6-10.2a6 6 0 0 1 12 0C18 15.4 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.2"/>',
  undo: '<path d="M9 7L4.5 11.5 9 16M5 11.5h9a5 5 0 0 1 0 9.5h-2.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.5l3.5 2"/>',
  wallet: '<rect x="3.5" y="6.5" width="17" height="12" rx="2.5"/><path d="M3.5 10h17M16 14.5h1.6"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  home: '<path d="M4 11l8-6.5 8 6.5M6.5 9.5V20h11V9.5"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/>',
  key: '<circle cx="8.5" cy="14.5" r="3.5"/><path d="M11 12l8-8M16 7l2.5 2.5M13.5 9.5L16 12"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  back: '<path d="M10 6l-6 6 6 6M4.5 12H20"/>',
};

export function icon(name, size = 20) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${STROKE}>${PATHS[name] ?? ''}</svg>`;
  return span;
}

/** Count a number up in place. Respects reduced motion. */
export function countUp(node, to, ms = 900, format = (n) => String(Math.round(n))) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce || ms <= 0) {
    node.textContent = format(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    const eased = 1 - (1 - k) ** 3;
    node.textContent = format(to * eased);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

let toastTimer;
export function toast(message, { kind = 'info', ms = 3200 } = {}) {
  let node = document.getElementById('toast');
  if (!node) {
    node = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(node);
  }
  node.textContent = message;
  node.dataset.kind = kind;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), ms);
}
