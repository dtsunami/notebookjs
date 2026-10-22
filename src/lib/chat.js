/**
 * Stream a chat turn. Calls `onEvent` for every event the server sends and
 * resolves with the final result.
 *
 * `EventSource` cannot be used: it is GET-only and cannot carry the document in
 * a body. So this reads the response stream and parses frames by hand, which
 * is the same protocol either way.
 */
/**
 * A push-based SSE frame parser.
 *
 * Frames arrive in arbitrary chunks: a single `data:` line can be split down
 * the middle by the network. So this buffers text and only emits when a full
 * `\n\n` frame is present. Keep-alive comments and `[DONE]` are handled here
 * rather than by every caller.
 *
 * Exported because the smoke test drives it with pathological chunking, and a
 * parser exercised only through a live server is a parser with untested edges.
 */
export function readSseFrames(onEvent) {
  let buffer = '';
  let stopped = false;

  return {
    /** @param {string} chunk */
    push(chunk) {
      if (stopped) return;
      buffer += chunk;

      let cut;
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);

        for (const line of frame.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // keep-alive
          if (!trimmed.startsWith('data:')) continue;
          const raw = trimmed.slice(5).trim();
          if (!raw) continue;
          if (raw === '[DONE]') {
            stopped = true;
            return;
          }
          try {
            onEvent(JSON.parse(raw));
          } catch {
            // A malformed frame is not worth failing the whole reply over.
          }
        }
      }
    },
  };
}

export async function sendChatStream(payload, { signal, onEvent } = {}) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  if (!res.body) throw new Error('Streaming is not supported by this browser.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let done = null;
  let failure = null;

  const parser = readSseFrames((event) => {
    if (event.type === 'done') done = event;
    else if (event.type === 'error') failure = event.error || 'The assistant failed.';
    else onEvent?.(event);
  });

  for (;;) {
    const { value, done: finished } = await reader.read();
    if (finished) break;
    parser.push(decoder.decode(value, { stream: true }));
  }

  if (failure) throw new Error(failure);
  if (!done) throw new Error('The stream ended before the assistant replied.');
  return done;
}

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

/** Forget the server-side transcript for this deck. */
export async function clearSession(id) {
  if (!id) return;
  await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
}

export function makeMessage(role, content, extra = {}) {
  return { role, content, at: new Date().toISOString(), ...extra };
}

/**
 * Starter prompts, in pools.
 *
 * The point of a suggestion is to show what the assistant is *for*, not to be
 * the one right request. A fixed list teaches the first two by rote and hides
 * the rest; sampling shows a different face of the tool each time.
 *
 * Each entry is a plain sentence because a chip drops straight into the input.
 */
const STARTERS_EMPTY = [
  'Create a title slide for a deck about our product launch',
  'Add a slide with three key metrics',
  'Build a 5-slide deck introducing the team and what we own',
  'Make a one-slide summary of this week\u2019s incidents',
  'Start a deck: title, agenda, three sections, closing',
  'Create an opening slide with a headline and one supporting line',
  'Build a short deck explaining how our authentication works',
  'Make a roadmap slide: last quarter, this quarter, next',
  'Create a deck skeleton I can fill in — no invented content',
  'Add a comparison slide: us versus the alternative',
];

const STARTERS_DECK = [
  'Tighten the spacing and typography on the title slide',
  'Add a closing slide with a call to action',
  'Turn the second slide into a two-column comparison',
  'Check every slide for content that overflows the viewport',
  'Restyle the deck with a paper-like, light theme',
  'Cut every slide to its single clearest sentence',
  'Make the headings consistent across all slides',
  'Add a slide of runnable examples after the theory',
  'Rewrite the awkward slide in plain language, shorter',
  'Give every slide one visual anchor and less text',
  'Add a Python cell that prints a table of sample data',
  'Turn the bullet list on slide two into three cards',
  'Screenshot each slide and fix whatever looks crowded',
  'Make the deck readable on a projector from the back of the room',
  'Add a slide that answers: what problem does this solve?',
  'Reorder so the conclusion comes before the detail',
];

/**
 * Fisher-Yates over a copy. Math.random is fine here: these are suggestions,
 * not security decisions, and a deterministic shuffle would defeat the purpose.
 */
function sample(pool, count) {
  const out = pool.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, Math.min(count, out.length));
}

/**
 * A fresh sample each call. Callers sample once per mount, not per render —
 * otherwise the chips would reshuffle under the pointer.
 *
 * @param {Array} outline        current slides, to pick the right pool
 * @param {number} [count=4]     how many to return
 */
export function promptSuggestions(outline, count = 4) {
  return sample(outline && outline.length > 0 ? STARTERS_DECK : STARTERS_EMPTY, count);
}