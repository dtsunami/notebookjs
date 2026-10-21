import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { CONFIG_DIR, TOKEN_FILE } from './paths.js';

export const COOKIE_NAME = 'nb_token';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const RECHECK_MS = 1000;

const fromEnv = (process.env.NB_TOKEN || '').trim();
let cached = null;
let cachedMtime = 0;
let checkedAt = 0;

/**
 * Resolution order: NB_TOKEN env, then data/token, then a freshly generated
 * token written to disk with 0600.
 *
 * The env token is fixed for the life of the process. The file token is
 * re-checked by mtime once a second, so `echo new > data/token` rotates it
 * without a restart — matching how Jupyter behaves.
 */
export async function resolveToken() {
  if (fromEnv) return fromEnv;

  const now = Date.now();
  if (cached && now - checkedAt < RECHECK_MS) return cached;
  checkedAt = now;

  await mkdir(CONFIG_DIR, { recursive: true });

  if (existsSync(TOKEN_FILE)) {
    const info = await stat(TOKEN_FILE);
    if (cached && info.mtimeMs === cachedMtime) return cached;

    const stored = (await readFile(TOKEN_FILE, 'utf8')).trim();
    if (stored) {
      cached = stored;
      cachedMtime = info.mtimeMs;
      return cached;
    }
  }

  const token = randomBytes(32).toString('base64url');
  await writeFile(TOKEN_FILE, token, { mode: 0o600 });
  try {
    await chmod(TOKEN_FILE, 0o600);
  } catch {
    /* best effort on platforms without POSIX modes */
  }
  const info = await stat(TOKEN_FILE);
  cached = token;
  cachedMtime = info.mtimeMs;
  return cached;
}

export async function getTokenPath() {
  return TOKEN_FILE;
}

export function isEnvToken() {
  return Boolean(fromEnv);
}

function hash(value) {
  return createHash('sha256').update(String(value)).digest();
}

/** Constant-time compare; hashing first makes lengths equal. */
export function tokenMatches(candidate, expected) {
  if (!candidate || !expected) return false;
  return timingSafeEqual(hash(candidate), hash(expected));
}

function readCookie(req, name) {
  const raw = req.get('cookie');
  if (!raw) return null;
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function extractToken(req) {
  const header = req.get('authorization');
  if (header && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim();
  }
  if (typeof req.query?.token === 'string' && req.query.token) {
    return req.query.token;
  }
  return readCookie(req, COOKIE_NAME);
}

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

/* ---------- failed-attempt throttling ---------- */

const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_LIMIT = 20;

const failures = new Map();

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function noteFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const recent = (failures.get(key) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  recent.push(now);
  failures.set(key, recent);
}

export function noteSuccess(req) {
  failures.delete(clientKey(req));
}

export function isThrottled(req) {
  const key = clientKey(req);
  const now = Date.now();
  const recent = (failures.get(key) || []).filter((t) => now - t < FAIL_WINDOW_MS);
  if (recent.length === 0) {
    failures.delete(key);
    return false;
  }
  failures.set(key, recent);
  return recent.length >= FAIL_LIMIT;
}

// Bound memory growth from a spray of distinct addresses.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, times] of failures) {
    const recent = times.filter((t) => now - t < FAIL_WINDOW_MS);
    if (recent.length === 0) failures.delete(key);
    else failures.set(key, recent);
  }
}, 60 * 1000);
if (typeof sweeper.unref === 'function') sweeper.unref();

/**
 * Gate every /api route except the handshake endpoints.
 * Authenticating with ?token= also plants the cookie, so the browser stops
 * needing the token in the URL after the first request.
 */
export function requireAuth(token) {
  return (req, res, next) => {
    if (isThrottled(req)) {
      return res.status(429).json({ error: 'Too many failed attempts. Wait 15 minutes.' });
    }

    const candidate = extractToken(req);

    if (tokenMatches(candidate, token)) {
      noteSuccess(req);
      if (typeof req.query?.token === 'string' && req.query.token) {
        setAuthCookie(res, token);
      }
      return next();
    }

    noteFailure(req);
    res.status(401).json({
      error: 'Unauthorized. Pass the token as ?token=, an Authorization: Bearer header, or sign in at /api/auth.',
      authRequired: true,
    });
  };
}