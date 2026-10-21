import React from 'react';

export default function SlideOutline({ outline, current, onSelect, onReorder }) {
  if (!outline || outline.length === 0) {
    return <div className="outline-empty">No slides yet.</div>;
  }

  const handleDrop = (fromIndex) => (e) => {
    e.preventDefault();
    const toIndex = Number(e.currentTarget.dataset.index);
    if (Number.isNaN(toIndex) || toIndex === fromIndex) return;
    onReorder?.(fromIndex, toIndex);
  };

  return (
    <ol className="outline">
      {outline.map((s, i) => (
        <li
          key={`${s.id || 'slide'}-${i}`}
          data-index={i}
          className={i === current ? 'outline-item active' : 'outline-item'}
          draggable
          onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop(i)}
        >
          <button type="button" className="outline-btn" onClick={() => onSelect?.(i)}>
            <span className="outline-num">{i + 1}</span>
            <span className="outline-title">{s.title || '(empty slide)'}</span>
            {s.id && <span className="outline-id">{s.id}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}