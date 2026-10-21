import { getSlides } from './doc.js';
import {
  findCells,
  replaceCellSource,
  removeCell,
  insertCell,
} from '../src/lib/cells.js';

function slideFor(slides, offset) {
  for (const s of slides) {
    if (offset >= s.start && offset < s.end) return s.id;
  }
  return null;
}

const LANGS = new Set(['javascript', 'python']);

function normalizeLang(lang) {
  const v = String(lang || 'javascript').toLowerCase();
  if (v === 'js') return 'javascript';
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

export function createCell(html, { slideId, source, lang }) {
  const clean = String(source || '').trim();
  if (!clean) return { error: 'No cell source was provided.' };

  const slides = getSlides(html);
  const target = slideId || (slides.length ? slides[slides.length - 1].id : null);
  if (slideId && !slides.some((s) => s.id === slideId)) {
    return { error: `No slide with id "${slideId}". Call list_slides to get the current ids.` };
  }

  const before = new Set(findCells(html).map((c) => c.id).filter(Boolean));
  const next = insertCell(html, { slideId: target, lang: normalizeLang(lang), source: clean });
  const created = findCells(next).find((c) => c.id && !before.has(c.id));

  return { html: next, id: created ? created.id : null, slideId: target };
}

export function updateCell(html, { id, index }, source) {
  const cells = findCells(html);
  let cell = id ? cells.find((c) => c.id === id) : null;
  if (!cell && typeof index === 'number') cell = cells[index];
  if (!cell) {
    return { error: `No cell with id "${id}". Call list_cells to get the current ids.` };
  }
  if (typeof source !== 'string') return { error: 'No cell source was provided.' };

  return { html: replaceCellSource(html, { id: cell.id, index }, source), id: cell.id };
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