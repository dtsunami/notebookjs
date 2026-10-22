import { readdir, mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The browser is rooted at the directory the server was launched from, the
 * same convention as `jupyter lab`. NB_ROOT overrides it.
 */
export const ROOT = path.resolve(process.env.NB_ROOT || process.cwd());

const HIDDEN = new Set([
  'node_modules',
  '.git',
  '.labjs',
  '.DS_Store',
  'dist',
  '.venv',
  'venv',
  '__pycache__',
  '.pytest_cache',
]);

export class PathError extends Error {}

/**
 * Resolve a client-supplied relative path inside ROOT.
 * Rejects traversal, absolute paths, and symlink escapes.
 */
export function resolveSafe(relPath = '') {
  const cleaned = String(relPath || '').replace(/^[/\\]+/, '');
  const abs = path.resolve(ROOT, cleaned);
  const rel = path.relative(ROOT, abs);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathError('Path escapes the server root.');
  }
  return abs;
}

export function toRel(abs) {
  const rel = path.relative(ROOT, abs);
  return rel === '' ? '' : rel.split(path.sep).join('/');
}

function kindOf(name, isDir) {
  if (isDir) return 'dir';
  if (name.endsWith('.jsnb')) return 'notebook';
  if (/\.(html?|css|js|jsx|mjs|ts|tsx|json|md|py)$/i.test(name)) return 'code';
  if (/\.(png|jpe?g|gif|svg|webp|avif)$/i.test(name)) return 'image';
  return 'file';
}

export async function list(relPath = '', { showHidden = false } = {}) {
  const abs = resolveSafe(relPath);
  const info = await stat(abs);
  if (!info.isDirectory()) throw new PathError('Not a directory.');

  const names = await readdir(abs, { withFileTypes: true });
  const entries = [];

  for (const d of names) {
    if (!showHidden && (HIDDEN.has(d.name) || d.name.startsWith('.'))) continue;

    const childAbs = path.join(abs, d.name);
    let size = 0;
    let mtime = null;
    try {
      const s = await stat(childAbs);
      size = s.size;
      mtime = s.mtime.toISOString();
    } catch {
      continue; // broken symlink
    }

    entries.push({
      name: d.name,
      path: toRel(childAbs),
      kind: kindOf(d.name, d.isDirectory()),
      size,
      mtime,
    });
  }

  entries.sort((a, b) => {
    if (a.kind === 'dir' && b.kind !== 'dir') return -1;
    if (b.kind === 'dir' && a.kind !== 'dir') return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  return { root: ROOT, path: toRel(abs), entries };
}

function validName(name) {
  const n = String(name || '').trim();
  if (!n || n === '.' || n === '..') throw new PathError('Invalid name.');
  if (/[/\\]/.test(n)) throw new PathError('Name cannot contain a path separator.');
  return n;
}

export async function makeDir(relPath, name) {
  const dir = resolveSafe(relPath);
  const target = path.join(dir, validName(name));
  resolveSafe(toRel(target));
  if (existsSync(target)) throw new PathError('That name already exists.');
  await mkdir(target, { recursive: false });
  return { path: toRel(target) };
}

export const EMPTY_NOTEBOOK = (name) => ({
  version: 1,
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
  <span class="badge">New</span>
  <h1>${name}</h1>
  <p>Add cells and slides, or ask the assistant.</p>
</section>
</div>
</body>
</html>`,
  styleSettings: { preset: 'midnight' },
  messages: [],
});

const CREATE_EXT = { notebook: '.jsnb', code: '.js', text: '.md', html: '.html' };

export async function create(relPath, name, kind = 'notebook') {
  const dir = resolveSafe(relPath);
  let finalName = validName(name);
  if (!/\.[a-z0-9]{1,8}$/i.test(finalName)) {
    finalName += CREATE_EXT[kind] || CREATE_EXT.notebook;
  }

  const target = path.join(dir, finalName);
  resolveSafe(toRel(target));
  if (existsSync(target)) throw new PathError('That name already exists.');

  const body =
    kind === 'notebook'
      ? JSON.stringify(EMPTY_NOTEBOOK(finalName.replace(/\.jsnb$/, '')), null, 2)
      : '';

  await writeFile(target, body, 'utf8');
  return { path: toRel(target), kind };
}

const MAX_READ = 8 * 1024 * 1024;

export async function read(relPath) {
  const abs = resolveSafe(relPath);
  const info = await stat(abs);
  if (info.isDirectory()) throw new PathError('Cannot read a directory.');
  if (info.size > MAX_READ) throw new PathError('File is too large to open.');
  const text = await readFile(abs, 'utf8');
  return { path: toRel(abs), text, size: info.size };
}

export async function write(relPath, content) {
  const abs = resolveSafe(relPath);
  if (typeof content !== 'string') throw new PathError('content must be a string.');
  await writeFile(abs, content, 'utf8');
  const info = await stat(abs);
  return { path: toRel(abs), size: info.size };
}

export async function renamePath(relPath, name) {
  const abs = resolveSafe(relPath);
  if (toRel(abs) === '') throw new PathError('Cannot rename the root.');
  const target = path.join(path.dirname(abs), validName(name));
  resolveSafe(toRel(target));
  if (existsSync(target)) throw new PathError('That name already exists.');
  await rename(abs, target);
  return { path: toRel(target) };
}

export async function remove(relPath) {
  const abs = resolveSafe(relPath);
  if (toRel(abs) === '') throw new PathError('Cannot delete the root.');
  await rm(abs, { recursive: true, force: false });
  return { ok: true };
}