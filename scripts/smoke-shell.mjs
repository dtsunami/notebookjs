/**
 * The shell kernel exists so a deck can provision the machine before any
 * interpreter is installed, which means the install deck must work on a bare
 * box. These checks drive the harness the way the server does: newline JSON
 * over a pipe, several cells in one process.
 */
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDeck } from '../server/templates/install.js';
import { probeLanguages, BIN_DIR, SUPPORTED } from '../server/kernel/languages.js';
import { findCells } from '../src/lib/cells.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const harness = path.join(here, '..', 'server', 'kernel', 'harness-shell.mjs');

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

/** Run a list of cells in one harness process and collect every result. */
function runCells(cells) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [harness, '--shell', 'bash'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const results = [];
    let ready = false;
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`harness timed out after ${results.length}/${cells.length} cells`));
    }, 20000);

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        ready = true;
        cells.forEach((code, i) => {
          proc.stdin.write(`${JSON.stringify({ type: 'exec', id: i + 1, code })}\n`);
        });
        return;
      }
      if (msg.type === 'result') {
        results.push(msg);
        if (results.length === cells.length) {
          clearTimeout(timer);
          proc.stdin.end();
          proc.kill('SIGKILL');
          resolve(results);
        }
      }
    });
    proc.on('error', reject);
    proc.stdin.on('error', () => {});
    void ready;
  });
}

const text = (r) => (r.entries || []).map((e) => e.text).join(' | ');

const results = await runCells([
  'echo hello',
  'X=41',
  'echo $((X + 1))',
  'cd /tmp',
  'pwd',
  'nonexistent-command-xyz',
  'echo still alive',
]);

check('the shell answers the first cell', results[0]?.ok === true && text(results[0]).includes('hello'));
check('shell state persists between cells', text(results[2]) === '42', text(results[2]));
check('the working directory persists', text(results[4]) === '/tmp', text(results[4]));
check('a failing command reports a non-zero exit', results[5]?.ok === false, JSON.stringify(results[5]));
check('a failing command does not wedge the kernel', text(results[6]) === 'still alive', text(results[6]));

// --- the install deck ------------------------------------------------------
const deck = installDeck();
const cells = findCells(deck);
check('the install deck has a cell for each OS', cells.length >= 3, String(cells.length));
const installCells = cells.filter((c) => c.lang === 'bash' || c.lang === 'pwsh');
check('every install cell is a kernel cell', installCells.every((c) => c.exec === 'kernel'));
check('every cell is wrapped in a box', cells.every((c) => c.wrapper), 'a bare script survived');
// The verify slide is JavaScript on purpose: it must run on a box where no
// interpreter has been installed yet.
check(
  'the verification cell needs no kernel',
  cells.some((c) => c.lang === 'javascript' && c.exec === 'inline'),
);
check(
  'the shells cover bash and pwsh',
  cells.some((c) => c.lang === 'bash') && cells.some((c) => c.lang === 'pwsh'),
  cells.map((c) => c.lang).join(','),
);
check('installs go to ~/.labjs/bin', cells.some((c) => c.source.includes('$HOME/.labjs/bin')));
check(
  'no cell runs a bare sudo that would hang',
  cells.every((c) => !/(^|\n)\s*sudo\s+[^-\n]/.test(c.source)),
  'a cell invokes sudo without -n',
);

// --- the registry ----------------------------------------------------------
check('the shell languages are registered', SUPPORTED.includes('bash') && SUPPORTED.includes('pwsh'));
check('backends resolve under ~/.labjs', /\.labjs[\\/]bin$/.test(BIN_DIR), BIN_DIR);

const probed = probeLanguages();
check('every registered language reports a status', probed.length === SUPPORTED.length);
check('javascript always resolves', probed.find((l) => l.id === 'javascript')?.ok === true);
check(
  'an unresolvable language says why',
  probed.every((l) => l.ok || (typeof l.error === 'string' && l.error.length > 0)),
);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall shell checks passed');
process.exit(failures ? 1 : 0);