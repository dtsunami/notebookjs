import React, { useEffect, useState } from 'react';

const LEVEL_CLASS = {
  error: 'out-error',
  warn: 'out-warn',
  return: 'out-return',
  info: 'out-log',
  log: 'out-log',
};

/**
 * Two execution models coexist:
 *   exec="kernel"  runs only when the human presses Run (server kernel, state
 *                  persists between cells, output shown here)
 *   exec="inline"  runs inside the preview when the slide renders (no state,
 *                  output lands in the page, not here)
 */
export default function CellsPanel({
  cells,
  outputs,
  running,
  kernel,
  onEdit,
  onRun,
  onRunAll,
  onRestart,
  onAdd,
  onDelete,
}) {
  const [drafts, setDrafts] = useState({});
  const [open, setOpen] = useState({});

  useEffect(() => {
    setDrafts((prev) => {
      const live = new Set(cells.map((c, i) => c.id || `cell-${i}`));
      const keys = Object.keys(prev);
      if (keys.every((k) => live.has(k))) return prev;
      const next = {};
      for (const k of keys) if (live.has(k)) next[k] = prev[k];
      return next;
    });
  }, [cells]);

  const toggle = (id) => setOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const commit = (cell, index, id) => {
    const draft = drafts[id];
    if (draft != null && draft !== cell.source) onEdit(cell, index, draft);
    setDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const run = (cell, index, id) => {
    commit(cell, index, id);
    onRun(cell, id);
  };

  return (
    <div className="panel-body cells-panel">
      <div className="panel-section cells-head">
        <div>
          <h4>Notebook cells</h4>
          <p className="panel-hint">
            Kernel cells run on the server and keep state between runs. <code>⌘↵</code> runs one.
          </p>
        </div>
        <div className="panel-actions tight">
          <button type="button" onClick={onAdd}>+ Cell</button>
          <button type="button" className="ghost" onClick={onRunAll} disabled={cells.length === 0}>
            Run all
          </button>
        </div>
      </div>

      <div className="kernel-bar">
        <span className={kernel ? 'kernel-dot on' : 'kernel-dot'} />
        <span className="kernel-label">
          {kernel
            ? `kernel active · ${kernel.seq} run${kernel.seq === 1 ? '' : 's'}`
            : 'kernel idle · starts on first run'}
        </span>
        <button type="button" className="link" onClick={onRestart}>
          restart &amp; clear
        </button>
      </div>

      {cells.length === 0 && (
        <p className="panel-hint">
          No cells yet. Add one, or write <code>{'<script type="text/nb-cell">'}</code> by hand in
          the code tab.
        </p>
      )}

      {cells.map((cell, i) => {
        const id = cell.id || `cell-${i}`;
        const record = outputs[id] || {};
        const entries = record.entries || [];
        const isOpen = open[id] ?? true;
        const value = drafts[id] ?? cell.source;
        const lines = value.split('\n').length;
        const busy = running[id];
        const isKernel = (cell.exec || 'inline') === 'kernel';

        return (
          <div className={isKernel ? 'cell kernel' : 'cell'} key={id}>
            <div className="cell-bar">
              <button type="button" className="cell-id" onClick={() => toggle(id)}>
                {isOpen ? '▾' : '▸'} {id}
              </button>
              <span className="cell-meta">
                {cell.lang || 'javascript'} · {lines} lines
                {!isKernel && ' · inline'}
              </span>
              <button type="button" className="link" onClick={() => onDelete(cell, i)}>
                delete
              </button>
              <button
                type="button"
                className="cell-run"
                onClick={() => run(cell, i, id)}
                disabled={busy}
              >
                {busy ? '…' : 'Run'}
              </button>
            </div>

            <textarea
              className="cell-source"
              value={value}
              spellCheck={false}
              rows={Math.min(16, Math.max(3, lines))}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [id]: e.target.value }))}
              onBlur={() => commit(cell, i, id)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  run(cell, i, id);
                }
              }}
            />

            {isOpen && (
              <div className="cell-output">
                {record.error && <div className="out-error">{record.error}</div>}
                {!record.error && entries.length === 0 && (
                  <span className="out-empty">
                    {isKernel ? 'not run yet' : 'inline cell — output renders in the slide'}
                  </span>
                )}
                {entries.map((entry, j) => (
                  <div key={j} className={LEVEL_CLASS[entry.level] || 'out-log'}>
                    {entry.level === 'return' ? '⇒ ' : ''}
                    {entry.text}
                  </div>
                ))}
                {record.ms != null && (
                  <div className="out-timing">{record.ms} ms</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}