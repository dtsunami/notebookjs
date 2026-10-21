const PARAM = 'token';

export async function submitToken(token) {
  const res = await fetch(`/api/auth?token=${encodeURIComponent(token)}`, {
    credentials: 'same-origin',
  });
  return res.ok;
}

/**
 * Resolves whether this browser may use the API.
 * A ?token= in the URL is exchanged for a cookie and then stripped from the
 * address bar, so the token does not linger in history or referrers.
 */
export async function resolveAuth() {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get(PARAM);

  if (fromUrl) {
    const ok = await submitToken(fromUrl).catch(() => false);
    url.searchParams.delete(PARAM);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    return ok;
  }

  try {
    const res = await fetch('/api/auth', { credentials: 'same-origin' });
    return res.ok;
  } catch {
    // Server unreachable. Let the app boot and surface the error through the
    // usual fetch-failure path instead of blocking behind a token screen.
    return true;
  }
}