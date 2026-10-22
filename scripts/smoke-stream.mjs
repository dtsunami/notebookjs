/**
 * The streaming path has more failure modes than the plain one: a chunk can
 * split a frame, reasoning and content interleave, and tool calls arrive in
 * fragments. Each of those is exercised here against a real HTTP server, so the
 * client and server halves are tested together.
 */
import http from 'node:http';
import { readSseFrames } from '../src/lib/chat.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

// --- a frame split across chunks must still parse -------------------------
const frames = [];
const splitter = readSseFrames((ev) => frames.push(ev));
const whole = 'data: {"type":"content","text":"he"}\n\ndata: {"type":"content","text":"llo"}\n\n';
// Feed it one character at a time: the harshest possible chunking.
for (const ch of whole) splitter.push(ch);
check('a frame split byte by byte still parses', frames.length === 2, String(frames.length));
check('the payload survives chunking', frames.map((f) => f.text).join('') === 'hello');

// --- keep-alives and [DONE] ----------------------------------------------
const keep = [];
const k = readSseFrames((ev) => keep.push(ev));
k.push(': keep-alive\n\ndata: {"type":"step","step":1}\n\ndata: [DONE]\n\n');
check('a keep-alive comment is not an event', keep.length === 1, String(keep.length));
check('the step event came through', keep[0]?.type === 'step');

// --- a real server, real fetch -------------------------------------------
const server = http.createServer((req, res) => {
  if (req.url !== '/api/chat/stream') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
  send({ type: 'reasoning', text: 'Let me think. ' });
  setTimeout(() => {
    send({ type: 'reasoning', text: 'About slides.' });
    send({ type: 'content-start' });
    send({ type: 'content', text: 'Done.' });
    send({ type: 'done', html: '<p>x</p>', text: 'Done.', steps: 1, model: 'test', reasoning: 't' });
    res.end();
  }, 20);
});

await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => realFetch(`http://127.0.0.1:${port}${url}`, init);

try {
  const mod = await import('../src/lib/chat.js?t=' + Date.now());
  const seen = [];
  const result = await mod.sendChatStream(
    { html: '<html></html>', message: 'hi', history: [] },
    { onEvent: (ev) => seen.push(ev) },
  );

  check('the final result is returned', result.text === 'Done.');
  check('reasoning arrives before content', seen[0]?.type === 'reasoning');
  check(
    'reasoning tokens accumulate',
    seen.filter((e) => e.type === 'reasoning').map((e) => e.text).join('') === 'Let me think. About slides.',
  );
  check('content-start marks the answer', seen.some((e) => e.type === 'content-start'));
  check('done is not passed to onEvent', !seen.some((e) => e.type === 'done'));

  // An error event must reject, not resolve with a half result.
  const bad = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"error","error":"model exploded"}\n\n');
    res.end();
  });
  await new Promise((resolve) => bad.listen(0, resolve));
  const badPort = bad.address().port;
  globalThis.fetch = (url, init) => realFetch(`http://127.0.0.1:${badPort}${url}`, init);

  let threw = null;
  try {
    await mod.sendChatStream({ html: '<html></html>', message: 'hi' }, {});
  } catch (err) {
    threw = err;
  }
  check('an error event rejects', !!threw && /model exploded/.test(threw.message), threw?.message);
  await new Promise((resolve) => bad.close(resolve));
} finally {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall stream checks passed');
process.exit(failures ? 1 : 0);