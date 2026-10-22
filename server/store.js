import { readFile, writeFile, readdir, mkdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DECKS_DIR, SESSIONS_DIR } from './paths.js';

async function ensureDirs() {
  await mkdir(DECKS_DIR, { recursive: true });
  await mkdir(SESSIONS_DIR, { recursive: true });
}

export function isSafeId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export async function listDecks() {
  await ensureDirs();
  const files = await readdir(DECKS_DIR);
  const out = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const raw = await readFile(path.join(DECKS_DIR, f), 'utf8');
      const parsed = JSON.parse(raw);
      out.push({
        id: f.replace(/\.json$/, ''),
        name: parsed.name || f,
        updatedAt: parsed.updatedAt || null,
      });
    } catch {
      /* skip malformed */
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function readDeck(id) {
  await ensureDirs();
  if (!isSafeId(id)) return null;
  const file = path.join(DECKS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeDeck(id, { name, html, styleSettings, messages }) {
  await ensureDirs();
  if (!isSafeId(id)) throw new Error('Invalid deck id.');
  const payload = {
    id,
    name: name || 'Untitled deck',
    html,
    styleSettings: styleSettings || null,
    messages: messages || [],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(DECKS_DIR, `${id}.json`), JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

export async function deleteDeck(id) {
  await ensureDirs();
  if (!isSafeId(id)) throw new Error('Invalid deck id.');
  const file = path.join(DECKS_DIR, `${id}.json`);
  if (!existsSync(file)) return false;
  await unlink(file);
  return true;
}

export async function writeSession(id, messages) {
  await ensureDirs();
  if (!isSafeId(id)) throw new Error('Invalid session id.');
  await writeFile(
    path.join(SESSIONS_DIR, `${id}.json`),
    JSON.stringify({ id, messages, updatedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
  return true;
}

export async function deleteSession(id) {
  await ensureDirs();
  if (!isSafeId(id)) throw new Error('Invalid session id.');
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(file)) return false;
  await unlink(file);
  return true;
}

export async function readSession(id) {
  await ensureDirs();
  if (!isSafeId(id)) return null;
  const file = path.join(SESSIONS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}