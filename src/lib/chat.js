export async function sendChat(payload, { signal } = {}) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Strip display-only fields before sending history back to the model. */
export function toApiHistory(messages) {
  return (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .filter((m) => m.content.trim().length > 0)
    .map((m) => ({ role: m.role, content: m.content }));
}

export function makeMessage(role, content, extra = {}) {
  return { role, content, at: new Date().toISOString(), ...extra };
}

export function promptSuggestions(outline) {
  if (!outline || outline.length === 0) {
    return [
      'Create a title slide for a deck about our product launch',
      'Add a slide with three key metrics',
    ];
  }
  return [
    'Tighten the spacing and typography on the title slide',
    'Add a closing slide with a call to action',
    'Turn the second slide into a two-column comparison',
    'Check every slide for content that overflows the viewport',
    'Restyle the deck with a paper-like, light theme',
  ];
}