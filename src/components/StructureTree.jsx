import React from 'react';

/**
 * The open document's structure: slides, each expanding to its cells.
 * Clicking a slide navigates the deck; clicking a cell selects it in the stage.
 *
 * Each cell also carries the three controls that matter when a cell is hard to
 * reach in the slide itself — run, stop, delete. The in-slide chrome is the
 * primary surface for these, but a cell can be small, overlapped, or on a slide
 * you are not looking at, and "I cannot delete this cell" should never be true.
 * Run flips to Stop while that cell is executing, exactly as the in-cell button
 * does, so the two surfaces never disagree.
 */
export default function StructureTree({
  blocks,
  orphans,
  currentIndex,
  selectedCellId,
  running = {},
  onSelectSlide,
  onSelectCell,
  onAddCell,
  onRunCell,
  onInterruptCell,
  onDeleteCell,
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
                {block.cells.map((cell) => {
                  const busy = !!running[cell.id];
                  return (
                    <li
                      key={cell.id}
                      className={
                        'struct-cell' +
                        (cell.id === selectedCellId ? ' selected' : '') +
                        (busy ? ' busy' : '')
                      }
                    >
                      <button
                        type="button"
                        className="struct-cell-open"
                        onClick={() => onSelectCell(cell.id)}
                        title={`Select ${cell.id} in the slide`}
                      >
                        <span className={`struct-dot ${cell.exec === 'kernel' ? 'kernel' : 'inline'}`} />
                        <span className="struct-cell-id">{cell.id}</span>
                        <span className="struct-cell-src">
                          {(cell.source || '').trim().split('\n')[0].slice(0, 28) || 'empty'}
                        </span>
                      </button>

                      <span className="struct-cell-acts">
                        {busy ? (
                          <button
                            type="button"
                            className="struct-act stop"
                            title="Stop this cell (restarts its kernel)"
                            aria-label={`Stop ${cell.id}`}
                            onClick={() => onInterruptCell?.(cell.id)}
                          >
                            ■
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="struct-act run"
                            title="Run this cell"
                            aria-label={`Run ${cell.id}`}
                            onClick={() => onRunCell?.(cell.id)}
                          >
                            ▶
                          </button>
                        )}
                        <button
                          type="button"
                          className="struct-act del"
                          title="Delete this cell"
                          aria-label={`Delete ${cell.id}`}
                          onClick={() => onDeleteCell?.(cell.id)}
                        >
                          ×
                        </button>
                      </span>
                    </li>
                  );
                })}
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