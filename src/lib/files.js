async function req(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const listDir = (path = '', hidden = false) =>
  req(`/api/files/list?path=${encodeURIComponent(path)}${hidden ? '&hidden=1' : ''}`);

export const readFileAt = (path) => req(`/api/files/read?path=${encodeURIComponent(path)}`);

export const writeFileAt = (path, content) =>
  req('/api/files/write', { method: 'POST', body: JSON.stringify({ path, content }) });

export const mkdirAt = (path, name) =>
  req('/api/files/mkdir', { method: 'POST', body: JSON.stringify({ path, name }) });

export const createAt = (path, name, kind = 'notebook') =>
  req('/api/files/create', { method: 'POST', body: JSON.stringify({ path, name, kind }) });

export const renameAt = (path, name) =>
  req('/api/files/rename', { method: 'POST', body: JSON.stringify({ path, name }) });

export const deleteAt = (path) =>
  req(`/api/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });

export function parentOf(path) {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function basename(path) {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}