import React, { useMemo, useState } from 'react';
import FileTree from './FileTree.jsx';
import StructureTree from './StructureTree.jsx';
import VersionsPanel from './VersionsPanel.jsx';
import { createAt } from '../lib/files.js';
import { loadLocalDecks } from '../lib/storage.js';

const NEW_BUTTONS = [
  { id: 'notebook', label: 'Notebook', glyph: '◆', primary: true, hint: 'Create a .jsnb notebook' },
  { id: 'slide', label: 'Slide', glyph: '▤', hint: 'Append a slide to this deck' },
  { id: 'cell', label: 'Cell', glyph: '▶', hint: 'Add a kernel cell to the selected slide' },
  { id: 'text', label: 'Text', glyph: '¶', hint: 'Create a markdown file' },
  { id: 'code', label: 'Code', glyph: '{}', hint: 'Create a JavaScript file' },
];

const PROMPT = {
  notebook: {
    label: 'New notebook',
    placeholder: 'notebook name',
    hint: '.jsnb is appended when you leave the extension off.',
  },
  text: {
    label: 'New text file',
    placeholder: 'notes',
    hint: '.md is appended when you leave the extension off.',
  },
  code: {
    label: 'New code file',
    placeholder: 'script',
    hint: '.js is appended when you leave the extension off.',
  },
};

/**
 * The left navigation: create actions, saved decks, the file tree, and the
 * open document's slides and cells. Everything the app can open is one click
 * away, and the whole pane collapses from the toolbar.
 */
export default function NavPane({
  decks,
  deckId,
  onOpenDeck,
  onDeleteDeck,
  filePath,
  treeNonce,
  onOpenFile,
  onCreated,
  onCwdChange,
  onError,
  onRefreshTree,
  blocks,
  orphans,
  currentIndex,
  selectedCellId,
  cellRunning,
  onSelectSlide,
  onSelectCell,
  onAddCell,
  onRunCell,
  onInterruptCell,
  onDeleteCell,
  onNewSlide,
  notify,
  historyEntries,
  historyVersion,
  renderedHtml,
  onRestoreCell,
  onRestoreSlide,
  expanded = true,
  onToggle,
}) {
  const [sections, setSections] = useState({ decks: true, files: true, structure: true });
  const [prompt, setPrompt] = useState(null);
  const [draft, setDraft] = useState('');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);

  // Server decks plus any saved locally while the API was unreachable.
  const allDecks = useMemo(() => {
    const local = loadLocalDecks();
    const seen = new Set((decks || []).map((d) => d.id));
    return [...(decks || []), ...local.filter((d) => !seen.has(d.id))];
  }, [decks, treeNonce]);

  const currentSlideId = blocks?.find((b) => b.index === currentIndex)?.id || null;

  const toggle = (key) => setSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const press = (id) => {
    if (id === 'slide') {
      onNewSlide?.();
      return;
    }
    if (id === 'cell') {
      onAddCell?.(currentSlideId);
      return;
    }
    setDraft('');
    setPrompt(id);
  };

  const submit = async (e) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name || !prompt) return;
    setBusy(true);
    try {
      const created = await createAt(cwd, name, prompt);
      const short = created.path.split('/').pop();
      setPrompt(null);
      setDraft('');
      onRefreshTree?.();
      if (prompt === 'notebook') {
        // A new notebook is opened immediately; a text or code file is not,
        // because blank content would replace whatever is on screen.
        onCreated?.({ path: created.path, name: short, kind: 'notebook' });
      } else {
        notify?.(`Created ${short}`, 'ok');
      }
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  const section = (key, title, count, body) => (
    <div className={sections[key] ? 'rail-section' : 'rail-section closed'}>
      <div className="rail-head" onClick={() => toggle(key)}>
        <span className="rail-chevron">▾</span>
        <h4>{title}</h4>
        {count != null && count !== '' && <span className="struct-count">{count}</span>}
      </div>
      <div className="rail-content">{body}</div>
    </div>
  );

  return (
    <aside className={expanded ? 'navpane' : 'navpane closed'} aria-label="Navigation">
      <div className="nav-topline">
        <span className="nav-topline-label">Navigation</span>
        <button
          type="button"
          className="nav-collapse"
          onClick={onToggle}
          title="Collapse navigation (⌘B)"
          aria-label="Collapse navigation"
        >
          ‹
        </button>
      </div>

      <div className="nav-newbar">
        {NEW_BUTTONS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={b.primary ? 'nav-newbtn primary' : 'nav-newbtn'}
            title={b.hint}
            onClick={() => press(b.id)}
          >
            <span className="nav-newbtn-glyph">{b.glyph}</span>
            <span>{b.label}</span>
          </button>
        ))}
      </div>

      {prompt && (
        <>
          <form className="nav-prompt" onSubmit={submit}>
            <input
              autoFocus
              value={draft}
              placeholder={PROMPT[prompt].placeholder}
              aria-label={PROMPT[prompt].label}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setPrompt(null);
                  setDraft('');
                }
              }}
            />
            <button type="submit" className="primary sm" disabled={busy || !draft.trim()}>
              {busy ? '…' : 'Create'}
            </button>
            <button type="button" className="ghost sm" onClick={() => { setPrompt(null); setDraft(''); }}>
              ×
            </button>
          </form>
          <p className="nav-prompt-hint">{PROMPT[prompt].hint}</p>
        </>
      )}

      <div className="nav-scroll">
        {section(
          'decks',
          'Decks',
          allDecks.length || '',
          allDecks.length === 0 ? (
            <p className="nav-empty">
              No saved decks yet. Press Notebook above, or ⌘S to save this one.
            </p>
          ) : (
            <ul className="deck-list nav-decks">
              {allDecks.map((d) => (
                <li key={d.id} className={d.id === deckId ? 'deck-item active' : 'deck-item'}>
                  <button type="button" className="deck-open" onClick={() => onOpenDeck?.(d.id)}>
                    <span className="deck-name">{d.name || 'Untitled'}</span>
                    {d.updatedAt && (
                      <span className="deck-date">
                        {new Date(d.updatedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="deck-delete"
                    title="Delete deck"
                    onClick={() => onDeleteDeck?.(d.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ),
        )}

        {section(
          'files',
          'Files',
          '',
          <FileTree
            openPath={filePath}
            refreshKey={treeNonce}
            onOpen={onOpenFile}
            onCreated={onCreated}
            onCwdChange={(path) => {
              setCwd(path);
              onCwdChange?.(path);
            }}
            onError={(m) => onError?.(m)}
          />,
        )}

        {section(
          'structure',
          'Slides & cells',
          blocks?.length || '',
          <StructureTree
            blocks={blocks || []}
            orphans={orphans || []}
            currentIndex={currentIndex}
            selectedCellId={selectedCellId}
            running={cellRunning || {}}
            onSelectSlide={onSelectSlide}
            onSelectCell={onSelectCell}
            onAddCell={onAddCell}
            onRunCell={onRunCell}
            onInterruptCell={onInterruptCell}
            onDeleteCell={onDeleteCell}
          />,
        )}

        {section(
          'versions',
          'Versions',
          historyEntries?.length ? historyEntries.length - 1 : '',
          <VersionsPanel
            html={renderedHtml}
            entries={historyEntries || []}
            blocks={blocks || []}
            onRestoreCell={onRestoreCell}
            onRestoreSlide={onRestoreSlide}
          />,
        )}
      </div>
    </aside>
  );
}