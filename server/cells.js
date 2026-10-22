import { getSlides } from './doc.js';
import {
  findCells,
  replaceCellSource,
  removeCell,
  insertCell,
  setCellGeometry,
} from '../src/lib/cells.js';

function slideFor(slides, offset) {
  for (const s of slides) {
    if (offset >= s.start && offset < s.end) return s.id;
  }
  return null;
}

// Mirrors the kernel registry in server/kernel/languages.js. A language here
// that the kernel cannot run produces a cell that fails on first run, so the
// two lists are kept in step by the smoke-kernel unsupported-language check.
export const CELL_LANGS = ['javascript', 'typescript', 'python', 'ruby'];
const LANGS = new Set(CELL_LANGS);
const ALIASES = { js: 'javascript', ts: 'typescript', py: 'python', rb: 'ruby' };

function normalizeLang(lang) {
  const raw = String(lang || 'javascript').toLowerCase().trim();
  const v = ALIASES[raw] || raw;
  return LANGS.has(v) ? v : 'javascript';
}

function preview(source, max = 70) {
  const text = String(source || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function listCells(html) {
  const slides = getSlides(html);
  return findCells(html).map((c) => ({
    id: c.id,
    lang: c.lang || 'javascript',
    slideId: slideFor(slides, c.start),
    // Placement is part of a cell's identity now that it is a positioned box;
    // without it the model cannot see that two cells overlap.
    box: c.box,
    preview: preview(c.source),
    chars: c.source.length,
  }));
}

export function readCell(html, id) {
  const cell = findCells(html).find((c) => c.id === id);
  if (!cell) {
    return { error: `No cell with id "${id}". Call list_cells to get the current ids.` };
  }
  return { id: cell.id, lang: cell.lang || 'javascript', source: cell.source };
}

export function createCell(html, { slideId, source, lang, box }) {
  const clean = String(source || '').trim();
  if (!clean) return { error: 'No cell source was provided.' };

  const slides = getSlides(html);
  const target = slideId || (slides.length ? slides[slides.length - 1].id : null);
  if (slideId && !slides.some((s) => s.id === slideId)) {
    return { error: `No slide with id "${slideId}". Call list_slides to get the current ids.` };
  }

  // Optional explicit placement. A model that wants a cell under a heading has
  // no other way to say so; without this every cell lands at the staggered
  // default and piles up in the same corner. Values are clamped by
  // insertCell -> wrapperTag, so a bad number cannot produce an off-slide box.
  let geo = null;
  if (box && typeof box === 'object') {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const x = num(box.x);
    const y = num(box.y);
    const w = num(box.w);
    const h = num(box.h);
    if (x != null && y != null && w != null && h != null) geo = { x, y, w, h };
    else if (x != null || y != null) {
      return { error: 'Placement needs all four of x, y, w, h (percent of the slide), or none.' };
    }
  }

  const before = new Set(findCells(html).map((c) => c.id).filter(Boolean));
  // exec:'kernel' so the cell keeps state across runs, which is the whole point
  // of a notebook cell. The model cannot execute it either way.
  const wantLang = normalizeLang(lang);
  const next = insertCell(html, {
    slideId: target,
    lang: wantLang,
    exec: 'kernel',
    source: clean,
    box: geo,
  });
  const created = findCells(next).find((c) => c.id && !before.has(c.id));

  return { html: next, id: created ? created.id : null, slideId: target, lang: wantLang };
}

export function updateCell(html, { id, index, box }, source) {
  const cells = findCells(html);
  let cell = id ? cells.find((c) => c.id === id) : null;
  if (!cell && typeof index === 'number') cell = cells[index];
  if (!cell) {
    return { error: `No cell with id "${id}". Call list_cells to get the current ids.` };
  }
  if (typeof source !== 'string') return { error: 'No cell source was provided.' };

  let next = replaceCellSource(html, { id: cell.id, index }, source);

  // Moving is a separate edit on the wrapper, applied after the source so the
  // byte offsets of the script body are already settled.
  if (box && typeof box === 'object') {
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const geo = { x: num(box.x), y: num(box.y), w: num(box.w), h: num(box.h) };
    if (geo.x == null || geo.y == null || geo.w == null || geo.h == null) {
      return { error: 'Placement needs all four of x, y, w, h (percent of the slide).' };
    }
    next = setCellGeometry(next, cell.id, geo);
  }

  return { html: next, id: cell.id };
}

export function deleteCell(html, { id, index }) {
  const cells = findCells(html);
  let cell = id ? cells.find((c) => c.id === id) : null;
  if (!cell && typeof index === 'number') cell = cells[index];
  if (!cell) {
    return { error: `No cell with id "${id}". Call list_cells to get the current ids.` };
  }

  return { html: removeCell(html, { id: cell.id, index }), id: cell.id };
}