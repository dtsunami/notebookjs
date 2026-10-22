const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const NB_TYPE_RE = /type\s*=\s*["']text\/nb-cell["']/i;
const CELL_ID_RE = /data-cell-id\s*=\s*["']([^"']+)["']/i;
const LANG_RE = /data-lang\s*=\s*["']([^"']+)["']/i;
const EXEC_RE = /data-exec\s*=\s*["']([^"']+)["']/i;
const WRAP_CLASS_RE = /\bnb-cell\b/;

/**
 * A cell is stored as a `<script type="text/nb-cell">` wrapped in a
 * `<div class="nb-cell">` box. The script is the source of truth for the code;
 * the box is what you see, drag and resize. Bare scripts (older decks, or cells
 * the assistant wrote by hand) are still valid — ensureCellBoxes() upgrades
 * them in place, and the runtime falls back to a flow layout until it does.
 *
 * Geometry is kept in percent of the slide so a cell keeps its place when the
 * deck is projected at any resolution.
 */
export const DEFAULT_BOX = { x: 4, y: 4, w: 92, h: 12 };

export function unescapeSource(text) {
  return String(text || '').replace(/<\\\/script/gi, '</script');
}

export function escapeSource(text) {
  return String(text || '').replace(/<\/script/gi, '<\\/script');
}

function attr(attrs, name) {
  const m = String(attrs || '').match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function numberAttr(attrs, name) {
  const raw = attr(attrs, name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function matchingClose(html, from, tag) {
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

/**
 * If a script is the only child of a .nb-cell div, find that div.
 * Returns null for a bare script.
 */
function wrapperAround(html, scriptStart) {
  let i = scriptStart - 1;
  while (i >= 0 && /\s/.test(html[i])) i -= 1;
  if (i < 0 || html[i] !== '>') return null;

  const openStart = html.lastIndexOf('<div', i);
  if (openStart === -1) return null;
  const openEnd = html.indexOf('>', openStart) + 1;
  if (openEnd !== i + 1) return null;

  const attrs = html.slice(openStart + 4, openEnd - 1);
  if (!WRAP_CLASS_RE.test(attrs)) return null;

  const closeStart = matchingClose(html, openEnd, 'div');
  if (closeStart === -1) return null;

  return { openStart, openEnd, closeStart, closeEnd: closeStart + 6, attrs };
}

function boxOf(attrs) {
  const x = numberAttr(attrs, 'data-cell-x');
  const y = numberAttr(attrs, 'data-cell-y');
  const w = numberAttr(attrs, 'data-cell-w');
  const h = numberAttr(attrs, 'data-cell-h');
  if (x == null || y == null || w == null || h == null) return null;
  return { x, y, w, h };
}

function boxStyle(box) {
  return (
    `left:${box.x}%;top:${box.y}%;` +
    `width:${box.w}%;height:${box.h}%`
  );
}

function wrapperTag(id, box) {
  return (
    `<div class="nb-cell" data-cell-id="${id}" ` +
    `data-cell-x="${box.x}" data-cell-y="${box.y}" ` +
    `data-cell-w="${box.w}" data-cell-h="${box.h}" ` +
    `style="${boxStyle(box)}">`
  );
}

export function findCells(html) {
  const out = [];
  SCRIPT_RE.lastIndex = 0;
  let m;
  while ((m = SCRIPT_RE.exec(html))) {
    if (!NB_TYPE_RE.test(m[1])) continue;
    const openEnd = m.index + m[0].indexOf('>') + 1;
    const wrap = wrapperAround(html, m.index);
    const id = (attr(m[1], 'data-cell-id') || (wrap && attr(wrap.attrs, 'data-cell-id'))) || null;

    out.push({
      id,
      lang: (attr(m[1], 'data-lang') || 'javascript').toLowerCase(),
      exec: (attr(m[1], 'data-exec') || 'inline').toLowerCase(),
      source: unescapeSource(m[2]).replace(/^\n/, '').replace(/\s+$/, ''),
      box: wrap ? boxOf(wrap.attrs) : null,
      wrapper: wrap
        ? { start: wrap.openStart, end: wrap.closeEnd, openEnd: wrap.openEnd }
        : null,
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
 * Upgrade bare cell scripts into positioned boxes. Idempotent: a cell that
 * already has a wrapper is left exactly as it is. Assigns ids first, because
 * the wrapper is addressed by id.
 *
 * Boxes are staggered so a deck written before boxes existed does not stack
 * every cell at the same spot.
 */
export function ensureCellBoxes(html) {
  let out = ensureCellIds(html);
  const cells = findCells(out);
  const bare = cells.filter((c) => !c.wrapper);
  if (bare.length === 0) return out;

  const edits = [];
  bare.forEach((c, i) => {
    const box = {
      ...DEFAULT_BOX,
      y: Math.min(78, DEFAULT_BOX.y + i * (DEFAULT_BOX.h + 2)),
    };
    edits.push({ start: c.start, end: c.end, text: `${wrapperTag(c.id, box)}${out.slice(c.start, c.end)}</div>` });
  });

  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i];
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
  }
  return out;
}

/** Move or resize one cell. Unknown geometry keys are ignored. */
export function setCellGeometry(html, id, patch = {}) {
  const cell = findCells(html).find((c) => c.id === id);
  if (!cell) return html;

  const current = cell.box || DEFAULT_BOX;
  const box = fitBox({
    x: patch.x != null ? patch.x : current.x,
    y: patch.y != null ? patch.y : current.y,
    w: patch.w != null ? patch.w : current.w,
    h: patch.h != null ? patch.h : current.h,
  });

  if (!cell.wrapper) {
    // No wrapper yet: wrap the script with the requested geometry.
    return (
      html.slice(0, cell.start) +
      `${wrapperTag(cell.id, box)}${html.slice(cell.start, cell.end)}</div>` +
      html.slice(cell.end)
    );
  }

  const before = html.slice(0, cell.wrapper.start);
  const after = html.slice(cell.wrapper.end);
  const inner = html.slice(cell.wrapper.openEnd, cell.wrapper.end - 6);
  return `${before}${wrapperTag(cell.id, box)}${inner}</div>${after}`;
}

/**
 * Clamp a box so it is both in range *and* on the slide.
 *
 * Clamping each value on its own is not enough: x:100 with w:88 is each in
 * range, and leaves 88% of the cell hanging off the right edge where no one can
 * see or drag it. Width gives way to position, because a caller who asked for a
 * specific x meant it.
 */
/*
 * The *storage* floor, not the usability floor.
 *
 * This used to be 20 x 12 to match a hard minimum in the runtime's CSS. That
 * made persistence fight the operator: resizing a cell smaller than a fifth of
 * the slide was silently rewritten back to 20% on save, so the cell sprang
 * back on the next mount.
 *
 * The runtime now enforces usability at gesture time, in pixels, against the
 * live slide (MIN_PX_W / MIN_PX_H in runtime.js) and sheds bar controls rather
 * than clipping them. So all this layer has to guarantee is a box that is
 * positive and addressable — a 0%-wide cell is unrecoverable, a 5% one is not.
 */
export const MIN_W = 2;
export const MIN_H = 2;

function fitBox(raw) {
  const w = Math.max(MIN_W, Math.min(100, Number(raw.w) || DEFAULT_BOX.w));
  const h = Math.max(MIN_H, Math.min(100, Number(raw.h) || DEFAULT_BOX.h));
  const x = Math.max(0, Math.min(100 - w, Number(raw.x) || 0));
  const y = Math.max(0, Math.min(100 - h, Number(raw.y) || 0));
  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    w: Math.round(w * 100) / 100,
    h: Math.round(h * 100) / 100,
  };
}

/** Change a cell's language or execution model without touching its source. */
export function setCellMeta(html, id, patch = {}) {
  const cell = findCells(html).find((c) => c.id === id);
  if (!cell) return html;

  let head = html.slice(cell.start, cell.openEnd);
  if (patch.lang) {
    head = /data-lang\s*=/i.test(head)
      ? head.replace(/data-lang\s*=\s*["'][^"']*["']/i, `data-lang="${patch.lang}"`)
      : head.replace(/>$/, ` data-lang="${patch.lang}">`);
  }
  if (patch.exec) {
    head = /data-exec\s*=/i.test(head)
      ? head.replace(/data-exec\s*=\s*["'][^"']*["']/i, `data-exec="${patch.exec}"`)
      : head.replace(/>$/, ` data-exec="${patch.exec}">`);
  }
  return html.slice(0, cell.start) + head + html.slice(cell.openEnd);
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

  // Remove the whole box when there is one, so no empty frame is left behind.
  let start = cell.wrapper ? cell.wrapper.start : cell.start;
  let end = cell.wrapper ? cell.wrapper.end : cell.end;
  if (!cell.wrapper) {
    if (html[end] === '\n') end += 1;
    if (html[start - 1] === '\n' && html[start - 2] === '\n') start -= 1;
  }
  return `${html.slice(0, start)}${html.slice(end)}`;
}

/**
 * Insert a new cell box immediately before the closing tag of the given slide.
 * Falls back to before </body> when the slide can't be found.
 */
export function insertCell(
  html,
  { slideId, lang = 'javascript', exec = 'inline', source = '', box = null } = {},
) {
  const id = nextCellId(html);
  // Clamp here, the same way setCellGeometry does. A caller — usually a model
  // choosing x/y from a description — can pass 400, and an unclamped box is
  // off-slide forever with no way to see it.
  const want = {
    ...DEFAULT_BOX,
    y: Math.min(78, DEFAULT_BOX.y + countCells(html) * (DEFAULT_BOX.h + 2)),
    ...(box || {}),
  };
  const geo = fitBox(want);
  const block =
    `${wrapperTag(id, geo)}` +
    `<script type="text/nb-cell" data-cell-id="${id}" data-lang="${lang}" data-exec="${exec}">` +
    `\n${escapeSource(source)}\n</script></div>`;

  if (slideId) {
    const slideRe = /<(section|div)\b[^>]*data-slide-id\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = slideRe.exec(html))) {
      if (m[2] !== slideId) continue;
      const tag = m[1].toLowerCase();
      const openEnd = m.index + m[0].length;
      const close = matchingClose(html, openEnd, tag);
      if (close === -1) break;
      return `${html.slice(0, close)}${block}\n${html.slice(close)}`;
    }
  }

  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) return `${html.slice(0, bodyClose)}${block}\n${html.slice(bodyClose)}`;
  return `${html}\n${block}`;
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