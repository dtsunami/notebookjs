/**
 * Shell kernel for notebookjs. Speaks the same newline-delimited JSON protocol
 * as the other harnesses:
 *
 *   in  {"type": "exec", "id": 1, "code": "..."}
 *   out {"type": "ready", "lang": "bash"}
 *       {"type": "result", "id": 1, "ok": true, "entries": [...], "ms": 12}
 *
 * One shell process is kept alive, so `cd`, exported variables and functions
 * survive between cells — the same persistence model as the Python and Ruby
 * kernels. Each cell is fenced with a per-exec nonce so its completion and exit
 * code can be told apart from whatever the cell itself prints.
 *
 * Two deliberate limits:
 *
 *   - A cell's stdin is /dev/null. A notebook cell must never block reading
 *     from the terminal, and letting it read the command pipe would let it
 *     swallow the next cell. Interactive prompts fail fast instead of hanging.
 *   - `sudo` cannot prompt: there is no TTY behind the pipe. Cells are written
 *     to prefer passwordless installers (Homebrew, winget) and to print the
 *     sudo command rather than run it.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const SHELL = argOf('--shell', 'bash');
const NONCE = randomBytes(6).toString('hex');

const PROFILES = {
  /* sh-compatible: bash, and anything else that speaks this fence syntax. */
  bash: {
    cmd: process.env.NB_BASH || 'bash',
    args: ['--noprofile', '--norc', '-s'],
    begin: (id) => `printf '\\n__NB_B_${NONCE}_${id}__\\n'`,
    end: (id) => `printf '\\n__NB_E_${NONCE}_${id}__:%s\\n' "$__nb_rc"`,
    wrap: (code) => `{\n${code}\n} < /dev/null\n__nb_rc=$?`,
    marker: new RegExp(`__NB_E_${NONCE}_(\\d+)__:(-?\\d+)`),
  },
  /* PowerShell: statements on stdin, $? carries the last statement's status. */
  pwsh: {
    cmd: process.env.NB_PWSH || 'pwsh',
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    begin: (id) => `Write-Output ''; Write-Output '__NB_B_${NONCE}_${id}__'`,
    end: (id) => `Write-Output "__NB_E_${NONCE}_${id}__:$(if ($?) { 0 } else { 1 })"`,
    wrap: (code) => `${code}\n`,
    marker: new RegExp(`__NB_E_${NONCE}_(\\d+)__:(-?\\d+)`),
  },
};

const profile = PROFILES[SHELL];
if (!profile) {
  process.stderr.write(`Unknown shell profile "${SHELL}".\n`);
  process.exit(2);
}

let child = null;
let queue = Promise.resolve();
let current = null;

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/**
 * Result entries from the captured streams. stdout lines are ordinary output,
 * stderr lines are errors, and a non-zero exit adds one more error entry naming
 * the code — the same three levels the other harnesses produce.
 */
function finish() {
  const exec = current;
  current = null;
  if (!exec) return;

  const out = exec.out.join('');
  const err = exec.err.join('');
  const [, , rcRaw] = (exec.markerMatch || []);
  const rc = rcRaw == null ? null : Number(rcRaw);

  const entries = [];
  const pushLines = (text, level) => {
    for (const line of String(text).split('\n')) {
      // Drop the fence markers themselves and the blank lines around them.
      if (!line || line.startsWith(`__NB_B_${NONCE}_`) || line.startsWith(`__NB_E_${NONCE}_`)) continue;
      entries.push({ level, text: line });
    }
  };
  pushLines(out, 'log');
  pushLines(err, 'error');

  if (rc != null && rc !== 0) {
    entries.push({ level: 'error', text: `exit code ${rc}` });
  }

  write({
    type: 'result',
    id: exec.id,
    ok: rc === 0,
    entries,
    ms: Date.now() - exec.started,
  });

  // Release the queue. Without this the first cell's promise never settles and
  // every later cell waits behind it.
  exec.resolve();
}

function onStdout(chunk) {
  if (!current) return;
  current.out.push(chunk.toString());
  const all = current.out.join('');
  const m = all.match(profile.marker);
  if (m && m[1] === String(current.id)) {
    current.markerMatch = m;
    finish();
  }
}

function onStderr(chunk) {
  if (!current) return;
  current.err.push(chunk.toString());
}

function onGone(why) {
  if (current) {
    current.err.push(`${why}\n`);
    current.markerMatch = [null, String(current.id), '-1'];
    finish();
  }
  child = null;
}

function start() {
  const c = spawn(profile.cmd, profile.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, TERM: 'dumb', NO_COLOR: '1', CLICOLOR: '0' },
  });

  c.stdout.on('data', onStdout);
  c.stderr.on('data', onStderr);
  c.on('error', (err) => {
    write({ type: 'fatal', error: `Could not start ${profile.cmd}: ${err.message}` });
    process.exit(1);
  });
  c.on('exit', (code, signal) => {
    onGone(`shell exited (${signal || code})`);
  });

  // A prompt would only interleave with output in the captured stream.
  if (SHELL === 'bash') {
    c.stdin.write("PS1=''; PS2=''; unset PROMPT_COMMAND\n");
  }
  child = c;
  return c;
}

function run(code) {
  return new Promise((resolve) => {
    const c = child && !child.killed ? child : start();
    // Belt and braces: a cell that lands no marker must still settle, or one
    // bad command wedges the kernel for good.
    setTimeout(() => {
      if (current && current.resolve === resolve) {
        current.err.push('no result marker; the shell did not complete the cell\n');
        current.markerMatch = [null, String(current.id), '-1'];
        finish();
      }
    }, 30 * 60 * 1000).unref();
    const id = (run.seq = (run.seq || 0) + 1);
    current = { id, out: [], err: [], started: Date.now(), resolve, markerMatch: null };

    const body = [
      profile.begin(id),
      profile.wrap(code),
      profile.end(id),
      '',
    ].join('\n');

    try {
      c.stdin.write(body);
    } catch (err) {
      current.err.push(`Could not write to the shell: ${err.message}\n`);
      current.markerMatch = [null, String(id), '-1'];
      finish();
    }
  });
}

async function handle(line) {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  if (msg.type === 'ping') {
    write({ type: 'pong', id: msg.id });
    return;
  }

  if (msg.type === 'exec') {
    await run(String(msg.code ?? ''));
  }
}

const { createInterface } = await import('node:readline');
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  queue = queue.then(() => handle(line)).catch((err) => {
    write({ type: 'fatal', error: String(err && err.stack ? err.stack : err) });
  });
});

// Drain before leaving. Exiting the moment stdin closes would drop the result
// of whatever cell was still running — which is every cell when the host
// writes a script and closes the pipe in one go.
rl.on('close', () => {
  queue
    .catch(() => {})
    .then(() => {
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      process.exit(0);
    });
});

write({ type: 'ready', lang: SHELL });