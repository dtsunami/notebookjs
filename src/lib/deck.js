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