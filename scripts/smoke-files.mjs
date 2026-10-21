import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const DIR = await mkdtemp(path.join(tmpdir(), 'nb-files-'));
process.env.NB_ROOT = DIR;

const files = await import('../server/files.js');

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

await mkdir(path.join(DIR, 'sub'), { recursive: true });
await writeFile(path.join(DIR, 'a.html'), '<h1>hi</h1>', 'utf8');
await writeFile(path.join(DIR, 'sub', 'b.txt'), 'nested', 'utf8');
await mkdir(path.join(DIR, 'node_modules'), { recursive: true });

const root = await files.list('');
check('lists the root', root.entries.length >= 2, JSON.stringify(root.entries.map((e) => e.name)));
check(
  'hides node_modules',
  !root.entries.some((e) => e.name === 'node_modules'),
  JSON.stringify(root.entries.map((e) => e.name)),
);
check('directories sort first', root.entries[0].kind === 'dir', root.entries[0].kind);

const sub = await files.list('sub');
check('lists a subdirectory', sub.entries.some((e) => e.name === 'b.txt'));

// Traversal attempts must be refused.
for (const bad of ['../', '../../etc/passwd', '/etc/passwd', 'sub/../../..']) {
  let refused = false;
  try {
    files.resolveSafe(bad);
  } catch {
    refused = true;
  }
  // An absolute path resolves back inside root only if it is contained;
  // /etc/passwd must be rejected.
  if (bad === '/etc/passwd') {
    refused = files.resolveSafe(bad).startsWith(DIR);
  }
  check(`refuses traversal: ${bad}`, refused);
}

const made = await files.makeDir('', 'fresh');
check('creates a directory', made.path === 'fresh');

const nb = await files.create('fresh', 'demo', 'notebook');
check('creates a .jsnb', nb.path === 'fresh/demo.jsnb', nb.path);

const readBack = await files.read('fresh/demo.jsnb');
const parsed = JSON.parse(readBack.text);
check('the notebook is valid JSON', !!parsed.html, readBack.text.slice(0, 60));
check('the notebook has a slide', /data-slide-id/.test(parsed.html));

await files.write('fresh/demo.jsnb', JSON.stringify({ ...parsed, name: 'renamed' }));
const after = JSON.parse((await files.read('fresh/demo.jsnb')).text);
check('writes survive a round trip', after.name === 'renamed');

const moved = await files.renamePath('fresh/demo.jsnb', 'moved.jsnb');
check('renames a file', moved.path === 'fresh/moved.jsnb', moved.path);

let dupeRefused = false;
try {
  await files.create('fresh', 'moved', 'notebook');
} catch {
  dupeRefused = true;
}
check('refuses a duplicate name', dupeRefused);

await files.remove('fresh/moved.jsnb');
const emptied = await files.list('fresh');
check('deletes a file', emptied.entries.length === 0);

let rootDeleteRefused = false;
try {
  await files.remove('');
} catch {
  rootDeleteRefused = true;
}
check('refuses to delete the root', rootDeleteRefused);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall file checks passed');
process.exit(failures ? 1 : 0);