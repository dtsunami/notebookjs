import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = await mkdtemp(path.join(tmpdir(), 'nb-auth-'));
const TOKEN = `test-${Math.random().toString(36).slice(2)}`;
const ROTATED = `${TOKEN}-rotated`;

await writeFile(path.join(DATA_DIR, 'token'), TOKEN, 'utf8');

// No NB_TOKEN: exercise the on-disk token path so rotation can be tested.
const proc = spawn(process.execPath, ['server/index.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR,
    NB_TOKEN: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let bootLog = '';
proc.stdout.on('data', (c) => {
  bootLog += c;
});
proc.stderr.on('data', (c) => {
  bootLog += c;
});

async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not yet */
    }
    await sleep(150);
  }
  return false;
}

const status = (res) => res.status;
const json = (res) => res.json().catch(() => ({}));

try {
  const up = await waitReady();
  check('server boots', up, bootLog.slice(0, 400));
  if (!up) throw new Error('server did not start');

  const health = await fetch(`${BASE}/api/health`);
  const healthBody = await json(health);
  check('health is reachable without a token', health.ok, String(health.status));
  check('health advertises auth', healthBody.authRequired === true, JSON.stringify(healthBody));

  const anon = await fetch(`${BASE}/api/decks`);
  check('unauthenticated /api/decks is 401', status(anon) === 401, String(anon.status));

  const wrong = await fetch(`${BASE}/api/decks?token=nope`);
  check('wrong token is 401', status(wrong) === 401, String(wrong.status));

  const bearerWrong = await fetch(`${BASE}/api/decks`, {
    headers: { Authorization: 'Bearer nope' },
  });
  check('wrong bearer is 401', status(bearerWrong) === 401, String(bearerWrong.status));

  const viaQuery = await fetch(`${BASE}/api/decks?token=${encodeURIComponent(TOKEN)}`);
  check('query token is accepted', viaQuery.ok, String(viaQuery.status));

  const cookie = viaQuery.headers.get('set-cookie') || '';
  check('query token plants a cookie', /nb_token=/.test(cookie), cookie);
  check('cookie is HttpOnly', /HttpOnly/i.test(cookie), cookie);
  check('cookie is SameSite=Lax', /SameSite=Lax/i.test(cookie), cookie);

  const cookieValue = (cookie.match(/nb_token=([^;]+)/) || [])[1] || '';
  const viaCookie = await fetch(`${BASE}/api/decks`, {
    headers: { cookie: `nb_token=${cookieValue}` },
  });
  check('cookie is accepted', viaCookie.ok, String(viaCookie.status));

  const viaBearer = await fetch(`${BASE}/api/decks`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  check('bearer token is accepted', viaBearer.ok, String(viaBearer.status));

  const exec = await fetch(`${BASE}/api/kernel/exec?token=${encodeURIComponent(TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId: 'auth-smoke', lang: 'javascript', code: '6*7' }),
  });
  const execBody = await json(exec);
  check('kernel exec is gated and works', exec.ok, JSON.stringify(execBody).slice(0, 200));
  check(
    'kernel returns a value',
    Array.isArray(execBody.entries) && execBody.entries.some((e) => e.text === '42'),
    JSON.stringify(execBody),
  );

  const execAnon = await fetch(`${BASE}/api/kernel/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deckId: 'auth-smoke', code: '1' }),
  });
  check('unauthenticated kernel exec is 401', status(execAnon) === 401, String(execAnon.status));

  const authNoToken = await fetch(`${BASE}/api/auth`);
  check('/api/auth without a token is 401', status(authNoToken) === 401, String(authNoToken.status));

  const authWithToken = await fetch(`${BASE}/api/auth?token=${encodeURIComponent(TOKEN)}`);
  check('/api/auth with a token is 200', authWithToken.ok, String(authWithToken.status));

  // Rotation: rewriting data/token should take effect without a restart.
  await writeFile(path.join(DATA_DIR, 'token'), ROTATED, 'utf8');
  await sleep(1200);
  const rotatedNew = await fetch(`${BASE}/api/decks?token=${encodeURIComponent(ROTATED)}`);
  check('rotated token is accepted without restart', rotatedNew.ok, String(rotatedNew.status));
  const rotatedOld = await fetch(`${BASE}/api/decks?token=${encodeURIComponent(TOKEN)}`);
  check('old token stops working after rotation', status(rotatedOld) === 401, String(rotatedOld.status));

  // Throttling: repeated bad tokens should eventually return 429.
  let sawThrottle = false;
  for (let i = 0; i < 30; i++) {
    const bad = await fetch(`${BASE}/api/decks?token=wrong-${i}`);
    if (bad.status === 429) {
      sawThrottle = true;
      break;
    }
  }
  check('repeated bad tokens are throttled with 429', sawThrottle);
} finally {
  proc.kill('SIGKILL');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall auth checks passed');
process.exit(failures ? 1 : 0);