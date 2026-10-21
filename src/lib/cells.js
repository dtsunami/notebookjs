const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const NB_TYPE_RE = /type\s*=\s*["']text\/nb-cell["']/i;
const CELL_ID_RE = /data-cell-id\s*=\s*["']([^"']+)["']/i;
const LANG_RE = /data-lang\s*=\s*["']([^"']+)["']/i;
const EXEC_RE = /data-exec\s*=\s*["']([^"']+)["']/i;

export function unescapeSource(text) {
  return String(text || '').replace(/<\\\/script/gi, '</script');
}

export function escapeSource(text) {
  return String(text || '').replace(/<\/script/gi, '<\\/script');
}

export function findCells(html) {
  const out = [];
  SCRIPT_RE.lastIndex = 0;
  let m;
  while ((m = SCRIPT_RE.exec(html))) {
    if (!NB_TYPE_RE.test(m[1])) continue;
    const idMatch = m[1].match(CELL_ID_RE);
    const langMatch = m[1].match(LANG_RE);
    const execMatch = m[1].match(EXEC_RE);
    const openEnd = m.index + m[0].indexOf('>') + 1;
    out.push({
      id: idMatch ? idMatch[1] : null,
      lang: langMatch ? langMatch[1].toLowerCase() : 'javascript',
      exec: execMatch ? execMatch[1].toLowerCase() : 'inline',
      // The storage format wraps the body as "\n" + source + "\n". Invert it
      // exactly: drop the leading newline and any trailing whitespace.
      source: unescapeSource(m[2]).replace(/^\n/, '').replace(/\s+$/, ''),
      start: m.index,
      end: m.index + m[0].length,
      openEnd,
      closeStart: openEnd + m[2].length,
    });
  }
  return out;
}

export function countCells(html) {
  return findCells(html).length;
}

/** Give every cell script a data-cell-id so edits can address it. */
export function ensureCellIds(html) {
  const cells = findCells(html);
  if (cells.length === 0) return html;

  const used = new Set();
  let next = 1;
  for (const c of cells) {
    if (!c.id) continue;
    used.add(c.id);
    const n = parseInt(String(c.id).replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }

  const edits = [];
  for (const c of cells) {
    if (c.id) continue;
    let id;
    do {
      id = `c${next++}`;
    } while (used.has(id));
    used.add(id);
    edits.push({ at: c.openEnd - 1, text: ` data-cell-id="${id}"` });
  }

  let out = html;
  for (let i = edits.length - 1; i >= 0; i--) {
    out = out.slice(0, edits[i].at) + edits[i].text + out.slice(edits[i].at);
  }
  return out;
}

/**
 * Replace one cell's source. Address by id when available, else by index.
 */
export function replaceCellSource(html, { id, index }, source) {
  const cells = findCells(html);
  let cell = null;
  if (id) cell = cells.find((c) => c.id === id);
  if (!cell && typeof index === 'number') cell = cells[index];
  if (!cell) return html;

  const body = `\n${escapeSource(String(source).replace(/\s+$/, ''))}\n`;
  return html.slice(0, cell.openEnd) + body + html.slice(cell.closeStart);
}

export function removeCell(html, { id, index }) {
  const cells = findCells(html);
  let cell = null;
  if (id) cell = cells.find((c) => c.id === id);
  if (!cell && typeof index === 'number') cell = cells[index];
  if (!cell) return html;

  let start = cell.start;
  let end = cell.end;
  if (html[end] === '\n') end += 1;
  if (html[start - 1] === '\n' && html[start - 2] === '\n') start -= 1;
  return html.slice(0, start) + html.slice(end);
}

/**
 * Insert a new cell immediately before the closing tag of the given slide.
 * Falls back to before </body> when the slide can't be found.
 */
export function insertCell(html, { slideId, lang = 'javascript', exec = 'inline', source = '', beforeBody = true } = {}) {
  const id = nextCellId(html);
  const block = `<script type="text/nb-cell" data-cell-id="${id}" data-lang="${lang}" data-exec="${exec}">\n${escapeSource(source)}\n</script>`;

  if (slideId) {
    const slideRe = /<(section|div)\b[^>]*data-slide-id\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = slideRe.exec(html))) {
      if (m[2] !== slideId) continue;
      const tag = m[1].toLowerCase();
      const openEnd = m.index + m[0].length;
      const close = findClose(html, openEnd, tag);
      if (close === -1) break;
      return `${html.slice(0, close)}${block}\n${html.slice(close)}`;
    }
  }

  if (beforeBody) {
    const bodyClose = html.search(/<\/body>/i);
    if (bodyClose !== -1) return `${html.slice(0, bodyClose)}${block}\n${html.slice(bodyClose)}`;
  }
  return `${html}\n${block}`;
}

function findClose(html, from, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}\\s*>`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    if (m[0][1] === '/') {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

export function nextCellId(html) {
  const cells = findCells(html);
  let next = 1;
  for (const c of cells) {
    const n = parseInt(String(c.id || '').replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }
  return `c${next}`;
}