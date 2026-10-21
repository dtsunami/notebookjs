import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

function run(args, env) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, ['bin/notebookjs.js', ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (out += c));
    proc.on('close', (code) => resolve({ code, out }));
  });
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));

const version = await run(['--version']);
check('--version prints the package version', version.code === 0 && version.out.trim() === pkg.version, version.out.trim());

const help = await run(['--help']);
check('--help prints usage', help.code === 0 && /Usage/.test(help.out));

const unknown = await run(['bogus']);
check('unknown command exits non-zero', unknown.code === 1 && /Unknown command/.test(unknown.out));

const DATA_DIR = await mkdtemp(path.join(tmpdir(), 'nb-cli-'));

const empty = await run(['list'], { DATA_DIR });
check('list on an empty data dir says so', empty.code === 0 && /No decks yet/.test(empty.out));

const created = await run(['new', 'Smoke deck'], { DATA_DIR });
check('new creates a deck', created.code === 0 && /Created/.test(created.out), created.out.trim());

const listed = await run(['list'], { DATA_DIR });
check('list shows the new deck', listed.code === 0 && /smoke-deck/.test(listed.out), listed.out.trim());

const again = await run(['new', 'Smoke deck'], { DATA_DIR });
check('new refuses to overwrite', again.code === 1);

const token = await run(['--print-token'], { DATA_DIR });
check('--print-token prints a token without serving', token.code === 0 && token.out.trim().length > 10, token.out.trim());

const PORT = 3980 + Math.floor(Math.random() * 19);
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ['bin/notebookjs.js', 'serve', '--no-open', '--port', String(PORT)], {
  env: { ...process.env, DATA_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot = '';
server.stdout.on('data', (c) => (boot += c));
server.stderr.on('data', (c) => (boot += c));

for (let i = 0; i < 40 && !/Open the UI/.test(boot); i += 1) await sleep(100);

check('serve prints the API banner', /notebookjs API on/.test(boot), boot.trim());
check('serve prints the sign-in URL after binding', boot.indexOf('Open the UI') > boot.indexOf('auth: '));

const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => null);
check('serve answers /api/health', health?.ok === true);

server.kill('SIGTERM');
await sleep(300);

// Config and data are separate directories: the token belongs to the machine,
// decks belong to whatever directory you launched from.
const PROJECT = await mkdtemp(path.join(tmpdir(), 'nb-proj-'));
const CONFIG = await mkdtemp(path.join(tmpdir(), 'nb-config-'));
const PORT2 = 3990 + Math.floor(Math.random() * 9);
const BASE2 = `http://127.0.0.1:${PORT2}`;
const CLI = path.resolve('bin', 'notebookjs.js');

const scoped = spawn(process.execPath, [CLI, 'serve', '--no-open', '--port', String(PORT2)], {
  cwd: PROJECT,
  env: { ...process.env, DATA_DIR: '', NB_CONFIG_DIR: CONFIG, NB_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let boot2 = '';
scoped.stdout.on('data', (c) => (boot2 += c));
scoped.stderr.on('data', (c) => (boot2 += c));
for (let i = 0; i < 40 && !/Open the UI/.test(boot2); i += 1) await sleep(100);

const scopedToken = /[?&]token=([^\s]+)/.exec(boot2)?.[1];
const decks = await fetch(`${BASE2}/api/decks`, {
  headers: { Authorization: `Bearer ${scopedToken}` },
}).then((r) => r.json()).catch(() => null);

check('token is written to the config dir', existsSync(path.join(CONFIG, 'token')));
check('token is not written into the project', !existsSync(path.join(PROJECT, 'token')));
check('decks are written into <cwd>/.labjs', existsSync(path.join(PROJECT, '.labjs', 'decks')));
check('startup reports the project data dir', boot2.includes(path.join(PROJECT, '.labjs')), boot2.trim());
check('scoped server accepts the token it generated', decks?.decks?.length === 0, JSON.stringify(decks));

scoped.kill('SIGTERM');
await sleep(300);

console.log(failures ? `\n${failures} CLI check(s) failed` : '\nall CLI checks passed');
process.exit(failures ? 1 : 0);