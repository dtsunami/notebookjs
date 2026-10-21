import React, { useRef } from 'react';

export default function DeckBrowser({
  decks,
  currentId,
  onOpen,
  onDelete,
  onImport,
  onExportJson,
  onExportHtml,
  onExportPng,
  onPrint,
  onNew,
}) {
  const fileRef = useRef(null);

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h4>Saved decks</h4>
        <div className="panel-actions tight">
          <button type="button" onClick={onNew}>New deck</button>
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()}>
            Import .json
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json,.html"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImport(f);
              e.target.value = '';
            }}
          />
        </div>

        {decks.length === 0 ? (
          <p className="panel-hint">No saved decks yet. Save from the toolbar, or import a previous export.</p>
        ) : (
          <ul className="deck-list">
            {decks.map((d) => (
              <li key={d.id} className={d.id === currentId ? 'deck-item active' : 'deck-item'}>
                <button type="button" className="deck-open" onClick={() => onOpen(d.id)}>
                  <span className="deck-name">{d.name}</span>
                  <span className="deck-date">{formatDate(d.updatedAt)}</span>
                </button>
                <button
                  type="button"
                  className="deck-delete"
                  title="Delete deck"
                  onClick={() => onDelete(d.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h4>Export</h4>
        <div className="panel-actions tight wrap">
          <button type="button" onClick={onExportHtml}>Standalone .html</button>
          <button type="button" onClick={onExportJson}>.json project</button>
          <button type="button" onClick={onExportPng}>Current slide .png</button>
          <button type="button" className="ghost" onClick={onPrint}>Print / PDF</button>
        </div>
        <p className="panel-hint">
          The standalone export includes the slide runtime, so arrow keys and page fit work in any browser.
        </p>
      </section>
    </div>
  );
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}