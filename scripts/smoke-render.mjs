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

const BUNDLE = '.nb-panels-test.mjs';
const BUNDLE_ABS = path.resolve(process.cwd(), BUNDLE);

execFileSync(
  'npx',
  [
    '--yes',
    'esbuild',
    'scripts/render-entry.jsx',
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
  const App = mod.App;

  // Gate state first.
  const gate = renderToString(React.createElement(App));
  check('renders without throwing', gate.length > 0, `length ${gate.length}`);

  /**
   * App itself cannot render past the gate here: `resolveAuth` is async and
   * `renderToString` is not, so this only ever sees the `connecting` branch.
   * That is exactly how a blank authenticated screen shipped with a green
   * suite — a free variable in NavPane threw on first real render.
   *
   * So render the authenticated components directly, with the props App really
   * passes. A prop App forgets then shows up here as a crash, not a blank page.
   */
  const deckHtml =
    '<!DOCTYPE html><html><head></head><body><div id="deck">' +
    '<section class="slide" data-slide-id="s1"><h1>Hello</h1>' +
    '<div class="nb-cell" data-cell-id="c1" data-cell-x="4" data-cell-y="4" data-cell-w="92" data-cell-h="12">' +
    '<script type="text/nb-cell" data-cell-id="c1" data-lang="javascript" data-exec="kernel">1 + 1<\/script>' +
    '</div></section></div></body></html>';

  const blocks = [
    { index: 0, id: 's1', title: 'Hello', cells: [{ id: 'c1', lang: 'javascript', source: '1 + 1' }] },
  ];

  const history = [
    { html: deckHtml, label: 'open', at: 1 },
    { html: deckHtml.replace('1 + 1', '2 + 2'), label: 'edit cell', at: 2, active: true },
  ];

  const panels = await import(`${pathToFileURL(path.resolve(process.cwd(), '.nb-panels-test.mjs')).href}?t=${Date.now()}`);

  const cases = [
    ['NavPane (expanded)', panels.NavPane, {
      decks: [], blockId: null, blocks, orphans: [], currentIndex: 0,
      historyEntries: history, historyVersion: 1, renderedHtml: deckHtml,
      onRestoreCell: noop, onRestoreSlide: noop, expanded: true, onToggle: noop,
    }],
    ['VersionsPanel (cells)', panels.VersionsPanel, {
      html: deckHtml, entries: history, blocks, onRestoreCell: noop, onRestoreSlide: noop,
    }],
    ['VersionsPanel (empty)', panels.VersionsPanel, { html: deckHtml, entries: [], blocks: [] }],
    ['Timeline', panels.Timeline, {
      html: deckHtml,
      slides: [{ id: 's1', title: 'Hello' }],
      currentIndex: 0, onSelect: noop, onReorder: noop, onNewSlide: noop, onCollapse: noop,
    }],
    ['ConvertDialog (closed)', panels.ConvertDialog, {
      request: null, busy: false, result: null, error: '',
      onConvert: noop, onKeep: noop, onApply: noop, onCancel: noop,
    }],
    ['ConvertDialog (review)', panels.ConvertDialog, {
      request: { id: 'c1', from: 'javascript', to: 'python', source: '1 + 1' },
      busy: false, result: { ok: true, source: 'print(2)', notes: 'Converted.' }, error: '',
      onConvert: noop, onKeep: noop, onApply: noop, onCancel: noop,
    }],
    ['SettingsDrawer (kernel tab)', panels.SettingsDrawer, {
      open: true, tab: 'kernel', onTab: noop, onClose: noop,
      ui: {}, onUiChange: noop, theme: { preset: 'midnight' }, onThemeChange: noop,
      promptOverride: '', builtinPrompt: '', onPromptChange: noop,
      kernel: null, onRestartKernel: noop,
      languages: { binDir: '/tmp/bin', languages: [{ id: 'bash', label: 'Bash', ok: true, cmd: 'bash' }] },
      languagesError: '', onRefreshLanguages: noop, onOpenInstallDeck: noop,
      playwright: true, serverRoot: '/tmp', onExportHtml: noop, onExportJson: noop,
      onExportPng: noop, onPrint: noop,
    }],
    /* The failing run is the case that matters: it is the state that renders
       the "Fix with agent" action, and the one an operator hits when something
       is already wrong. */
    ['CellOutputDock (failed run)', panels.CellOutputDock, {
      open: true, pinned: false, onToggle: noop, onPinToggle: noop, onClear: noop,
      onSendToAgent: noop, agentBusy: false,
      runs: [{ cellId: 'c1', seq: 1, at: Date.now() }],
      outputs: { c1: { error: 'NameError: x is not defined', entries: [] } },
      running: {}, timeout: 4500, runKey: 1,
    }],
    ['CellOutputDock (clean run)', panels.CellOutputDock, {
      open: true, pinned: false, onToggle: noop, onPinToggle: noop, onClear: noop,
      onSendToAgent: noop, agentBusy: false,
      runs: [{ cellId: 'c1', seq: 2, at: Date.now() }],
      outputs: { c1: { ms: 12, entries: [{ level: 'log', text: 'hello' }] } },
      running: {}, timeout: 4500, runKey: 2,
    }],
    /* The nav cell controls: run/stop/delete must render for a running cell
       too, since that is when Stop has to be reachable. */
    ['StructureTree (cells)', panels.StructureTree, {
      blocks: [{
        id: 's1', index: 0, title: 'Slide one',
        cells: [
          { id: 'c1', exec: 'kernel', source: 'print(1)' },
          { id: 'c2', exec: 'inline', source: '' },
        ],
      }],
      orphans: [], currentIndex: 0, selectedCellId: 'c1',
      running: { c2: true },
      onSelectSlide: noop, onSelectCell: noop, onAddCell: noop,
      onRunCell: noop, onInterruptCell: noop, onDeleteCell: noop,
    }],
  ];

  /* Some cases have to assert on content, not just on "it did not throw".
     A control that quietly stops rendering still produces a long string and
     would sail past a length check. */
  const CONTAINS = {
    'CellOutputDock (failed run)': ['Fix with agent', 'NameError'],
    'CellOutputDock (clean run)': ['Ask agent', 'hello'],
    'StructureTree (cells)': ['Run c1', 'Delete c1', 'Stop c2'],
  };

  for (const [label, Component, props] of cases) {
    try {
      const out = renderToString(React.createElement(Component, props));
      // A component may legitimately render nothing — a closed dialog, an
      // empty panel. What matters is that it did not throw.
      const emptyOk = /closed|empty/.test(label);
      check(`${label} renders`, emptyOk || out.length > 0, `length ${out.length}`);

      for (const needle of CONTAINS[label] || []) {
        check(`${label} shows "${needle}"`, out.includes(needle), 'missing');
      }
    } catch (err) {
      check(`${label} renders`, false, err.message);
    }
  }
} catch (err) {
  check('renders without throwing', false, err.message);
  console.log(err.stack.split('\n').slice(1, 6).join('\n'));
} finally {
  await rm(BUNDLE_ABS, { force: true });
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nrender checks passed');
process.exit(failures ? 1 : 0);