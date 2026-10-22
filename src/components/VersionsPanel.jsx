import React, { useMemo, useState } from 'react';
import { findCells } from '../lib/cells.js';
import { findSlides } from '../lib/deck.js';
import { versionsOf } from '../lib/history.js';

/**
 * Per-thing version history.
 *
 * This does not keep its own history. It projects the document stack:
 * `versionsOf(snapshots, extract)` walks the snapshots and returns the states
 * that one cell or slide actually passed through. A drag that does not touch a
 * cell's source does not appear in that cell's list, because its source did
 * not change — which is exactly the behaviour a separate store would have to
 * reimplement, badly.
 *
 * Restoring an old version is an ordinary edit: it records a new snapshot, so
 * it is itself undoable and nothing is ever lost.
 */
function extractSlide(slideId) {
  return (html) => {
    const slide = findSlides(html).find((s) => s.id === slideId);
    return slide ? slide.html : null;
  };
}

function extractCell(cellId, what = 'source') {
  return (html) => {
    const cell = findCells(html).find((c) => c.id === cellId);
    if (!cell) return null;
    if (what === 'source') return cell.source;
    if (what === 'lang') return cell.lang;
    return cell.box ? `${cell.box.x},${cell.box.y},${cell.box.w},${cell.box.h}` : null;
  };
}

const stamp = (ms) => {
  try {
    return new Date(ms).toLocaleTimeString();
  } catch {
    return '';
  }
};

function VersionRow({ version, onRestore, active }) {
  const previewText = String(version.value).replace(/\s+/g, ' ').slice(0, 68);
  return (
    <li className={active ? 'version-row active' : 'version-row'}>
      <button
        type="button"
        className="version-restore"
        onClick={() => onRestore(version.value)}
        title={active ? 'This is the current state' : 'Restore this version'}
        disabled={active}
      >
        <span className="version-label">{version.label}</span>
        <span className="version-time">{stamp(version.at)}</span>
        <code className="version-preview">{previewText || '(empty)'}</code>
      </button>
    </li>
  );
}

export default function VersionsPanel({ html, entries, blocks, onRestoreSlide, onRestoreCell }) {
  const [scope, setScope] = useState('cells');

  const slides = useMemo(() => (blocks || []).filter((b) => b.id), [blocks]);
  const cells = useMemo(() => (html ? findCells(html).filter((c) => c.id) : []), [html]);

  /**
   * only versions whose value differs from the one before it. `versionsOf`
   * already collapses repeats, so this is just the list.
   */
  const slideVersions = useMemo(
    () =>
      slides.map((s) => ({ id: s.id, title: s.title, versions: versionsOf(entries, extractSlide(s.id)) })),
    [slides, entries],
  );

  const cellVersions = useMemo(
    () =>
      cells.map((c) => ({
        id: c.id,
        lang: c.lang,
        versions: versionsOf(entries, extractCell(c.id)),
      })),
    [cells, entries],
  );

  if (!entries || entries.length <= 1) {
    return (
      <p className="nav-empty">
        No versions yet. Every edit from here on is recorded — nothing is lost.
      </p>
    );
  }

  return (
    <div className="versions">
      <div className="versions-scope">
        <button
          type="button"
          className={scope === 'cells' ? 'ghost sm on' : 'ghost sm'}
          onClick={() => setScope('cells')}
        >
          Cells
        </button>
        <button
          type="button"
          className={scope === 'slides' ? 'ghost sm on' : 'ghost sm'}
          onClick={() => setScope('slides')}
        >
          Slides
        </button>
      </div>

      {scope === 'cells' &&
        (cellVersions.length === 0 ? (
          <p className="nav-empty">This deck has no cells.</p>
        ) : (
          cellVersions.map((c) => (
            <details key={c.id} className="version-group">
              <summary>
                <code>{c.id}</code>
                <span className="version-count">{c.versions.length}</span>
                <span className="muted sm">{c.lang}</span>
              </summary>
              <ul className="version-list">
                {c.versions.map((v, i) => (
                  <VersionRow
                    key={`${v.at}-${i}`}
                    version={v}
                    active={v.active}
                    onRestore={(source) => onRestoreCell?.(c.id, source)}
                  />
                ))}
              </ul>
            </details>
          ))
        ))}

      {scope === 'slides' &&
        (slideVersions.length === 0 ? (
          <p className="nav-empty">This deck has no slides.</p>
        ) : (
          slideVersions.map((s) => (
            <details key={s.id} className="version-group">
              <summary>
                <code>{s.id}</code>
                <span className="version-count">{s.versions.length}</span>
                <span className="muted sm">{s.title}</span>
              </summary>
              <ul className="version-list">
                {s.versions.map((v, i) => (
                  <VersionRow
                    key={`${v.at}-${i}`}
                    version={v}
                    active={v.active}
                    onRestore={(pageHtml) => onRestoreSlide?.(s.id, pageHtml)}
                  />
                ))}
              </ul>
            </details>
          ))
        ))}
    </div>
  );
}