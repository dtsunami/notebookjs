import { findCells } from './cells.js';
import { findSlides } from './deck.js';

function titleOf(slideHtml) {
  const heading = slideHtml.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
  const raw = heading ? heading[1] : slideHtml;
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, 72) || 'Untitled slide';
}

/**
 * The unifying model. A deck is a linear sequence of slides; a notebook is a
 * linear sequence of cells. Here a slide simply *owns* the cells that fall
 * inside its byte range, so both views read from one structure.
 */
export function buildNotebook(html) {
  if (!html) return { blocks: [], orphans: [], cellCount: 0 };

  const slides = findSlides(html);
  const cells = findCells(html);

  const blocks = slides.map((s, index) => ({
    index,
    id: s.id,
    title: titleOf(s.html),
    start: s.start,
    end: s.end,
    cells: [],
  }));

  const orphans = [];

  for (const cell of cells) {
    const owner = blocks.find((b) => cell.start >= b.start && cell.start < b.end);
    if (owner) owner.cells.push(cell);
    else orphans.push(cell);
  }

  return { blocks, orphans, cellCount: cells.length };
}