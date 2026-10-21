import vm from 'node:vm';
import readline from 'node:readline';

let entries = [];
let queue = Promise.resolve();

function fmt(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || String(value);
  if (typeof value === 'bigint') return `${value}n`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(level, args) {
  entries.push({ level, text: args.map(fmt).join(' ') });
}

const consoleShim = {};
for (const level of ['log', 'info', 'warn', 'error', 'debug', 'trace']) {
  consoleShim[level] = (...a) => push(level === 'debug' || level === 'trace' ? 'log' : level, a);
}

const sandbox = {
  console: consoleShim,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  TextEncoder,
  TextDecoder,
  URL,
  URLSearchParams,
  AbortController,
  Buffer,
  fetch,
  process: {
    env: process.env,
    cwd: () => process.cwd(),
    platform: process.platform,
    version: process.version,
    argv: [],
    exit: () => {
      throw new Error('process.exit is disabled inside a notebook cell');
    },
  },
};

const context = vm.createContext(sandbox);
context.globalThis = context;
context.global = context;

async function exec(code) {
  entries = [];
  const started = Date.now();
  const finish = (ok) => ({ ok, entries, ms: Date.now() - started });

  try {
    let value = vm.runInContext(code, context, { displayErrors: true, filename: 'cell.js' });
    if (value && typeof value.then === 'function') value = await value;
    if (value !== undefined) entries.push({ level: 'return', text: fmt(value) });
    return finish(true);
  } catch (err) {
    // A SyntaxError raised inside the vm context is not an instance of the
    // host realm's SyntaxError, so match on name rather than instanceof.
    const needsAsyncWrapper =
      !!err && err.name === 'SyntaxError' && /\bawait\b/.test(String(err.message));

    if (needsAsyncWrapper) {
      try {
        // The wrapper body is a function scope, so declarations inside it do
        // not leak out. To keep a value between cells, assign it to a global:
        //   globalThis.total = await fetchTotal();
        await vm.runInContext(`(async () => { ${code} })()`, context, {
          displayErrors: true,
          filename: 'cell.js',
        });
        return finish(true);
      } catch (err2) {
        entries.push({ level: 'error', text: err2.stack || String(err2) });
        return finish(false);
      }
    }

    entries.push({ level: 'error', text: err.stack || String(err) });
    return finish(false);
  }
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
    const result = await exec(String(msg.code ?? ''));
    write({ type: 'result', id: msg.id, ...result });
  }
}

function write(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  queue = queue.then(() => handle(line)).catch((err) => {
    write({ type: 'fatal', error: String(err && err.stack ? err.stack : err) });
  });
});

write({ type: 'ready', lang: 'javascript' });