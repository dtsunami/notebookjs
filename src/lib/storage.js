const NS = 'notebookjs';

const KEYS = {
  preferences: `${NS}:preferences`,
  transcript: (deckId) => `${NS}:transcript:${deckId}`,
  autosave: `${NS}:autosave`,
  decks: `${NS}:decks`,
  recent: `${NS}:recent`,
};

export const DEFAULT_PREFERENCES = {
  theme: { preset: 'midnight' },
  systemPrompt: '',
  showEditor: true,
  previewZoom: 1,
  activeDeckId: null,
  activeDeckName: 'Untitled deck',
};

function read(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    if (err && err.name === 'QuotaExceededError') {
      console.warn('localStorage is full; skipping write for', key);
    }
  }
}

export function loadPreferences() {
  return { ...DEFAULT_PREFERENCES, ...read(KEYS.preferences, {}) };
}

export function savePreferences(prefs) {
  write(KEYS.preferences, prefs);
}

export function loadAutosave() {
  return read(KEYS.autosave, null);
}

export function saveAutosave(payload) {
  write(KEYS.autosave, { ...payload, savedAt: new Date().toISOString() });
}

export function clearAutosave() {
  try {
    window.localStorage.removeItem(KEYS.autosave);
  } catch {
    /* ignore */
  }
}

export function loadTranscript(deckId) {
  return read(KEYS.transcript(deckId || 'scratch'), []);
}

export function saveTranscript(deckId, messages) {
  write(KEYS.transcript(deckId || 'scratch'), messages.slice(-120));
}

export function loadLocalDecks() {
  return read(KEYS.decks, []);
}

export function saveLocalDeck(deck) {
  const decks = loadLocalDecks();
  const entry = { ...deck, updatedAt: new Date().toISOString() };
  const next = [entry, ...decks.filter((d) => d.id !== deck.id)].slice(0, 50);
  write(KEYS.decks, next);
  return entry;
}

export function deleteLocalDeck(id) {
  write(
    KEYS.decks,
    loadLocalDecks().filter((d) => d.id !== id),
  );
}

export function pushRecent(deckId) {
  const recent = read(KEYS.recent, []);
  const next = [deckId, ...recent.filter((r) => r !== deckId)].slice(0, 10);
  write(KEYS.recent, next);
}

export function loadRecent() {
  return read(KEYS.recent, []);
}

export function newId(prefix = 'deck') {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}