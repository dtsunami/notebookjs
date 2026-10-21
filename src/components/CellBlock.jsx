import React, { useEffect, useRef, useState } from 'react';

const LEVEL_CLASS = {
  error: 'o-error',
  warn: 'o-warn',
  return: 'o-return',
  info: 'o-log',
  log: 'o-log',
};

/**
 * One notebook cell: prompt gutter, source, output. Source is held as a local
 * draft while focused so each keystroke does not rewrite the whole document.
 */
export default function CellBlock({ cell, record, busy, onEdit, onRun, onDelete }) {
  const [draft, setDraft] = useState(null);
  const areaRef = useRef(null);

  const value = draft ?? cell.source;
  const entries = record.entries || [];
  const isKernel = (cell.exec || 'inline') === 'kernel';

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 520)}px`;
  }, [value]);

  const commit = () => {
    if (draft != null && draft !== cell.source) onEdit(draft);
    setDraft(null);
  };

  const run = () => {
    if (draft != null && draft !== cell.source) onEdit(draft);
    setDraft(null);
    onRun();
  };

  return (
    <div
      className={`cellb${busy ? ' busy' : ''}${isKernel ? '' : ' inline'}`}
      data-cell-anchor={cell.id}
    >
      <div className="cellb-gutter">
        <button
          type="button"
          className="cellb-play"
          onClick={run}
          disabled={busy}
          title={isKernel ? 'Run on the kernel (⌘↵)' : 'Run in the preview (⌘↵)'}
        >
          {busy ? <span className="spin" /> : '▶'}
        </button>
        <span className="cellb-prompt">
          {busy ? '[*]' : record.seq != null ? `[${record.seq}]` : '[ ]'}
        </span>
      </div>

      <div className="cellb-body">
        <div className="cellb-bar">
          <span className="cellb-lang">{cell.lang || 'javascript'}</span>
          {!isKernel && <span className="cellb-tag">inline</span>}
          <span className="cellb-id">{cell.id}</span>
          {record.ms != null && <span className="cellb-ms">{record.ms} ms</span>}
          <button type="button" className="cellb-x" onClick={onDelete} title="Delete cell">
            ×
          </button>
        </div>

        <textarea
          ref={areaRef}
          className="cellb-src"
          value={value}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              run();
            }
          }}
        />

        {(entries.length > 0 || record.error) && (
          <div className="cellb-out">
            {record.error && <div className="o-error">{record.error}</div>}
            {entries.map((entry, i) => (
              <div key={i} className={LEVEL_CLASS[entry.level] || 'o-log'}>
                {entry.level === 'return' ? '⇒ ' : ''}
                {entry.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}