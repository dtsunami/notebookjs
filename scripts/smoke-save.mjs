/**
 * End-to-end check of the save path against a live server:
 * create a .jsnb, write content, read it back, rename, confirm the tree.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const PORT = 3800 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = `save-${Math.random().toString(36).slice(2)}`;
const ROOT = await mkdtemp(path.join(tmpdir(), 'nb-save-'));
// Data dir is separate from the file root, so store.ensureDirs() cannot write
// into the tree this test is asserting on.
const DATA = await mkdtemp(path.join(tmpdir(), 'nb-save-data-'));

const proc = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', NB_TOKEN: TOKEN, NB_ROOT: ROOT, DATA_DIR: DATA },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const api = (p, opts = {}) => fetch(`${BASE}${p}`, { headers: auth, ...opts });

async function ready() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true;
    } catch {
      /* waiting */
    }
    await sleep(150);
  }
  return false;
}

try {
  check('server boots', await ready());

  const empty = await (await api('/api/files/list?path=')).json();
  check('tree starts empty', empty.entries.length === 0, JSON.stringify(empty.entries));
  check('root is the launch dir', empty.root === ROOT, empty.root);

  const created = await (
    await api('/api/files/create', {
      method: 'POST',
      body: JSON.stringify({ path: '', name: 'My Talk', kind: 'notebook' }),
    })
  ).json();
  check('creates My Talk.jsnb', created.path === 'My Talk.jsnb', JSON.stringify(created));

  const DOC = {
    version: 1,
    name: 'My Talk',
    html: '<!DOCTYPE html><html><head></head><body><div id="deck"><section class="slide" data-slide-id="s1"><h1>Hi</h1></section></div></body></html>',
    styleSettings: { preset: 'midnight' },
    messages: [],
  };

  const wrote = await (
    await api('/api/files/write', {
      method: 'POST',
      body: JSON.stringify({ path: created.path, content: JSON.stringify(DOC, null, 2) }),
    })
  ).json();
  check('writes the document', wrote.size > 0, JSON.stringify(wrote));

  const readBack = await (
    await api(`/api/files/read?path=${encodeURIComponent(created.path)}`)
  ).json();
  const parsed = JSON.parse(readBack.text);
  check('reads back identical html', parsed.html === DOC.html);
  check('reads back the name', parsed.name === 'My Talk');

  const listed = await (await api('/api/files/list?path=')).json();
  check('file appears in the tree', listed.entries.some((e) => e.name === 'My Talk.jsnb'));
  check(
    'it is typed as a notebook',
    listed.entries.find((e) => e.name === 'My Talk.jsnb')?.kind === 'notebook',
  );

  const renamed = await (
    await api('/api/files/rename', {
      method: 'POST',
      body: JSON.stringify({ path: created.path, name: 'Renamed Talk.jsnb' }),
    })
  ).json();
  check('renames the file', renamed.path === 'Renamed Talk.jsnb', JSON.stringify(renamed));

  const afterRename = await (await api('/api/files/list?path=')).json();
  check('old name is gone', !afterRename.entries.some((e) => e.name === 'My Talk.jsnb'));
  check('new name is present', afterRename.entries.some((e) => e.name === 'Renamed Talk.jsnb'));

  const stillThere = JSON.parse(
    (await (await api('/api/files/read?path=Renamed%20Talk.jsnb')).json()).text,
  );
  check('content survives the rename', stillThere.html === DOC.html);

  const second = await (
    await api('/api/files/write', {
      method: 'POST',
      body: JSON.stringify({
        path: 'Renamed Talk.jsnb',
        content: JSON.stringify({ ...DOC, name: 'Renamed Talk' }, null, 2),
      }),
    })
  ).json();
  check('re-saving overwrites', second.size > 0, JSON.stringify(second));

  const dupe = await api('/api/files/create', {
    method: 'POST',
    body: JSON.stringify({ path: '', name: 'Renamed Talk', kind: 'notebook' }),
  });
  check('duplicate create is refused', dupe.status === 400, String(dupe.status));
} finally {
  proc.kill('SIGKILL');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall save checks passed');
process.exit(failures ? 1 : 0);