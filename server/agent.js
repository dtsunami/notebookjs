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

export function buildMessages({ systemPrompt, history, userMessage, html, styleSettings }) {
  const slides = listSlides(html);
  const outline = slides.length
    ? slides.map((s) => `- ${s.id}: ${s.preview}`).join('\n')
    : '(no slides)';

  const styleBlock = styleSettings
    ? `\n\nCurrent style settings: ${JSON.stringify(styleSettings)}`
    : '';

  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Deck outline (${slides.length} slides):\n${outline}${styleBlock}\n\nUse read_slide to inspect a slide before editing it.`,
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

/**
 * Runs the tool-calling loop.
 * @returns {Promise<{html: string, text: string, steps: number, model: string}>}
 */
export async function runAgent({ html, history, userMessage, systemPrompt, styleSettings, signal }) {
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

  const messages = buildMessages({ systemPrompt, history, userMessage, html: doc, styleSettings });
  let toolCalls = 0;
  let steps = 0;
  let finalText = '';

  for (; steps < MAX_STEPS; steps++) {
    const data = await callModel({ baseURL, apiKey, model, messages, tools: TOOL_DEFINITIONS, signal });
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) throw new Error('Model returned no message.');

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
      let args = {};
      try {
        args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Arguments were not valid JSON.' });
        continue;
      }

      let result;
      try {
        result = await executeTool(name, args, doc);
      } catch (err) {
        result = { text: `Tool "${name}" threw: ${err.message}` };
      }

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

  return { html: doc, text: finalText, steps, model };
}