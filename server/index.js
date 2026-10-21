import { DATA_DIR } from './paths.js'; // loads .env; must stay the first import
import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runAgent, loadSystemPrompt, newDeck } from './agent.js';
import * as store from './store.js';
import { shutdown, isAvailable, screenshot } from './browser.js';
import { applyTheme, stripTheme } from '../src/lib/theme.js';
import { injectRuntime, stripRuntime } from '../src/lib/runtime.js';
import * as kernel from './kernel/index.js';
import * as files from './files.js';
import {
  resolveToken,
  requireAuth,
  extractToken,
  setAuthCookie,
  tokenMatches,
  noteFailure,
  noteSuccess,
  isThrottled,
} from './auth.js';

const app = express();

// Same-origin by default. Token auth plus a wildcard CORS policy would let any
// site drive /api/kernel/exec with the user's cookie.
if (process.env.NB_CORS === '*') {
  app.use(cors({ origin: true, credentials: true }));
}

app.use(express.json({ limit: '8mb' }));

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

const TOKEN = await resolveToken();

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/health' || req.path === '/api/auth') return next();
  const token = await resolveToken();
  return requireAuth(token)(req, res, next);
});

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, authRequired: true, playwright: await isAvailable() });
});

// Handshake endpoint. The UI exchanges a token for a cookie here, then works
// entirely with same-origin requests.
app.get('/api/auth', async (req, res) => {
  const token = await resolveToken();
  const candidate = extractToken(req);
  if (!tokenMatches(candidate, token)) {
    noteFailure(req);
    if (isThrottled(req)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes.' });
    return res.status(401).json({ error: 'Invalid token.' });
  }
  noteSuccess(req);
  setAuthCookie(res, token);
  res.json({ ok: true });
});

app.get('/api/prompt', async (req, res) => {
  res.json({ prompt: await loadSystemPrompt() });
});

app.get('/api/deck/new', (req, res) => {
  res.json({ html: newDeck() });
});

app.get('/api/decks', async (req, res) => {
  res.json({ decks: await store.listDecks() });
});

app.get('/api/decks/:id', async (req, res) => {
  const deck = await store.readDeck(req.params.id);
  if (!deck) return res.status(404).json({ error: 'Deck not found.' });
  res.json(deck);
});

app.post('/api/decks/:id', async (req, res) => {
  try {
    const { name, html, styleSettings, messages } = req.body || {};
    if (typeof html !== 'string') return res.status(400).json({ error: 'html is required.' });
    const saved = await store.writeDeck(req.params.id, { name, html, styleSettings, messages });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/decks/:id', async (req, res) => {
  try {
    await store.deleteDeck(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/sessions/:id', async (req, res) => {
  try {
    const { messages } = req.body || {};
    await store.writeSession(req.params.id, messages || []);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/sessions/:id', async (req, res) => {
  const session = await store.readSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json(session);
});

app.post('/api/chat', async (req, res) => {
  const { html, history, message, systemPrompt, styleSettings, sessionId } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  if (typeof html !== 'string') {
    return res.status(400).json({ error: 'html is required.' });
  }

  try {
    const prompt = systemPrompt && systemPrompt.trim() ? systemPrompt : await loadSystemPrompt();
    // The client keeps the document theme-free so the editor stays readable.
    // Apply the theme here so screenshots and DOM inspection see real styling,
    // then strip it again before the document goes back to the client.
    const themed = injectRuntime(applyTheme(html, styleSettings));
    const result = await runAgent({
      html: themed,
      history: Array.isArray(history) ? history : [],
      userMessage: message,
      systemPrompt: prompt,
      styleSettings,
    });
    result.html = stripTheme(stripRuntime(result.html));

    if (sessionId && store.isSafeId(sessionId)) {
      const transcript = [
        ...(Array.isArray(history) ? history : []),
        { role: 'user', content: message },
        { role: 'assistant', content: result.text },
      ];
      await store.writeSession(sessionId, transcript).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    console.error('agent error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/screenshot', async (req, res) => {
  const { html, styleSettings, slideId } = req.body || {};
  if (typeof html !== 'string') return res.status(400).json({ error: 'html is required.' });
  try {
    const shot = await screenshot(injectRuntime(applyTheme(html, styleSettings)), slideId);
    res.json({ image: shot.dataUrl });
  } catch (err) {
    const missing = /Playwright is not available/.test(String(err.message));
    res.status(missing ? 503 : 500).json({ error: err.message });
  }
});

app.get('/api/files/list', async (req, res) => {
  try {
    const data = await files.list(req.query.path || '', {
      showHidden: req.query.hidden === '1',
    });
    res.json(data);
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 500).json({ error: err.message });
  }
});

app.get('/api/files/read', async (req, res) => {
  try {
    res.json(await files.read(req.query.path || ''));
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 404).json({ error: err.message });
  }
});

app.post('/api/files/write', async (req, res) => {
  try {
    const { path: p, content } = req.body || {};
    res.json(await files.write(p, content));
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 500).json({ error: err.message });
  }
});

app.post('/api/files/mkdir', async (req, res) => {
  try {
    const { path: p, name } = req.body || {};
    res.json(await files.makeDir(p || '', name));
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 500).json({ error: err.message });
  }
});

app.post('/api/files/create', async (req, res) => {
  try {
    const { path: p, name, kind } = req.body || {};
    res.json(await files.create(p || '', name, kind || 'notebook'));
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 500).json({ error: err.message });
  }
});

app.post('/api/files/rename', async (req, res) => {
  try {
    const { path: p, name } = req.body || {};
    res.json(await files.renamePath(p, name));
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 500).json({ error: err.message });
  }
});

app.delete('/api/files', async (req, res) => {
  try {
    res.json(await files.remove(req.query.path || ''));
  } catch (err) {
    res.status(err instanceof files.PathError ? 400 : 500).json({ error: err.message });
  }
});

app.get('/api/kernel/status', (req, res) => {
  res.json({ supported: kernel.SUPPORTED, live: kernel.status() });
});

app.post('/api/kernel/exec', async (req, res) => {
  const { deckId, lang, code } = req.body || {};
  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'code is required.' });
  }

  try {
    const result = await kernel.exec({ deckId, lang: lang || 'javascript', code });
    res.json(result);
  } catch (err) {
    const unsupported = /No runtime for/.test(err.message);
    res.status(unsupported ? 400 : 500).json({ error: err.message });
  }
});

app.post('/api/kernel/restart', async (req, res) => {
  const { deckId, lang } = req.body || {};
  try {
    await kernel.restart({ deckId, lang: lang || 'javascript' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve the built frontend when it exists, so `notebookjs` runs without Vite.
const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(DIST, 'index.html')));
}

// Resolves once the port is bound, so the CLI can print and open a browser in
// the right order instead of racing the listen callback.
let markReady;
export const ready = new Promise((resolve) => {
  markReady = resolve;
});

const server = app.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  const base = `http://${shown}:${PORT}`;
  const revealed = process.env.NB_TOKEN ? '(from NB_TOKEN)' : `token=${TOKEN}`;
  console.log(`notebookjs API on ${base}`);
  console.log(`bound to ${HOST}:${PORT}`);
  console.log(`data: ${DATA_DIR}`);
  console.log(`auth: ${revealed}`);
  if (!process.env.NB_CLI) {
    console.log(`\n  Open the UI and sign in:\n  ${base}/?token=${TOKEN}\n`);
  }
  markReady();
});

async function stop() {
  server.close();
  await kernel.killAll();
  await shutdown();
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);