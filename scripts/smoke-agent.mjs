/**
 * Drives the agent loop against a fake OpenAI-compatible server.
 *
 * The loop has failure modes a compile check cannot see: a variable used before
 * its declaration (a TDZ that throws on every real turn but not on the offline
 * path), tool calls streamed in fragments, and usage that only arrives on one
 * chunk. Each is reproduced here.
 */
import http from 'node:http';
import { runAgent } from '../server/agent.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const DECK = `<!DOCTYPE html><html><head></head><body><div id="deck">
<section class="slide" data-slide-id="s1"><h1>One</h1></section>
</div></body></html>`;

/**
 * A model that calls `list_slides` once, then answers. `mode` picks plain JSON
 * or SSE, so both call paths through the loop are covered.
 */
function fakeModel({ mode, signature = false, seen = [] }) {
  let turn = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      turn += 1;
      const first = turn === 1;
      // Record what the loop sent back, so the replay of a tool call can be
      // inspected — that is where a dropped provider field shows up.
      try { seen.push(JSON.parse(body)); } catch { /* ignore */ }

      const call = {
        id: 'call_1',
        type: 'function',
        function: { name: 'list_slides', arguments: '{}' },
        // Gemini's OpenAI-compat layer tags a thinking model's function calls
        // and rejects the next request if the tag does not come back.
        ...(signature ? { extra_content: { google: { thought_signature: 'sig-abc' } } } : {}),
      };

      if (mode === 'json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: first
                  ? { role: 'assistant', content: null, tool_calls: [call] }
                  : { role: 'assistant', content: 'Done.' },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
          }),
        );
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

      if (first) {
        send({ choices: [{ delta: { reasoning_content: 'I should look. ' } }] });
        // Tool name in one chunk, arguments in another: the reassembly path.
        send({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'list_slides' }, ...(signature ? { extra_content: { google: { thought_signature: 'sig-abc' } } } : {}) }] } }] });
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] });
        send({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } });
      } else {
        send({ choices: [{ delta: { content: 'Done.' } }] });
        send({ choices: [{ delta: {} }], usage: { prompt_tokens: 150, completion_tokens: 10, total_tokens: 160 } });
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return server;
}

async function turn(opts) {
  const seen = opts.seen || [];
  const server = fakeModel({ ...opts, seen });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();

  const saved = {
    key: process.env.LLM_API_KEY,
    base: process.env.LLM_BASE_URL,
    model: process.env.LLM_MODEL,
  };
  process.env.LLM_API_KEY = 'sk-test';
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_MODEL = 'fake';

  try {
    const events = [];
    const result = await runAgent({
      html: DECK,
      history: [],
      userMessage: 'list the slides',
      systemPrompt: 'You edit slides.',
      ...(opts.mode === 'sse' ? { onEvent: (e) => events.push(e) } : {}),
    });
    return { result, events, seen };
  } finally {
    if (saved.key === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = saved.base;
    if (saved.model === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = saved.model;
    await new Promise((r) => server.close(r));
  }
}

// --- focus: what the operator is looking at reaches the model -------------
{
  // buildMessages is exported and pure, so the focus block is checked directly
  // rather than inferred from a model's behaviour.
  const { buildMessages } = await import('../server/agent.js');
  const withFocus = buildMessages({
    systemPrompt: 'sys',
    history: [],
    userMessage: 'fix this',
    html: DECK,
    focus: { slideId: 's1', cellId: 'c9' },
  });
  const brief = withFocus[1].content;
  check('the viewed slide is named to the model', /viewing slide s1/.test(brief), brief);
  check('the selected cell is named', /selected in the sidebar is c9/.test(brief), brief);

  const noFocus = buildMessages({
    systemPrompt: 'sys',
    history: [],
    userMessage: 'hi',
    html: DECK,
  });
  check('no focus means no focus block', !/viewing slide/.test(noFocus[1].content));

  const stale = buildMessages({
    systemPrompt: 'sys',
    history: [],
    userMessage: 'hi',
    html: DECK,
    focus: { slideId: 'gone', cellId: null },
  });
  check(
    'a stale slide id is not asserted',
    !/viewing slide gone/.test(stale[1].content),
    stale[1].content,
  );
}

// --- plain JSON: the tool loop runs ---------------------------------------
{
  const { result } = await turn({ mode: 'json' });
  check('a tool-calling turn completes', result.text === 'Done.', result.text);
  check('the tool loop reports steps', result.steps >= 1, String(result.steps));
  check('tools are tallied', result.tools?.list_slides === 1, JSON.stringify(result.tools));
  check('usage is summed', result.usage?.total_tokens === 240, JSON.stringify(result.usage));
  check(
    'prompt and completion are split',
    result.usage?.prompt_tokens === 200 && result.usage?.completion_tokens === 40,
    JSON.stringify(result.usage),
  );
}

// --- SSE: reasoning, fragmented tool calls, usage on a late chunk ---------
{
  const { result, events } = await turn({ mode: 'sse' });
  check('a streamed turn completes', result.text === 'Done.', result.text);
  check('reasoning is captured', /I should look/.test(result.reasoning || ''), result.reasoning);
  check('reasoning is streamed live', events.some((e) => e.type === 'reasoning'));
  check('content-start is emitted', events.some((e) => e.type === 'content-start'));
  check('tool activity is streamed', events.some((e) => e.type === 'tool' && e.name === 'list_slides'));
  check('a fragmented tool call is reassembled', result.tools?.list_slides === 1, JSON.stringify(result.tools));
  check('streamed usage is summed', result.usage?.total_tokens === 280, JSON.stringify(result.usage));
}

/* --- provider-specific tool-call fields survive the round-trip ------------
 *
 * Gemini's OpenAI-compatible endpoint attaches a thought_signature to a
 * thinking model's function calls and *requires* it back on the assistant
 * message that replays them. The streaming reassembly used to rebuild each
 * call from id/type/name/arguments only, dropping it, and the second request
 * of every tool-calling turn failed with:
 *
 *   "Function call is missing a thought_signature in functionCall parts"
 *
 * The replayed assistant message is inspected directly, because the failure is
 * invisible in the result: the turn only breaks on the *next* request.
 */
{
  const sigOf = (reqs) => {
    for (const req of reqs) {
      for (const m of req.messages || []) {
        if (m.role !== 'assistant' || !m.tool_calls) continue;
        for (const c of m.tool_calls) {
          if (c.extra_content) return c.extra_content?.google?.thought_signature;
        }
      }
    }
    return null;
  };

  const { seen: sseSeen, result: sseResult } = await turn({ mode: 'sse', signature: true });
  check(
    'a streamed thought_signature is replayed to the model',
    sigOf(sseSeen) === 'sig-abc',
    JSON.stringify(sigOf(sseSeen)),
  );
  check('the signed turn still completes', sseResult.text === 'Done.', sseResult.text);

  const { seen: jsonSeen } = await turn({ mode: 'json', signature: true });
  check(
    'a non-streamed thought_signature is replayed too',
    sigOf(jsonSeen) === 'sig-abc',
    JSON.stringify(sigOf(jsonSeen)),
  );
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall agent checks passed');
process.exit(failures ? 1 : 0);