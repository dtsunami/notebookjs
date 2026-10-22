import React, { useMemo, useState } from 'react';
import SlideThumb from './SlideThumb.jsx';
import { slideThumbDoc } from '../lib/notebook.js';

/**
 * Horizontal filmstrip of slides under the stage.
 *
 * Each thumbnail is a separate read-only document (see slideThumbDoc) with no
 * runtime, so nothing in the strip can execute a cell a second time. Clicking
 * one navigates the real slide; dragging one reorders the deck through the
 * same handleReorder the nav used to use.
 *
 * The strip is a fixed-height rail so the stage never resizes when a slide is
 * added: it scrolls sideways instead.
 */
export default function Timeline({
  html,
  slides,
  currentIndex,
  onSelect,
  onReorder,
  onNewSlide,
  onCollapse,
}) {
  const [dragFrom, setDragFrom] = useState(null);
  const [overTo, setOverTo] = useState(null);

  // One document per slide, rebuilt only when the deck changes. Keyed by id so
  // reordering reuses the documents instead of re-parsing every time.
  const docs = useMemo(() => {
    const map = {};
    for (const s of slides) map[s.id] = slideThumbDoc(html, s.id);
    return map;
  }, [html, slides]);

  const drop = (to) => {
    if (dragFrom != null && to != null && dragFrom !== to) onReorder?.(dragFrom, to);
    setDragFrom(null);
    setOverTo(null);
  };

  return (
    <div className="timeline" role="list" aria-label="Slide timeline">
      <div className="timeline-strip">
        {slides.map((s, i) => (
          <div
            key={s.id || i}
            role="listitem"
            className={
              'timeline-slot' +
              (i === currentIndex ? ' current' : '') +
              (overTo === i && dragFrom !== null && dragFrom !== i ? ' drop-target' : '') +
              (dragFrom === i ? ' dragging' : '')
            }
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = 'move';
              // Firefox needs data set for a drag to start at all.
              try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* ignore */ }
            }}
            onDragOver={(e) => {
              if (dragFrom == null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (overTo !== i) setOverTo(i);
            }}
            onDragLeave={() => setOverTo((v) => (v === i ? null : v))}
            onDrop={(e) => {
              e.preventDefault();
              drop(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setOverTo(null);
            }}
            onClick={() => onSelect?.(i)}
            title={s.title || `Slide ${i + 1}`}
          >
            <span className="timeline-num">{i + 1}</span>
            <SlideThumb doc={docs[s.id]} label={s.title || `Slide ${i + 1}`} />
          </div>
        ))}

        <button
          type="button"
          className="timeline-add"
          onClick={() => onNewSlide?.()}
          title="Add a slide after the last one"
        >
          <span aria-hidden="true">+</span>
          <span className="timeline-add-label">Slide</span>
        </button>
      </div>

      {onCollapse && (
        <button
          type="button"
          className="timeline-fold"
          onClick={onCollapse}
          title="Hide the timeline"
          aria-label="Hide the timeline"
        >
          ⌄
        </button>
      )}
    </div>
  );
}