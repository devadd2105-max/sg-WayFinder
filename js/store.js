// Settings and best scores, saved in the browser. Storage can be missing or
// blocked, so every call is wrapped and falls back to memory.

const SETTINGS_KEY = 'sgw:settings:v1';
const BEST_KEY = 'sgw:best:v1';

const DEFAULTS = { difficulty: 'standard', rounds: 5, timer: 0, mapsKey: '' };

const memory = new Map();

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch {
    /* fall through to memory */
  }
  return memory.get(key) ?? null;
}

function write(key, value) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* in-memory copy is enough */
  }
}

export function loadSettings() {
  return { ...DEFAULTS, ...(read(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  write(SETTINGS_KEY, next);
  return next;
}

/** Record a finished game. Returns { best, isNew } for that board. */
export function recordScore(boardId, score) {
  const all = read(BEST_KEY) ?? {};
  const prev = all[boardId] ?? 0;
  const isNew = score > prev;
  if (isNew) {
    all[boardId] = score;
    write(BEST_KEY, all);
  }
  return { best: Math.max(prev, score), isNew, previous: prev };
}

export function bestScore(boardId) {
  return (read(BEST_KEY) ?? {})[boardId] ?? 0;
}
