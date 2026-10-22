#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const HELP = `notebookjs — agent-driven HTML slide decks

Usage
  notebookjs [serve] [options]        start the server and open the UI
  notebookjs list                     list saved decks
  notebookjs new <name>               create an empty deck
  notebookjs help | --version

Serve options
  --host <addr>     bind address            (default 127.0.0.1)

  url               open the last sign-in URL (reconnect, no typing)
  --port <n>        API + UI port           (default 3001)
  --data <dir>      decks and sessions      (default <cwd>/.labjs)
  --no-open         do not launch a browser
  --print-token     print the token and exit

Config lives in ~/.labjs (token, .env) and is shared by every project.
Decks live in <cwd>/.labjs and belong to the directory you launch from.
.env is read from <cwd>/.env, then ~/.labjs/.env, then the environment.

Environment: LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, NB_TOKEN, DATA_DIR,
             NB_CONFIG_DIR, NB_ROOT, HOST, PORT.
`;

function parse(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('-')) {
      out._.push(a);
      continue;
    }
    const [key, inline] = a.replace(/^--?/, '').split('=');
    if (inline !== undefined) out[key] = inline;
    else if (argv[i + 1] && !argv[i + 1].startsWith('-')) out[key] = argv[(i += 1)];
    else out[key] = true;
  }
  return out;
}

// Resolved through paths.js so the CLI and the server can never disagree about
// where decks live. Only an explicit --data is written back into the
// environment: the default must stay a default, or paths.js would read it and
// conclude the token belongs in the project directory too.
async function dataDir(opts) {
  if (opts.data) return path.resolve(opts.data);
  const { DATA_DIR } = await import('../server/paths.js');
  return DATA_DIR;
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* headless or no default browser */
  }
}

function slug(name) {
  return (
    String(name || 'deck')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'deck'
  );
}

async function list(opts) {
  const dir = path.join(await dataDir(opts), 'decks');
  if (!existsSync(dir)) {
    console.log('No decks yet.');
    return;
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  if (!files.length) {
    console.log('No decks yet.');
    return;
  }
  const rows = [];
  for (const f of files) {
    try {
      const deck = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      rows.push({
        id: f.replace(/\.json$/, ''),
        name: deck.name || '(untitled)',
        updatedAt: deck.updatedAt || '',
      });
    } catch {
      /* skip malformed */
    }
  }
  rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const w = Math.max(...rows.map((r) => r.id.length), 2);
  for (const r of rows) {
    console.log(`${r.id.padEnd(w)}  ${r.updatedAt.slice(0, 16).padEnd(16)}  ${r.name}`);
  }
}

async function create(name, opts) {
  if (!name) {
    console.error('Usage: notebookjs new <name>');
    process.exit(1);
  }
  const dir = path.join(await dataDir(opts), 'decks');
  await mkdir(dir, { recursive: true });
  const id = slug(name);
  const file = path.join(dir, `${id}.json`);
  if (existsSync(file)) {
    console.error(`Deck "${id}" already exists.`);
    process.exit(1);
  }
  const deck = {
    id,
    name,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
</head>
<body>
<div id="deck">
<section class="slide" data-slide-id="s1">
  <span class="badge">New deck</span>
  <h1>${name}</h1>
  <p>Ask the assistant to build your first slide.</p>
</section>
</div>
</body>
</html>`,
    styleSettings: { preset: 'midnight' },
    messages: [],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(file, JSON.stringify(deck, null, 2), 'utf8');
  const rel = path.relative(process.cwd(), file);
  console.log(`Created ${rel.startsWith('..') ? file : rel}`);
}

/**
 * Reconnect: print (and unless --no-open, open) the sign-in URL this machine
 * last served. The token in it is exchanged for a cookie and stripped from the
 * address bar, so this is safe to leave lying around at 0600 — it is no worse
 * than the token file itself, and it is the difference between one command and
 * hunting for a token to paste.
 */
async function openUrl(opts) {
  const { CONFIG_DIR } = await import('../server/paths.js');
  const file = path.join(CONFIG_DIR, 'url');
  if (!existsSync(file)) {
    console.error('No sign-in URL recorded yet. Run `nb serve` once, then try again.');
    process.exitCode = 1;
    return;
  }
  const url = (await readFile(file, 'utf8')).trim();
  if (!url) {
    console.error(`${file} is empty. Run \`nb serve\` to record a new one.`);
    process.exitCode = 1;
    return;
  }
  console.log(url);
  if (!opts['no-open']) openBrowser(url);
}

async function serve(opts) {
  const host = opts.host || process.env.HOST || '127.0.0.1';
  const port = String(opts.port || process.env.PORT || 3001);

  process.env.HOST = host;
  process.env.PORT = port;
  if (opts.data) process.env.DATA_DIR = path.resolve(opts.data);
  if (!existsSync(path.join(root, 'dist'))) {
    console.warn(
      'No dist/ found — the UI will 404. Run `npm run build` first (or `npm run dev` for the Vite workflow).',
    );
  }

  const { resolveToken } = await import('../server/auth.js');
  const token = await resolveToken();
  if (opts['print-token']) {
    console.log(token);
    return;
  }

  // Tells server/index.js not to print the sign-in URL; the CLI prints and
  // opens it once the port is actually bound.
  process.env.NB_CLI = '1';

  // server/index.js binds the port and installs signal handlers.
  const { ready } = await import('../server/index.js');
  await ready;

  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  const base = `http://${shown}:${port}`;
  const url = `${base}/?token=${encodeURIComponent(token)}`;

  // Keep the sign-in URL on disk so reconnecting needs no keystrokes: `nb url`
  // prints and opens it. It is written with 0600 because it carries the token.
  const { CONFIG_DIR } = await import('../server/paths.js');
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    const urlFile = path.join(CONFIG_DIR, 'url');
    await writeFile(urlFile, `${url}\n`, { mode: 0o600 });
    await chmod(urlFile, 0o600).catch(() => {});
  } catch {
    /* a read-only config dir must not stop the server from starting */
  }

  console.log(`\n  Open the UI and sign in:\n  ${url}\n`);
  console.log('  To reconnect later (no typing):  nb url\n');
  if (!opts['no-open']) openBrowser(url);
}

const opts = parse(process.argv.slice(2));
// A bare --help/--version/--print-token is an action, not an option to `serve`.
const command =
  opts._.shift() ||
  (opts.help || opts.h ? 'help' : null) ||
  (opts.version || opts.v ? 'version' : null) ||
  'serve';

switch (command) {
  case 'serve':
  case 'start':
    await serve(opts);
    break;
  case 'url':
    await openUrl(opts);
    break;
  case 'list':
  case 'ls':
    await list(opts);
    break;
  case 'new':
  case 'create':
    await create(opts._.join(' ').trim(), opts);
    break;
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    break;
  case 'version':
  case '--version':
  case '-v': {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    console.log(pkg.version);
    break;
  }
  default:
    console.error(`Unknown command "${command}".\n`);
    console.log(HELP);
    process.exit(1);
}