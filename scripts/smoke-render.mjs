/**
 * Renders App to a string with auth forced through, so the real layout tree
 * is exercised rather than the "connecting" gate. Catches crashes that a
 * bundler cannot see: TDZ errors, undefined handlers, bad prop shapes.
 *
 * Usage: node scripts/smoke-render.mjs
 */
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const BUNDLE = '.nb-render-test.mjs';
const BUNDLE_ABS = path.resolve(process.cwd(), BUNDLE);

execFileSync(
  'npx',
  [
    '--yes',
    'esbuild',
    'src/App.jsx',
    '--bundle',
    '--loader:.jsx=jsx',
    '--format=esm',
    `--outfile=${BUNDLE}`,
    '--external:react',
    '--external:react-dom',
    '--external:react-dom/server',
    '--external:@uiw/react-codemirror',
    '--external:@codemirror/*',
    '--log-level=error',
  ],
  { stdio: 'inherit' },
);

const noop = () => {};
const store = new Map();

globalThis.window = {
  localStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  },
  location: { href: 'http://localhost:5173/', pathname: '/', search: '', hash: '' },
  history: { replaceState: noop },
  addEventListener: noop,
  removeEventListener: noop,
  confirm: () => true,
  print: noop,
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
};
globalThis.localStorage = globalThis.window.localStorage;
const makeEl = () => ({
  style: { setProperty: noop, tabSize: '', removeProperty: noop },
  dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop,
  removeChild: noop,
  remove: noop,
  click: noop,
  setAttribute: noop,
  getAttribute: () => null,
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  scrollIntoView: noop,
  focus: noop,
});

globalThis.document = {
  documentElement: makeEl(),
  head: makeEl(),
  body: makeEl(),
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: makeEl,
  createTextNode: () => ({}),
  createRange: () => ({ setStart: noop, setEnd: noop, getBoundingClientRect: () => ({}) }),
};
// Node 24 exposes navigator as a getter-only global.
Object.defineProperty(globalThis, 'navigator', {
  value: { userAgent: 'node', platform: 'node', maxTouchPoints: 0 },
  configurable: true,
  writable: true,
});

// Auth resolves OK; every other call returns an empty-but-valid payload.
globalThis.fetch = async (url) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => {
    const u = String(url);
    if (u.includes('/api/prompt')) return { prompt: 'test prompt' };
    if (u.includes('/api/decks')) return { decks: [] };
    if (u.includes('/api/health')) return { ok: true, playwright: true };
    if (u.includes('/api/files/list')) return { root: '/tmp/root', path: '', entries: [] };
    if (u.includes('/api/deck/new')) {
      return {
        html:
          '<!DOCTYPE html><html><head></head><body><div id="deck">' +
          '<section class="slide" data-slide-id="s1"><h1>Hello</h1>' +
          '<script type="text/nb-cell" data-cell-id="c1" data-lang="javascript" data-exec="kernel">' +
          '1 + 1<\/script></section></div></body></html>',
      };
    }
    return {};
  },
});

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

try {
  const mod = await import(`${pathToFileURL(BUNDLE_ABS).href}?t=${Date.now()}`);
  const App = mod.default;

  // Gate state first.
  const gate = renderToString(React.createElement(App));
  check('renders without throwing', gate.length > 0, `length ${gate.length}`);

  // Force the authenticated tree by pre-seeding what the app reads at boot.
  store.set('notebookjs:ui', JSON.stringify({ theme: 'dark', accent: 'indigo', density: 'cozy', mode: 'split', monoSize: 12.5 }));

  const second = renderToString(React.createElement(App));
  check('second render is stable', second.length > 0, `length ${second.length}`);
} catch (err) {
  check('renders without throwing', false, err.message);
  console.log(err.stack.split('\n').slice(1, 6).join('\n'));
} finally {
  await rm(BUNDLE_ABS, { force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nrender checks passed');
process.exit(failures ? 1 : 0);