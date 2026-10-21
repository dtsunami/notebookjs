import React from 'react';

/**
 * The open document's structure: slides, each expanding to its cells.
 * Clicking a slide navigates the deck; clicking a cell scrolls the notebook.
 */
export default function StructureTree({
  blocks,
  orphans,
  currentIndex,
  onSelectSlide,
  onSelectCell,
  onAddCell,
}) {
  if (!blocks || blocks.length === 0) {
    return <p className="struct-empty">No slides in this document.</p>;
  }

  return (
    <div className="struct">
      {blocks.map((block) => {
        const active = block.index === currentIndex;
        return (
          <div key={block.id || block.index} className={active ? 'struct-slide active' : 'struct-slide'}>
            <button type="button" className="struct-head" onClick={() => onSelectSlide(block.index)}>
              <span className="struct-num">{block.index + 1}</span>
              <span className="struct-title">{block.title}</span>
              <span className="struct-count">{block.cells.length || ''}</span>
            </button>

            {active && (
              <ul className="struct-cells">
                {block.cells.map((cell) => (
                  <li key={cell.id}>
                    <button type="button" onClick={() => onSelectCell(cell.id)}>
                      <span className={`struct-dot ${cell.exec === 'kernel' ? 'kernel' : 'inline'}`} />
                      <span className="struct-cell-id">{cell.id}</span>
                      <span className="struct-cell-src">
                        {(cell.source || '').trim().split('\n')[0].slice(0, 28) || 'empty'}
                      </span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className="struct-add" onClick={() => onAddCell(block.id)}>
                    + cell
                  </button>
                </li>
              </ul>
            )}
          </div>
        );
      })}

      {orphans.length > 0 && (
        <div className="struct-slide">
          <div className="struct-head static">
            <span className="struct-num">·</span>
            <span className="struct-title">Unattached cells</span>
            <span className="struct-count">{orphans.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}