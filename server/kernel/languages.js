import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG_DIR } from '../paths.js';

/**
 * The language registry. Adding a target is two things:
 *
 *   1. a harness that speaks the newline-delimited JSON protocol
 *      (in: {"type":"exec","id":1,"code":"..."}
 *       out: {"type":"ready"} then {"type":"result","id":1,"ok":…,"entries":[…],"ms":…})
 *   2. an entry here pointing at it.
 *
 * Interpreted languages need only an evaluator against a retained scope.
 * Compiled languages use the same protocol with a build step inside the
 * harness (the harness writes a temp source, compiles, runs, streams back).
 * That is why the protocol is deliberately interpreter-agnostic.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = (name) => path.join(here, name);
const repoRoot = (...parts) => path.join(here, '..', '..', ...parts);

/**
 * Where installed backends live. `~/.labjs` is already the per-machine config
 * directory (token, .env), so interpreters installed from the product — or by
 * hand — land in `~/.labjs/bin` and are found without touching PATH or
 * restarting the server.
 *
 * Resolution happens inside each `harness()` call, which runs at spawn time,
 * so a backend installed while the app is running is picked up by the next
 * kernel start (Settings → Kernel → Restart, or the first run in that
 * language).
 */
export const BIN_DIR = path.join(CONFIG_DIR, 'bin');
const installed = (name) => path.join(BIN_DIR, name);

/**
 * Pick the first candidate that exists, preferring an explicit env var, then
 * an installed backend, then a repo venv, then PATH. An absolute candidate
 * that does not exist is an error worth naming rather than a silent fallback
 * to whatever `python3` happens to be on PATH.
 */
function requireBin({ env, envName, names, hint }) {
  const candidates = [env && { bin: env, absolute: true }, ...names.map((bin) => ({ bin, absolute: true }))].filter(
    Boolean,
  );
  for (const c of candidates) {
    if (c.absolute && existsSync(c.bin)) return c.bin;
  }
  // Nothing installed: fall back to the first bare name so a PATH hit still
  // works. The first, not the last — `pwsh` before `powershell`.
  const rel = names.find((n) => n && !n.includes(path.sep));
  if (rel) return rel;
  const err = new Error(`${envName} ${hint}`);
  err.code = 'MISSING_BINARY';
  throw err;
}

function onPath(cmd) {
  if (!cmd) return false;
  if (cmd.includes(path.sep)) return existsSync(cmd);
  return String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => existsSync(path.join(dir, cmd)));
}

function pythonEntry() {
  const bin = requireBin({
    env: process.env.NB_PYTHON,
    envName: 'NB_PYTHON',
    names: [installed('python3'), repoRoot('.venv', 'bin', 'python3'), repoRoot('venv', 'bin', 'python3'), 'python3'],
    hint: `was not found. Set NB_PYTHON, install python3, or run Install backends to put it in ${BIN_DIR}.`,
  });
  return { cmd: bin, args: ['-u', harness('harness-python.py')] };
}

export const LANGUAGES = {
  javascript: {
    label: 'JavaScript',
    ext: 'js',
    kind: 'interpreted',
    harness: () => ({
      cmd: process.execPath,
      args: [harness('harness-node.mjs')],
    }),
  },

  typescript: {
    label: 'TypeScript',
    ext: 'ts',
    kind: 'transpiled',
    harness: () => ({
      // Same process, same protocol: the harness strips types with Node's
      // built-in transform when a cell asks for it. Set data-lang="typescript".
      cmd: process.execPath,
      args: [harness('harness-node.mjs'), '--typescript'],
    }),
  },

  python: {
    label: 'Python',
    ext: 'py',
    kind: 'interpreted',
    harness: pythonEntry,
  },

  ruby: {
    label: 'Ruby',
    ext: 'rb',
    kind: 'interpreted',
    harness: () => ({
      cmd: requireBin({
        env: process.env.NB_RUBY,
        envName: 'NB_RUBY',
        names: [installed('ruby'), 'ruby'],
        hint: `was not found. Set NB_RUBY, install ruby, or run Install backends.`,
      }),
      args: ['-W0', harness('harness-ruby.rb')],
    }),
  },

  /*
   * Shells exist so the machine can be provisioned from a deck — the install
   * deck needs a shell before any interpreter does. They are not a target the
   * assistant writes cells in by default.
   *
   * A shell command that installs software routinely exceeds the default exec
   * budget, so these carry their own.
   */
  bash: {
    label: 'Bash',
    ext: 'sh',
    kind: 'shell',
    timeoutMs: 15 * 60 * 1000,
    harness: () => {
      // The harness is Node; bash is the process the harness spawns. Resolving
      // bash here both proves it exists and hands it to the harness through the
      // environment, which is where it looks for it.
      const shell = requireBin({
        env: process.env.NB_BASH,
        envName: 'NB_BASH',
        names: [installed('bash'), 'bash'],
        hint: 'was not found. On Windows use the PowerShell slide, or install Git Bash / WSL.',
      });
      return {
        cmd: process.execPath,
        args: [harness('harness-shell.mjs'), '--shell', 'bash'],
        env: { NB_BASH: shell },
      };
    },
  },

  pwsh: {
    label: 'PowerShell',
    ext: 'ps1',
    kind: 'shell',
    timeoutMs: 15 * 60 * 1000,
    harness: () => {
      const shell = requireBin({
        env: process.env.NB_PWSH,
        envName: 'NB_PWSH',
        names: [installed('pwsh'), installed('powershell'), 'pwsh', 'powershell'],
        hint: 'was not found. On macOS/Linux use the bash slide; on Windows install PowerShell 7.',
      });
      return {
        cmd: process.execPath,
        args: [harness('harness-shell.mjs'), '--shell', 'pwsh'],
        env: { NB_PWSH: shell },
      };
    },
  },

  /*
   * Compiled targets. The harness owns the toolchain; the protocol does not
   * change. Kept commented until a harness exists for each so the registry
   * never advertises a language it cannot start.
   *
   * rust:   { label: 'Rust',   ext: 'rs', kind: 'compiled', harness: () => ({ cmd: 'cargo', args: ['...'] }) },
   * go:     { label: 'Go',     ext: 'go', kind: 'compiled', harness: () => ({ cmd: 'go',    args: ['...'] }) },
   * c:      { label: 'C',      ext: 'c',  kind: 'compiled', harness: () => ({ cmd: 'cc',    args: ['...'] }) },
   */
};

// Optional out-of-tree targets: NB_LANGUAGES=/abs/path/languages.json
// { "lua": { "label": "Lua", "ext": "lua",
//            "harness": { "cmd": "lua", "args": ["/abs/harness-lua.lua"] } } }
const EXTRA = process.env.NB_LANGUAGES;
if (EXTRA && existsSync(EXTRA)) {
  try {
    const raw = JSON.parse(readFileSync(EXTRA, 'utf8'));
    for (const [id, cfg] of Object.entries(raw)) {
      const h = cfg && cfg.harness;
      if (!h || typeof h.cmd !== 'string') continue;
      LANGUAGES[id] = {
        label: cfg.label || id,
        ext: cfg.ext || id,
        kind: cfg.kind || 'interpreted',
        harness: () => ({ cmd: h.cmd, args: Array.isArray(h.args) ? h.args : [] }),
      };
    }
  } catch {
    /* a malformed file must not take the built-ins down with it */
  }
}

export const SUPPORTED = Object.keys(LANGUAGES);

/**
 * What each language resolves to on this machine, without starting anything.
 * The Kernel settings tab renders this, so "why won't Python start" has an
 * answer in the product rather than only in a server log.
 */
export function probeLanguages() {
  return Object.entries(LANGUAGES).map(([id, cfg]) => {
    const base = { id, label: cfg.label, kind: cfg.kind, timeoutMs: cfg.timeoutMs || null };
    try {
      const { cmd, env } = cfg.harness();
      // When a harness names its binary through the environment, that is the
      // thing the operator cares about, not the Node that runs the harness.
      const named = env && Object.values(env)[0];
      const target = named || cmd;
      const ok = onPath(target);
      return { ...base, cmd: target, ok, error: ok ? null : `Not found at ${target}.` };
    } catch (err) {
      return { ...base, cmd: null, ok: false, error: err.message };
    }
  });
}