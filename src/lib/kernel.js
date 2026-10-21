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

export function kernelStatus() {
  return request('/api/kernel/status');
}

export function kernelForDeck(status, deckId) {
  return (status?.live || []).find((k) => k.deckId === deckId) || null;
}