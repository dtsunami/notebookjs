import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { LANGUAGES, SUPPORTED, BIN_DIR, probeLanguages } from './languages.js';

export { SUPPORTED, BIN_DIR, probeLanguages };

/**
 * Targets live in ./languages.js so adding one is a config entry plus a
 * harness. A kernel is a long-lived child process, so variables survive
 * between cells — the same model Jupyter uses.
 */

const IDLE_MS = Number(process.env.KERNEL_IDLE_MS || 10 * 60 * 1000);
const READY_TIMEOUT_MS = 8000;
const EXEC_TIMEOUT_MS = Number(process.env.KERNEL_EXEC_TIMEOUT_MS || 30000);

/**
 * A language may carry its own budget. A shell command that installs software
 * routinely outlives the default, and killing it halfway leaves a package
 * manager's state inconsistent, so shells ask for minutes rather than seconds.
 */
function budgetFor(lang) {
  const own = LANGUAGES[lang]?.timeoutMs;
  return Number.isFinite(own) && own > 0 ? own : EXEC_TIMEOUT_MS;
}

const live = new Map();

const keyOf = (deckId, lang) => `${deckId || 'scratch'}::${lang}`;

function startKernel(deckId, lang) {
  const language = LANGUAGES[lang];
  if (!language) {
    return Promise.reject(
      new Error(`No runtime for "${lang}". Available: ${SUPPORTED.join(', ')}.`),
    );
  }

  let cmd;
  let args;
  let extraEnv;
  try {
    ({ cmd, args, env: extraEnv } = language.harness());
  } catch (err) {
    return Promise.reject(err);
  }
  // A harness may name the binary it drives (a shell, an interpreter) through
  // the environment rather than as argv[0], which is Node for those harnesses.
  const proc = spawn(cmd, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
  });

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
  const limit = budgetFor(lang);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      // The harness never got its terminator, so this kernel can no longer tell
      // where the abandoned cell ended. Kill it rather than risk feeding the
      // next cell into the middle of the last one.
      entry.dead = true;
      live.delete(keyOf(deckId, lang));
      try {
        entry.proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      reject(new Error(`Cell exceeded ${Math.round(limit / 1000)}s. The ${lang} kernel was restarted.`));
    }, limit);

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

/**
 * Stop a running cell. A synchronous JavaScript loop inside the vm cannot be
 * preempted, and Python has no portable signal-free way to unwind mid-cell, so
 * interrupt means "kill the process". Kernel state is lost — the caller must
 * say so, the same way Jupyter's "restart kernel" does.
 */
export async function interrupt({ deckId, lang = 'javascript' }) {
  const key = keyOf(deckId, lang);
  const entry = live.get(key);
  if (!entry) return { ok: true, interrupted: false, cleared: false };

  entry.dead = true;
  live.delete(key);
  for (const [, waiter] of entry.pending) {
    try {
      waiter.reject(new Error('Interrupted.'));
    } catch {
      /* the promise is already settled */
    }
  }
  entry.pending.clear();
  try {
    entry.proc.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  return { ok: true, interrupted: true, cleared: true };
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
      label: LANGUAGES[e.lang]?.label || e.lang,
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