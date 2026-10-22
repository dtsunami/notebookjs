import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { TOOL_DEFINITIONS, executeTool, isMutating } from './tools.js';
import { ensureSlideIds, listSlides, insertSlide } from './doc.js';
import { ensureCellIds } from '../src/lib/cells.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMPT_PATH = path.join(here, '..', 'prompts', 'system.md');

let cachedPrompt = null;

export async function loadSystemPrompt() {
  if (cachedPrompt) return cachedPrompt;
  try {
    cachedPrompt = (await readFile(DEFAULT_PROMPT_PATH, 'utf8')).trim();
  } catch {
    cachedPrompt = 'You edit an HTML slide deck using the provided tools.';
  }
  return cachedPrompt;
}

export function buildMessages({ systemPrompt, history, userMessage, html, styleSettings, focus }) {
  const slides = listSlides(html);
  const outline = slides.length
    ? slides.map((s) => `- ${s.id}: ${s.preview}`).join('\n')
    : '(no slides)';

  /*
   * What the operator is looking at. Without this, "fix this slide" has no
   * referent and the model guesses — usually at slide one. Marked in the
   * outline so it is unambiguous which entry is meant, and stated again in
   * words because a model can miss a marker.
   */
  const focusLines = [];
  if (focus?.slideId) {
    const index = slides.findIndex((s) => s.id === focus.slideId);
    if (index !== -1) {
      focusLines.push(`The operator is viewing slide ${focus.slideId} (slide ${index + 1} of ${slides.length}).`);
    }
  }
  if (focus?.cellId) {
    focusLines.push(`The cell selected in the sidebar is ${focus.cellId}.`);
  }

  const styleBlock = styleSettings
    ? `\n\nCurrent style settings: ${JSON.stringify(styleSettings)}`
    : '';

  const focusBlock = focusLines.length ? `\n\n${focusLines.join('\n')}` : '';

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Deck outline (${slides.length} slides):\n${outline}${styleBlock}${focusBlock}\n\nUse read_slide to inspect a slide before editing it.`,
    },
    { role: 'assistant', content: 'Understood.' },
    ...history,
    { role: 'user', content: userMessage },
  ];
}

export function newDeck() {
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Untitled deck</title>
</head>
<body>
<div id="deck">
<section class="slide" data-slide-id="s1">
  <span class="badge">New deck</span>
  <h1>Untitled</h1>
  <p>Ask the assistant to build your first slide.</p>
</section>
</div>
</body>
</html>`;
  html = ensureSlideIds(html);
  return html;
}

const MAX_STEPS = 22;
const MAX_TOOL_CALLS = 45;
const DEFAULT_MODEL = 'gpt-4o-mini';

async function callModel({ baseURL, apiKey, model, messages, tools, signal }) {
  const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, tools, temperature: 0.4 }),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM ${res.status}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

function errorFrom(res, body) {
  return new Error(`LLM ${res.status}: ${String(body).slice(0, 400)}`);
}

/**
 * Read an SSE body and hand each `data:` payload to `onData`.
 *
 * Kept separate from the accumulating logic so the frame parsing is one small
 * thing that can be reasoned about on its own: OpenAI-compatible servers send
 * `data: {...}` lines, a blank line ends an event, and `data: [DONE]` means
 * stop. Anything else (comments, unknown fields) is ignored rather than
 * treated as an error — proxies inject them.
 */
async function readSse(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line. A chunk can split one in half, so
    // only whole frames are consumed.
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const line of frame.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          onData(JSON.parse(payload));
        } catch {
          // A malformed frame is not worth failing the whole reply over.
        }
      }
    }
  }
}

/**
 * Streaming counterpart to callModel. Returns the same `{choices:[{message}]}`
 * shape so the tool loop does not care which was used, and emits deltas as
 * they arrive.
 *
 * Two things carry the stream that are easy to miss:
 *
 *   - `delta.reasoning_content` (DeepSeek) and `delta.reasoning` (others) are
 *     the model thinking. They are surfaced as they arrive but never appended
 *     to `content` — the conversation must not carry them back to the model.
 *   - `delta.tool_calls` arrives in fragments indexed by position, with the
 *     name sent once and the arguments streamed a few characters at a time.
 *     They are reassembled here before the loop sees them.
 */
async function streamModel({ baseURL, apiKey, model, messages, tools, signal, onEvent }) {
  const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', Authorization: `Bearer ${apiKey}` },
    // `include_usage` is what makes token counts arrive on a streamed reply;
    // without it the final chunk carries no `usage` at all.
    body: JSON.stringify({
      model,
      messages,
      tools,
      temperature: 0.4,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw errorFrom(res, body);
  }

  let content = '';
  let reasoning = '';
  // Usage arrives on one chunk, usually the last, and sometimes not at all —
  // a server that does not support stream_options simply omits it.
  let usage = null;
  /** @type {Array<{id?: string, type?: string, function: {name?: string, arguments?: string}}>} */
  const calls = [];

  await readSse(res, (data) => {
    if (data?.usage) usage = data.usage;
    const delta = data?.choices?.[0]?.delta || {};

    const think = delta.reasoning_content ?? delta.reasoning;
    if (typeof think === 'string' && think) {
      reasoning += think;
      onEvent({ type: 'reasoning', text: think });
    }

    if (typeof delta.content === 'string' && delta.content) {
      // The first content token of this call is the moment an answer begins;
      // the UI folds the reasoning away when it arrives. It fires even when
      // this call produced no reasoning of its own: a turn that thinks, calls
      // tools, then answers on a later call would otherwise leave the thinking
      // pane open until the whole turn ended.
      if (!content) onEvent({ type: 'content-start' });
      content += delta.content;
      onEvent({ type: 'content', text: delta.content });
    }

    for (const tc of delta.tool_calls || []) {
      const at = Number.isInteger(tc.index) ? tc.index : calls.length;
      if (!calls[at]) calls[at] = { type: 'function', function: {}, extra: {} };
      const slot = calls[at];
      if (tc.id) slot.id = tc.id;
      if (tc.type) slot.type = tc.type;
      if (tc.function?.name) slot.function.name = tc.function.name;
      if (typeof tc.function?.arguments === 'string') {
        slot.function.arguments = `${slot.function.arguments || ''}${tc.function.arguments}`;
      }

      /*
       * Keep provider fields we do not understand.
       *
       * Gemini's OpenAI-compatible endpoint attaches a thought_signature to a
       * thinking model's function calls (under `extra_content`) and *requires*
       * it back on the assistant message that replays them. Rebuilding the call
       * from only id/type/name/arguments silently dropped it, and the next
       * request failed with "Function call is missing a thought_signature".
       *
       * Copying unknown keys verbatim rather than naming Gemini's keeps this
       * working for the next provider that tags its tool calls.
       */
      for (const [k, v] of Object.entries(tc)) {
        if (k === 'index' || k === 'id' || k === 'type' || k === 'function') continue;
        if (v != null) slot.extra[k] = v;
      }
      for (const [k, v] of Object.entries(tc.function || {})) {
        if (k === 'name' || k === 'arguments') continue;
        if (v != null) {
          slot.fnExtra = slot.fnExtra || {};
          slot.fnExtra[k] = v;
        }
      }
    }
  });

  // Every tool call needs an id to be answered; some servers omit it on the
  // first fragment when they stream.
  const toolCalls = calls
    .filter(Boolean)
    .map((c, i) => ({
      ...(c.extra || {}),
      id: c.id || `call_${Date.now()}_${i}`,
      type: c.type || 'function',
      function: {
        ...(c.fnExtra || {}),
        name: c.function.name || '',
        arguments: c.function.arguments || '{}',
      },
    }));

  return {
    choices: [
      {
        message: {
          content: content || null,
          reasoning_content: reasoning || undefined,
          tool_calls: toolCalls.length ? toolCalls : undefined,
        },
      },
    ],
    usage: usage || undefined,
  };
}

/**
 * Runs the tool-calling loop.
 * @returns {Promise<{html: string, text: string, steps: number, model: string}>}
 */
export async function runAgent({ html, history, userMessage, systemPrompt, styleSettings, focus, signal, onEvent }) {
  // `onEvent` turns the loop into a stream: the model call switches to SSE and
  // tool activity is reported as it happens. Without it this behaves exactly as
  // before, so the non-streaming endpoint and its callers are untouched.
  const emit = typeof onEvent === 'function' ? onEvent : null;
  const apiKey = process.env.LLM_API_KEY;
  const baseURL = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.LLM_MODEL || DEFAULT_MODEL;

  let doc = ensureCellIds(ensureSlideIds(html));

  if (!apiKey) {
    const content = `<section class="slide" data-slide-id="mock">
  <span class="badge">Offline</span>
  <h2>${userMessage.slice(0, 60)}</h2>
  <p class="muted">Set LLM_API_KEY in .env to enable the real agent. This placeholder confirms the edit path works.</p>
</section>`;
    const r = insertSlide(doc, { content });
    return {
      html: ensureCellIds(ensureSlideIds(r.html || doc)),
      text: 'LLM_API_KEY is not set, so I inserted a placeholder slide instead of calling a model.',
      steps: 0,
      model: '(offline)',
    };
  }

  const messages = buildMessages({ systemPrompt, history, userMessage, html: doc, styleSettings, focus });
  let toolCalls = 0;
  let steps = 0;
  let finalText = '';
  // Accumulated across every model call in the turn, and every tool invoked.
  // A turn is often several calls; reporting only the last one understates it.
  const usageTotal = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const toolsUsed = {};
  const addUsage = (u) => {
    if (!u) return;
    const p = Number(u.prompt_tokens) || 0;
    const c = Number(u.completion_tokens) || 0;
    usageTotal.prompt_tokens += p;
    usageTotal.completion_tokens += c;
    usageTotal.total_tokens += Number(u.total_tokens) || p + c;
  };
  // Thinking is kept for display only. It is never fed back to the model — the
  // conversation history carries answers, not reasoning.
  let finalReasoning = '';

  for (; steps < MAX_STEPS; steps++) {
    if (emit && steps > 0) emit({ type: 'step', step: steps });
    const data = emit
      ? await streamModel({
          baseURL,
          apiKey,
          model,
          messages,
          tools: TOOL_DEFINITIONS,
          signal,
          onEvent: emit,
        })
      : await callModel({ baseURL, apiKey, model, messages, tools: TOOL_DEFINITIONS, signal });
    addUsage(data.usage);
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('Model returned no message.');

    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content) {
      finalReasoning = msg.reasoning_content;
    }

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      finalText = (msg.content || '').trim();
      break;
    }

    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: calls });

    for (const call of calls) {
      toolCalls += 1;
      if (toolCalls > MAX_TOOL_CALLS) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Tool budget exhausted.' });
        continue;
      }

      const name = call.function?.name;
      // Tally only calls that actually run. Counting here, after `name` exists,
      // keeps the header honest and avoids the TDZ that counting before the
      // declaration caused.
      if (name) toolsUsed[name] = (toolsUsed[name] || 0) + 1;
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Arguments were not valid JSON.' });
        continue;
      }

      if (emit) {
        // Name the slide or cell the call touches — "read_slide s3" tells the
        // operator more than "read_slide" while they wait.
        const target = args.slideId || args.id || '';
        emit({ type: 'tool', name, target, args });
      }

      let result;
      try {
        result = await executeTool(name, args, doc);
      } catch (err) {
        result = { text: `Tool "${name}" threw: ${err.message}` };
      }
      if (emit) emit({ type: 'tool-done', name, changed: !!result.html });

      if (result.html && isMutating(name)) {
        // Both normalizers are idempotent. Running them after every mutation
        // means a hand-written <script type="text/nb-cell"> still gets an id
        // and stays addressable by the cell tools.
        doc = ensureCellIds(ensureSlideIds(result.html));
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: result.text || '' });

      if (result.image) {
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Here is the rendered screenshot you requested, followed by the viewport report.' },
            { type: 'image_url', image_url: { url: result.image, detail: 'high' } },
          ],
        });
      }
    }
  }

  if (steps >= MAX_STEPS && !finalText) {
    finalText = `Stopped after ${MAX_STEPS} steps to avoid looping. The deck may be partially updated.`;
  }

  return {
    html: doc,
    text: finalText,
    steps,
    model,
    reasoning: finalReasoning,
    usage: usageTotal.total_tokens ? usageTotal : null,
    tools: toolsUsed,
  };
}