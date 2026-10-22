/**
 * Document history.
 *
 * A deck is one HTML string and every edit is a string transform, so history
 * lives at the document level. Per-cell and per-slide versioning are
 * *projections* of this one stack (see versionsOf) rather than parallel stores:
 * a cell is a substring of the document, and two histories of the same text
 * will disagree eventually.
 *
 * The one hard problem is granularity. Dragging a box posts geometry on every
 * mousemove and typing posts source on every keystroke; a naive stack would
 * hold hundreds of one-pixel steps. Consecutive edits carrying the same label
 * inside `coalesceMs` collapse into one entry, so a drag is one undo.
 */

export function createHistory({ limit = 120, coalesceMs = 700, now = () => Date.now() } = {}) {
  /** @type {Array<{html: string, label: string, at: number}>} */
  const entries = [];
  let index = -1;

  const tip = () => entries[index] || null;
  const at = () => now();

  return {
    /** Drop everything and start from this document. */
    reset(html, label = 'open') {
      entries.length = 0;
      index = -1;
      if (typeof html === 'string') {
        entries.push({ html, label, at: at() });
        index = 0;
      }
    },

    /**
     * Record a new state. Identical html is ignored, and the same label inside
     * the coalesce window replaces the tip instead of stacking.
     * @returns {boolean} whether anything changed
     */
    record(html, label = 'edit') {
      if (typeof html !== 'string') return false;
      const t = tip();
      if (t && t.html === html) return false;
      const stamp = at();

      // Editing after an undo discards the redo branch — the usual model.
      if (index < entries.length - 1) entries.splice(index + 1);

      if (t && t.label === label && stamp - t.at < coalesceMs) {
        t.html = html;
        t.at = stamp;
        return true;
      }

      entries.push({ html, label, at: stamp });
      if (entries.length > limit) entries.shift();
      index = entries.length - 1;
      return true;
    },

    /** @returns {string|null} the document to restore, or null at the start */
    undo() {
      if (index <= 0) return null;
      index -= 1;
      return entries[index].html;
    },

    /** @returns {string|null} the document to restore, or null at the tip */
    redo() {
      if (index >= entries.length - 1) return null;
      index += 1;
      return entries[index].html;
    },

    canUndo() {
      return index > 0;
    },

    canRedo() {
      return index < entries.length - 1;
    },

    /** What undo would reverse, for a tooltip. */
    undoLabel() {
      return index > 0 ? entries[index].label : '';
    },

    redoLabel() {
      return index < entries.length - 1 ? entries[index + 1].label : '';
    },

    entries() {
      return entries.map((e, i) => ({ ...e, active: i === index }));
    },

    current() {
      return tip() ? tip().html : null;
    },

    size() {
      return entries.length;
    },
  };
}

/**
 * The versions of one thing across the document history.
 *
 * `extract(html)` returns the value to track — a cell's source, a slide's
 * markup — or null when the thing is absent from that snapshot. Repeated
 * values are dropped, so the result is the list of states that thing actually
 * passed through, in order.
 *
 * @param {Array<{html: string, label: string, at: number, active?: boolean}>} entries
 * @param {(html: string) => string|null|undefined} extract
 */
export function versionsOf(entries, extract) {
  const out = [];
  let prev;
  for (const e of entries) {
    let value;
    try {
      value = extract(e.html);
    } catch {
      // A snapshot the extractor cannot parse (a half-typed document) is not a
      // version of this thing; skip it rather than break the whole list.
      continue;
    }
    if (value == null) {
      prev = null;
      continue;
    }
    if (value === prev) continue;
    prev = value;
    out.push({ at: e.at, label: e.label, value, active: !!e.active });
  }
  return out;
}