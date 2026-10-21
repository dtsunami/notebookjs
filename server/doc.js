const TAG_RE = /<(section|div)\b[^>]*>/gi;
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
  const out = [];
  TAG_RE.lastIndex = 0;
  let m;
  while ((m = TAG_RE.exec(html))) {
    const tag = m[1].toLowerCase();
    const classMatch = m[0].match(CLASS_RE);
    if (!classMatch) {
      TAG_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    const tokens = (classMatch[2] ?? classMatch[3] ?? '').split(/\s+/).filter(Boolean);
    if (!tokens.includes('slide')) {
      TAG_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    const openEnd = m.index + m[0].length;
    const closeStart = matchingClose(html, openEnd, tag);
    if (closeStart === -1) {
      TAG_RE.lastIndex = openEnd;
      continue;
    }
    const closeEnd = closeStart + tag.length + 3;
    out.push({
      tag,
      openStart: m.index,
      openEnd,
      closeStart,
      closeEnd,
      html: html.slice(m.index, closeEnd),
    });
    TAG_RE.lastIndex = closeEnd;
  }
  return out;
}

export function getSlides(html) {
  return findSlides(html).map((s) => {
    const m = s.html.match(ID_RE);
    return { id: m ? m[1] : null, start: s.openStart, end: s.closeEnd, html: s.html };
  });
}

export function ensureSlideIds(html) {
  const found = findSlides(html);
  const used = new Set();
  let next = 1;

  for (const s of found) {
    const m = s.html.match(ID_RE);
    if (!m) continue;
    used.add(m[1]);
    const n = parseInt(String(m[1]).replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n >= next) next = n + 1;
  }

  const edits = [];
  for (const s of found) {
    if (ID_RE.test(s.html)) continue;
    let id;
    do {
      id = `s${next++}`;
    } while (used.has(id));
    used.add(id);
    edits.push({ at: s.openStart + s.tag.length + 1, text: ` data-slide-id="${id}"` });
  }

  let out = html;
  for (let i = edits.length - 1; i >= 0; i--) {
    out = out.slice(0, edits[i].at) + edits[i].text + out.slice(edits[i].at);
  }
  return out;
}

function textPreview(slideHtml, max = 70) {
  const text = slideHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function listSlides(html) {
  return getSlides(html).map((s, index) => ({
    index,
    id: s.id,
    preview: textPreview(s.html),
    chars: s.html.length,
  }));
}

export function readSlide(html, id) {
  const slides = getSlides(html);
  const index = slides.findIndex((s) => s.id === id);
  if (index === -1) {
    return { error: `No slide with id "${id}". Call list_slides to get the current ids.` };
  }
  return { html: slides[index].html, index };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let at = 0;
  while ((at = haystack.indexOf(needle, at)) !== -1) {
    count += 1;
    at += needle.length;
  }
  return count;
}

export function replaceInSlide(html, id, oldText, newText) {
  const slides = getSlides(html);
  const slide = slides.find((s) => s.id === id);
  if (!slide) {
    return { error: `No slide with id "${id}". Call list_slides to get the current ids.` };
  }
  if (typeof oldText !== 'string' || oldText.length === 0) {
    return { error: 'The "old" argument is empty.' };
  }

  const count = countOccurrences(slide.html, oldText);
  if (count === 0) {
    return {
      error: `"old" was not found in slide ${id}. Call read_slide and copy the exact text, including indentation and whitespace.`,
    };
  }
  if (count > 1) {
    return {
      error: `"old" occurs ${count} times in slide ${id}. Extend it with surrounding lines so it is unique.`,
    };
  }

  const updated = slide.html.replace(oldText, newText);
  return { html: html.slice(0, slide.start) + updated + html.slice(slide.end) };
}

export function insertSlide(html, { after, before, content }) {
  const clean = String(content || '').trim();
  if (!clean) return { error: 'No slide markup was provided.' };

  const classMatch = clean.match(CLASS_RE);
  const tokens = classMatch ? (classMatch[2] ?? classMatch[3] ?? '').split(/\s+/).filter(Boolean) : [];
  if (!tokens.includes('slide')) {
    return { error: 'The new slide markup must carry class="slide" on its outermost element.' };
  }

  const slides = getSlides(html);
  let at = null;

  if (after) {
    const target = slides.find((s) => s.id === after);
    if (!target) return { error: `No slide with id "${after}" to insert after.` };
    at = target.end;
  } else if (before) {
    const target = slides.find((s) => s.id === before);
    if (!target) return { error: `No slide with id "${before}" to insert before.` };
    at = target.start;
  } else if (slides.length > 0) {
    at = slides[slides.length - 1].end;
  } else {
    const deck = html.search(/<div[^>]*\bid\s*=\s*["']deck["'][^>]*>/i);
    if (deck !== -1) {
      at = html.indexOf('>', deck) + 1;
    } else {
      const body = html.search(/<\/body>/i);
      at = body === -1 ? html.length : body;
    }
  }

  return { html: `${html.slice(0, at)}\n${clean}\n${html.slice(at)}` };
}

export function deleteSlide(html, id) {
  const slides = getSlides(html);
  if (slides.length <= 1) {
    return { error: 'Cannot delete the only slide in the deck. A deck must contain at least one slide.' };
  }
  const slide = slides.find((s) => s.id === id);
  if (!slide) return { error: `No slide with id "${id}".` };

  let end = slide.end;
  if (html[end] === '\n') end += 1;
  return { html: html.slice(0, slide.start) + html.slice(end), deleted: id };
}

export function moveSlide(html, id, { after, before }) {
  const slides = getSlides(html);
  const slide = slides.find((s) => s.id === id);
  if (!slide) return { error: `No slide with id "${id}".` };

  const anchorId = after || before;
  if (!anchorId) return { error: 'Provide either "after" or "before".' };
  if (anchorId === id) return { error: 'Cannot move a slide relative to itself.' };

  const chunk = html.slice(slide.start, slide.end);
  const without = html.slice(0, slide.start) + html.slice(slide.end);

  const rest = getSlides(without);
  const anchor = rest.find((s) => s.id === anchorId);
  if (!anchor) return { error: `No slide with id "${anchorId}" to move relative to.` };

  const at = after ? anchor.end : anchor.start;
  return { html: `${without.slice(0, at)}\n${chunk}\n${without.slice(at)}` };
}

export function setDeckStyle(html, css) {
  const block = `<style id="deck-overrides">\n${String(css || '').trim()}\n</style>`;
  const re = /<style\s+id\s*=\s*["']deck-overrides["'][^>]*>[\s\S]*?<\/style>/i;
  if (re.test(html)) return { html: html.replace(re, block) };

  const head = html.search(/<\/head>/i);
  if (head !== -1) return { html: `${html.slice(0, head)}${block}\n${html.slice(head)}` };
  return { html: `${block}\n${html}` };
}

export function getDeckStyle(html) {
  const m = html.match(/<style\s+id\s*=\s*["']deck-overrides["'][^>]*>([\s\S]*?)<\/style>/i);
  return m ? m[1].trim() : '';
}