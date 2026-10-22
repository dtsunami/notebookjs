async function request(pathname, options = {}) {
  const res = await fetch(pathname, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function execCell({ deckId, lang = 'javascript', code }) {
  return request('/api/kernel/exec', {
    method: 'POST',
    body: JSON.stringify({ deckId, lang, code }),
  });
}

export function restartKernel({ deckId, lang = 'javascript' }) {
  return request('/api/kernel/restart', {
    method: 'POST',
    body: JSON.stringify({ deckId, lang }),
  });
}

export function interruptKernel({ deckId, lang = 'javascript' }) {
  return request('/api/kernel/interrupt', {
    method: 'POST',
    body: JSON.stringify({ deckId, lang }),
  });
}

export function kernelStatus() {
  return request('/api/kernel/status');
}

/** Which interpreters resolve on this machine, and where installed ones go. */
export function kernelLanguages() {
  return request('/api/kernel/languages');
}

export function fetchInstallDeck() {
  return request('/api/deck/install');
}

/**
 * Ask the assistant to rewrite one cell's source in another language. Returns
 * `{ok, source, notes}` or `{ok: false, error}`. Never edits the deck.
 */
export function convertCell({ source, from, to }) {
  return request('/api/convert', {
    method: 'POST',
    body: JSON.stringify({ source, from, to }),
  });
}

export function kernelForDeck(status, deckId) {
  return (status?.live || []).find((k) => k.deckId === deckId) || null;
}