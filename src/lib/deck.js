const CLASS_RE = /\bclass\s*=\s*("([^"]*)"|'([^']*)')/i;
const ID_RE = /data-slide-id\s*=\s*["']([^"']+)["']/;

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

export function findSlides(html) {
  const tagRe = /<(section|div)\b[^>]*>/gi;
  const out = [];
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = m[1].toLowerCase();
    const classMatch = m[0].match(CLASS_RE);
    if (!classMatch) continue;
    const tokens = (classMatch[2] ?? classMatch[3] ?? '').split(/\s+/).filter(Boolean);
    if (!tokens.includes('slide')) continue;

    const openEnd = m.index + m[0].length;
    const closeStart = matchingClose(html, openEnd, tag);
    if (closeStart === -1) continue;
    const closeEnd = closeStart + tag.length + 3;
    const idMatch = m[0].match(ID_RE);

    out.push({
      id: idMatch ? idMatch[1] : null,
      start: m.index,
      end: closeEnd,
      tag,
      html: html.slice(m.index, closeEnd),
    });
    tagRe.lastIndex = closeEnd;
  }
  return out;
}

/**
 * Appends an empty slide after the last one, inside the deck container.
 * The new slide gets a fresh id so the outline and the assistant can address
 * it immediately. Returns null when no slide can be found to anchor to.
 */
export function appendSlide(html, { title = 'New slide', body = 'Add content here.' } = {}) {
  if (!html) return null;

  const slides = findSlides(html);
  const used = new Set(slides.map((s) => s.id).filter(Boolean));
  let n = 1;
  while (used.has(`s${n}`)) n += 1;

  const slide = `<section class="slide" data-slide-id="s${n}">\n  <h2>${title}</h2>\n  <p>${body}</p>\n</section>`;

  if (slides.length > 0) {
    const last = slides[slides.length - 1];
    return `${html.slice(0, last.end)}\n${slide}${html.slice(last.end)}`;
  }

  // No slides at all: insert before </body>, or append as a last resort.
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) return `${html.slice(0, bodyClose)}${slide}\n${html.slice(bodyClose)}`;
  return `${html}\n${slide}`;
}

/**
 * Moves one slide relative to another, preserving both exactly.
 * Returns null if either id is missing.
 */
export function moveSlideById(html, id, anchorId, position = 'after') {
  if (!id || !anchorId || id === anchorId) return null;

  const slides = findSlides(html);
  const moving = slides.find((s) => s.id === id);
  if (!moving) return null;

  const chunk = html.slice(moving.start, moving.end);
  let without = html.slice(0, moving.start) + html.slice(moving.end);
  without = without.replace(/\n{3,}/g, '\n\n');

  const rest = findSlides(without);
  const anchor = rest.find((s) => s.id === anchorId);
  if (!anchor) return null;

  const at = position === 'after' ? anchor.end : anchor.start;
  return `${without.slice(0, at)}\n${chunk}\n${without.slice(at)}`;
}