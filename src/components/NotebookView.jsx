import React from 'react';
import CellBlock from './CellBlock.jsx';

/**
 * The notebook projection: slides stacked vertically, each owning its cells.
 * Selecting a block drives the shared deck preview, so the two views stay in
 * sync without a second iframe per slide.
 */
export default function NotebookView({
  blocks,
  orphans,
  currentIndex,
  onSelect,
  outputs,
  running,
  onEdit,
  onRun,
  onDelete,
  onAddCell,
}) {
  if (blocks.length === 0) {
    return (
      <div className="nb-empty">
        <p>No slides yet.</p>
        <p className="dim">Ask the assistant to create one, or write HTML in the Code tab.</p>
      </div>
    );
  }

  return (
    <div className="nb-scroll">
      {blocks.map((block) => {
        const active = block.index === currentIndex;
        return (
          <section
            key={block.id || block.index}
            className={active ? 'nb-block active' : 'nb-block'}
            onClick={() => onSelect?.(block.index)}
          >
            <header className="nb-block-head">
              <span className="nb-num">{block.index + 1}</span>
              <span className="nb-title">{block.title}</span>
              <span className="nb-slide-id">{block.id}</span>
              <button
                type="button"
                className="nb-add"
                title="Add a cell to this slide"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddCell?.(block.id);
                }}
              >
                + cell
              </button>
            </header>

            {block.cells.length === 0 ? (
              <p className="nb-nocells">No cells on this slide.</p>
            ) : (
              <div className="nb-cells">
                {block.cells.map((cell, i) => (
                  <CellBlock
                    key={cell.id || `${block.id}-${i}`}
                    cell={cell}
                    record={outputs[cell.id] || {}}
                    busy={!!running[cell.id]}
                    onEdit={(source) => onEdit(cell, source)}
                    onRun={() => onRun(cell)}
                    onDelete={() => onDelete(cell)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {orphans.length > 0 && (
        <section className="nb-block orphans">
          <header className="nb-block-head">
            <span className="nb-num">·</span>
            <span className="nb-title">Cells outside any slide</span>
          </header>
          <div className="nb-cells">
            {orphans.map((cell, i) => (
              <CellBlock
                key={cell.id || `orphan-${i}`}
                cell={cell}
                record={outputs[cell.id] || {}}
                busy={!!running[cell.id]}
                onEdit={(source) => onEdit(cell, source)}
                onRun={() => onRun(cell)}
                onDelete={() => onDelete(cell)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}