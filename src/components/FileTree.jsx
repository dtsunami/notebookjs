import React, { useCallback, useEffect, useState } from 'react';
import { listDir, mkdirAt, createAt, renameAt, deleteAt, parentOf } from '../lib/files.js';

const ICON = {
  dir: '▸',
  notebook: '◆',
  code: '◇',
  image: '▣',
  file: '·',
};

export default function FileTree({
  openPath,
  onOpen,
  onError,
  onCreated,
  onCwdChange,
  refreshKey = 0,
}) {
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState([]);
  const [root, setRoot] = useState('');
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [draft, setDraft] = useState('');

  const refresh = useCallback(
    async (next = cwd) => {
      setBusy(true);
      try {
        const data = await listDir(next);
        setEntries(data.entries);
        setRoot(data.root);
        setCwd(data.path);
        onCwdChange?.(data.path);
      } catch (err) {
        onError?.(err.message);
      } finally {
        setBusy(false);
      }
    },
    [cwd, onError, onCwdChange],
  );

  useEffect(() => {
    refresh('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A save or a create elsewhere in the app changed the directory; re-list in
  // place rather than remounting the tree and losing the browsed folder.
  useEffect(() => {
    if (refreshKey) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const submitPrompt = async (e) => {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    try {
      let created = null;
      if (prompt === 'dir') await mkdirAt(cwd, name);
      else if (prompt === 'notebook') created = await createAt(cwd, name, 'notebook');
      else if (prompt?.rename) await renameAt(prompt.rename, name);
      setPrompt(null);
      setDraft('');
      await refresh();
      // A newly created notebook opens straight away.
      if (created) {
        onCreated?.({
          name: created.path.split('/').pop(),
          path: created.path,
          kind: 'notebook',
        });
      }
    } catch (err) {
      onError?.(err.message);
    }
  };

  const remove = async (entry) => {
    const label = entry.kind === 'dir' ? 'directory and everything in it' : 'file';
    if (!window.confirm(`Delete ${entry.name}? This removes the ${label}.`)) return;
    try {
      await deleteAt(entry.path);
      await refresh();
    } catch (err) {
      onError?.(err.message);
    }
  };

  const crumbs = cwd ? cwd.split('/') : [];

  return (
    <div className="ftree">
      <div className="ftree-bar">
        <button
          type="button"
          className="icon-btn"
          title="Up a level"
          disabled={!cwd}
          onClick={() => refresh(parentOf(cwd))}
        >
          ↑
        </button>
        <button type="button" className="icon-btn" title="New notebook" onClick={() => setPrompt('notebook')}>
          ＋
        </button>
        <button type="button" className="icon-btn" title="New folder" onClick={() => setPrompt('dir')}>
          ⊕
        </button>
        <button type="button" className="icon-btn" title="Refresh" onClick={() => refresh()}>
          ⟳
        </button>
      </div>

      <div className="ftree-crumbs" title={root}>
        <button type="button" className="crumb" onClick={() => refresh('')}>
          {root ? root.split('/').pop() : 'root'}
        </button>
        {crumbs.map((part, i) => (
          <React.Fragment key={`${part}-${i}`}>
            <span className="crumb-sep">/</span>
            <button
              type="button"
              className="crumb"
              onClick={() => refresh(crumbs.slice(0, i + 1).join('/'))}
            >
              {part}
            </button>
          </React.Fragment>
        ))}
      </div>

      {prompt && (
        <form className="ftree-prompt" onSubmit={submitPrompt}>
          <input
            autoFocus
            value={draft}
            placeholder={
              prompt === 'dir' ? 'Folder name' : prompt?.rename ? 'New name' : 'notebook name'
            }
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setPrompt(null);
                setDraft('');
              }
            }}
          />
          <button type="submit" className="primary sm">
            OK
          </button>
        </form>
      )}

      <ul className="ftree-list">
        {entries.length === 0 && !busy && <li className="ftree-empty">Empty folder</li>}
        {entries.map((entry) => (
          <li
            key={entry.path}
            className={`ftree-row${openPath === entry.path ? ' open' : ''}`}
          >
            <button
              type="button"
              className="ftree-main"
              onDoubleClick={() => entry.kind === 'dir' && refresh(entry.path)}
              onClick={() => (entry.kind === 'dir' ? refresh(entry.path) : onOpen(entry))}
            >
              <span className={`ftree-icon k-${entry.kind}`}>{ICON[entry.kind] || ICON.file}</span>
              <span className="ftree-name">{entry.name}</span>
            </button>
            <span className="ftree-actions">
              <button
                type="button"
                title="Rename"
                onClick={() => {
                  setPrompt({ rename: entry.path });
                  setDraft(entry.name);
                }}
              >
                ✎
              </button>
              <button type="button" title="Delete" onClick={() => remove(entry)}>
                ×
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}