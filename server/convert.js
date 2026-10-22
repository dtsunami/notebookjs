/**
 * Rewrite a cell's source into another kernel language.
 *
 * This is a one-shot model call, deliberately not the tool loop in agent.js:
 * a conversion touches one string and either succeeds or does not. It never
 * edits the deck — the caller applies the result — so a bad conversion cannot
 * corrupt anything the operator did not confirm.
 *
 * Two things it refuses to do:
 *
 *   - Guess. The JavaScript `cell` API (querying the slide, event handlers,
 *     animation frames) has no Python or Ruby equivalent. When the source
 *     depends on it, the model is told to return an error explaining why,
 *     rather than emit code that looks right and fails on first run.
 *   - Run offline. agent.js falls back to a placeholder slide when no key is
 *     set; here that would mean replacing real code with a fake. It throws.
 */

const DEFAULT_MODEL = 'gpt-4o-mini';

const CELL_API = `The JavaScript cell API (only available in javascript cells):
- cell.$ / cell.$$ — query within this slide
- cell.setText(selector, text), cell.setHtml(selector, html)
- cell.on(targetOrNull, event, handler)
- cell.raf(fn), cell.every(ms, fn)
- cell.root — the slide element
Output is captured from console.log / print, and a thrown exception or non-zero
exit is reported to the user.`;

const SYSTEM = `You convert one notebook cell between programming languages.

Rules:
- Preserve the program's behaviour exactly. Do not add features, reformat for
  style, or add commentary.
- Python, Ruby and TypeScript cells are plain programs. They cannot touch the
  slide's DOM. TypeScript is stripped, not type-checked.
- Persistent state works the same way in every language: print to produce
  output, and a bare expression's value is shown.
- If the source depends on something the target language cannot express — most
  often the JavaScript cell's DOM helpers — do not invent an equivalent.
  Return ok:false with a one-sentence reason naming what cannot be converted.

${CELL_API}

Reply with JSON only, no prose and no code fences:
{"ok": true, "source": "...converted source...", "notes": "one short sentence"}
or
{"ok": false, "reason": "why this cannot be converted"}`;

function stripFences(text) {
  const t = String(text || '').trim();
  const fence = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return fence ? fence[1] : t;
}

function parseReply(text) {
  const body = stripFences(text);
  try {
    return JSON.parse(body);
  } catch {
    /* fall through */
  }
  // Some models wrap the object in prose. Take the outermost braces.
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

/**
 * @returns {Promise<{ok: true, source: string, notes: string} | {ok: false, error: string}>}
 */
export async function convertSource({ source, from, to, signal }) {
  // Local checks first: a missing key should not mask the fact that there is
  // nothing to convert.
  if (!String(source || '').trim()) {
    return { ok: false, error: 'This cell is empty, so there is nothing to convert.' };
  }
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: 'No LLM_API_KEY is configured, so code cannot be converted. Set it in .env.',
    };
  }

  const baseURL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;

  let res;
  try {
    res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Convert this ${from} cell to ${to}.\n\n${String(source)}`,
          },
        ],
      }),
      signal,
    });
  } catch (err) {
    return { ok: false, error: `Could not reach the model: ${err.message}` };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, error: `LLM ${res.status}: ${body.slice(0, 300)}` };
  }

  const data = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (!text) return { ok: false, error: 'The model returned nothing.' };

  const parsed = parseReply(text);
  if (!parsed) {
    return { ok: false, error: 'The model did not return usable JSON. Nothing was changed.' };
  }
  if (!parsed.ok) {
    return { ok: false, error: parsed.reason || 'This cell cannot be converted.' };
  }
  if (typeof parsed.source !== 'string' || !parsed.source.trim()) {
    return { ok: false, error: 'The model returned an empty conversion. Nothing was changed.' };
  }

  return { ok: true, source: parsed.source, notes: parsed.notes || `Converted ${from} to ${to}.` };
}