import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * One harness per language. A kernel is a long-lived child process that keeps
 * its own interpreter state, so variables survive between cells — the same
 * model Jupyter uses. Adding Python is a new entry here, not a rewrite.
 */
function pythonBinary() {
  const candidates = [
    process.env.NB_PYTHON,
    path.join(here, '..', '..', '.venv', 'bin', 'python3'),
    path.join(here, '..', '..', 'venv', 'bin', 'python3'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === process.env.NB_PYTHON) return c;
    if (existsSync(c)) return c;
  }
  return process.env.NB_PYTHON || 'python3';
}

const RUNTIMES = {
  javascript: () => ({
    cmd: process.execPath,
    args: [path.join(here, 'harness-node.mjs')],
  }),
  python: () => ({
    cmd: pythonBinary(),
    args: ['-u', path.join(here, 'harness-python.py')],
  }),
};

export const SUPPORTED = Object.keys(RUNTIMES);

const IDLE_MS = Number(process.env.KERNEL_IDLE_MS || 10 * 60 * 1000);
const READY_TIMEOUT_MS = 8000;
const EXEC_TIMEOUT_MS = Number(process.env.KERNEL_EXEC_TIMEOUT_MS || 30000);

const live = new Map();

const keyOf = (deckId, lang) => `${deckId || 'scratch'}::${lang}`;

function startKernel(deckId, lang) {
  const make = RUNTIMES[lang];
  if (!make) {
    return Promise.reject(
      new Error(`No runtime for "${lang}". Available: ${SUPPORTED.join(', ')}.`),
    );
  }

  if (lang === 'python') {
    const bin = pythonBinary();
    const isPath = bin.includes('/');
    if (isPath && !existsSync(bin)) {
      return Promise.reject(
        new Error(
          `Python interpreter not found at ${bin}. Set NB_PYTHON to your venv's python3, e.g. NB_PYTHON=./venv/bin/python3`,
        ),
      );
    }
  }

  const { cmd, args } = make();
  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });

  const entry = {
    deckId,
    lang,
    proc,
    pending: new Map(),
    seq: 0,
    lastUsed: Date.now(),
    dead: false,
    stderr: '',
  };

  proc.stderr.on('data', (chunk) => {
    entry.stderr = `${entry.stderr}${chunk}`.slice(-4000);
  });

  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Kernel "${lang}" did not start within ${READY_TIMEOUT_MS}ms.`));
    }, READY_TIMEOUT_MS);

    proc.once('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start "${lang}" kernel: ${err.message}`));
    });

    const rl = readline.createInterface({ input: proc.stdout });
    entry.rl = rl;

    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }

      if (msg.type === 'ready') {
        clearTimeout(timer);
        resolve(entry);
        return;
      }

      const waiter = entry.pending.get(msg.id);
      if (!waiter) return;
      entry.pending.delete(msg.id);

      if (msg.type === 'result') {
        waiter.resolve({ ok: !!msg.ok, entries: msg.entries || [], ms: msg.ms || 0 });
      } else if (msg.type === 'fatal') {
        waiter.reject(new Error(msg.error || 'Kernel failed.'));
      }
    });
  });

  const onGone = (reason) => {
    if (entry.dead) return;
    entry.dead = true;
    for (const [, waiter] of entry.pending) {
      waiter.reject(new Error(`${reason}${entry.stderr ? `: ${entry.stderr.trim()}` : ''}`));
    }
    entry.pending.clear();
    live.delete(keyOf(deckId, lang));
  };

  proc.once('exit', (code, signal) => {
    onGone(`Kernel exited (${signal || code}).`);
  });

  entry.ready = ready;
  live.set(keyOf(deckId, lang), entry);
  return ready;
}

async function acquire(deckId, lang) {
  const key = keyOf(deckId, lang);
  const existing = live.get(key);
  if (existing && !existing.dead) {
    existing.lastUsed = Date.now();
    await existing.ready.catch(() => {});
    if (!existing.dead) return existing;
  }
  return startKernel(deckId, lang);
}

/**
 * Execute one cell in the deck's kernel, creating it on first use.
 * @returns {Promise<{ok: boolean, entries: Array, ms: number, lang: string}>}
 */
export async function exec({ deckId, lang = 'javascript', code }) {
  const entry = await acquire(deckId, lang);
  entry.lastUsed = Date.now();

  const id = ++entry.seq;
  const payload = JSON.stringify({ type: 'exec', id, code: String(code ?? '') });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error(`Cell exceeded ${EXEC_TIMEOUT_MS}ms.`));
    }, EXEC_TIMEOUT_MS);

    entry.pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve({ ...value, lang });
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });

    try {
      entry.proc.stdin.write(`${payload}\n`);
    } catch (err) {
      entry.pending.delete(id);
      clearTimeout(timer);
      reject(new Error(`Could not write to kernel: ${err.message}`));
    }
  });
}

export async function restart({ deckId, lang = 'javascript' }) {
  const key = keyOf(deckId, lang);
  const entry = live.get(key);
  if (entry) {
    entry.dead = true;
    live.delete(key);
    try {
      entry.proc.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
  return { ok: true };
}

export function status() {
  return Array.from(live.values())
    .filter((e) => !e.dead)
    .map((e) => ({
      deckId: e.deckId,
      lang: e.lang,
      idleMs: Date.now() - e.lastUsed,
      pending: e.pending.size,
      seq: e.seq,
    }));
}

export async function killAll() {
  const entries = Array.from(live.values());
  live.clear();
  await Promise.all(
    entries.map(
      (e) =>
        new Promise((resolve) => {
          e.dead = true;
          for (const [, waiter] of e.pending) waiter.reject(new Error('Server shutting down.'));
          e.pending.clear();
          e.proc.once('exit', resolve);
          try {
            e.proc.kill('SIGKILL');
          } catch {
            resolve();
          }
        }),
    ),
  );
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of live) {
    if (entry.pending.size > 0) continue;
    if (now - entry.lastUsed < IDLE_MS) continue;
    live.delete(key);
    entry.dead = true;
    try {
      entry.proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}, 60 * 1000);

if (typeof sweeper.unref === 'function') sweeper.unref();