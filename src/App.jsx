import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor from './components/Editor.jsx';
import Preview from './components/Preview.jsx';

import Toast from './components/Toast.jsx';
import TokenGate from './components/TokenGate.jsx';

import { applyTheme } from './lib/theme.js';
import {
  loadPreferences,
  savePreferences,
  loadAutosave,
  saveAutosave,
  loadTranscript,
  saveTranscript,
  loadLocalDecks,
  saveLocalDeck,
  deleteLocalDeck,
  newId,
} from './lib/storage.js';
import { exportHtml, exportJson, readFileAsText, slugify } from './lib/export.js';
import { RUNTIME_SCRIPT } from './lib/runtime.js';
import { sendChat, toApiHistory, makeMessage } from './lib/chat.js';
import { resolveAuth } from './lib/auth.js';
import { execCell, restartKernel, kernelStatus, kernelForDeck } from './lib/kernel.js';
import { moveSlideById } from './lib/deck.js';
import {
  findCells,
  ensureCellIds,
  insertCell,
  replaceCellSource,
  removeCell,
} from './lib/cells.js';
import Splitter from './components/Splitter.jsx';
import NotebookView from './components/NotebookView.jsx';
import FileTree from './components/FileTree.jsx';
import StructureTree from './components/StructureTree.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import ChatDock from './components/ChatDock.jsx';
import { readFileAt, writeFileAt, createAt, renameAt, basename } from './lib/files.js';
import ModeSwitch from './components/ModeSwitch.jsx';
import { buildNotebook } from './lib/notebook.js';
import { loadUi, saveUi, applyUi } from './lib/ui-prefs.js';

const FALLBACK_DECK = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Untitled deck</title>
</head>
<body>
<div id="deck">
<section class="slide" data-slide-id="s1">
  <span class="badge">New deck</span>
  <h1>Untitled</h1>
  <p>Ask the assistant to build your first slide.</p>
</section>
</div>
</body>
</html>`;

export default function App() {
  const prefs = useRef(loadPreferences()).current;
  const [auth, setAuth] = useState('checking');
  const [ui, setUi] = useState(() => loadUi());

  useEffect(() => {
    applyUi(ui);
    saveUi(ui);
  }, [ui]);

  useEffect(() => {
    resolveAuth()
      .then((ok) => setAuth(ok ? 'ok' : 'locked'))
      .catch(() => setAuth('locked'));
  }, []);

  const [html, setHtml] = useState('');
  const [theme, setTheme] = useState(prefs.theme || { preset: 'midnight' });
  const [promptOverride, setPromptOverride] = useState(prefs.systemPrompt || '');
  const [builtinPrompt, setBuiltinPrompt] = useState('');

  const [messages, setMessages] = useState([]);
  const [outline, setOutline] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef(null);
  const previewRef = useRef(null);
  const workspaceRef = useRef(null);
  const execSeq = useRef(0);
  const saveRef = useRef(null);

  const [decks, setDecks] = useState([]);
  const [deckId, setDeckId] = useState(prefs.activeDeckId || newId());
  const [deckName, setDeckName] = useState(prefs.activeDeckName || 'Untitled deck');


  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState('look');
  const [chatOpen, setChatOpen] = useState(false);
  const [filePath, setFilePath] = useState(null);
  const [browseDir, setBrowseDir] = useState('');
  const [treeNonce, setTreeNonce] = useState(0);
  const [serverRoot, setServerRoot] = useState('');
  const [railOpen, setRailOpen] = useState({ files: true, structure: true });

  const [editorWidth, setEditorWidth] = useState(46);
  const [sideWidth, setSideWidth] = useState(352);
  const [editorCollapsed, setEditorCollapsed] = useState(false);
  const [sideCollapsed, setSideCollapsed] = useState(false);
  const [cellOutputs, setCellOutputs] = useState({});
  const [cellRunning, setCellRunning] = useState({});
  const [kernel, setKernel] = useState(null);
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [playwright, setPlaywright] = useState(null);

  const notify = useCallback((message, tone = 'info') => {
    setToast({ message, tone });
  }, []);

  // --- boot -------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let initial = null;
      const auto = loadAutosave();
      if (auto?.html) {
        initial = auto;
      } else {
        try {
          const res = await fetch('/api/deck/new');
          const data = await res.json();
          initial = { html: data.html, name: 'Untitled deck', theme: prefs.theme };
        } catch {
          initial = { html: FALLBACK_DECK, name: 'Untitled deck', theme: prefs.theme };
        }
      }
      if (cancelled) return;

      const t = initial.theme || prefs.theme || { preset: 'midnight' };
      setTheme(t);
      setHtml(initial.html);
      if (initial.name) setDeckName(initial.name);
      setMessages(loadTranscript(initial.id || prefs.activeDeckId || 'scratch'));
    })();

    (async () => {
      try {
        const [p, d, h] = await Promise.all([
          fetch('/api/prompt').then((r) => r.json()),
          fetch('/api/decks').then((r) => r.json()),
          fetch('/api/health').then((r) => r.json()),
        ]);
        if (cancelled) return;
        setBuiltinPrompt(p.prompt || '');
        setDecks(d.decks || []);
        setPlaywright(!!h.playwright);
        fetch('/api/files/list?path=', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((f) => setServerRoot(f.root || ''))
          .catch(() => {});
      } catch {
        /* server offline; local-only mode */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [prefs.theme]);

  // --- theme keeps the document in sync ---------------------------------
  const renderedHtml = useMemo(() => (html ? applyTheme(html, theme) : ''), [html, theme]);

  const handleThemeChange = useCallback((next) => {
    setTheme(next);
    setDirty(true);
  }, []);

  // --- outline ----------------------------------------------------------
  const handlePreviewState = useCallback((state) => {
    setOutline((state.ids || []).map((id, i) => ({ id, title: (state.titles || [])[i] })));
    if (typeof state.current === 'number') setCurrentIndex(state.current);
  }, []);

  // --- autosave ---------------------------------------------------------
  useEffect(() => {
    if (!html) return undefined;
    const t = setTimeout(() => {
      saveAutosave({ id: deckId, name: deckName, html, theme, messages });
    }, 600);
    return () => clearTimeout(t);
  }, [html, theme, messages, deckId, deckName]);

  useEffect(() => {
    savePreferences({
      theme,
      systemPrompt: promptOverride,
      activeDeckId: deckId,
      activeDeckName: deckName,
    });
  }, [theme, promptOverride, deckId, deckName]);

  useEffect(() => {
    if (!deckId) return;
    saveTranscript(deckId, messages);
  }, [deckId, messages]);

  // Global save. The editor also dispatches nb:save-request when it has focus;
  // this listener covers the rest of the app.
  useEffect(() => {
    const onKey = (e) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 's') {
        e.preventDefault();
        saveRef.current?.();
      }
    };
    const onRequest = () => saveRef.current?.();

    window.addEventListener('keydown', onKey);
    document.addEventListener('nb:save-request', onRequest);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('nb:save-request', onRequest);
    };
  }, []);

  // --- chat -------------------------------------------------------------
  const handleSend = useCallback(
    async (text) => {
      const userMsg = makeMessage('user', text);
      const history = toApiHistory(messages);
      setMessages((prev) => [...prev, userMsg]);
      setBusy(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const data = await sendChat(
          {
            html: renderedHtml,
            history,
            message: text,
            systemPrompt: promptOverride,
            styleSettings: theme,
            sessionId: deckId,
          },
          { signal: controller.signal },
        );

        const changed = typeof data.html === 'string' && data.html !== renderedHtml;
        if (changed) {
          setHtml(data.html);
          setDirty(true);
        }

        setMessages((prev) => [
          ...prev,
          makeMessage('assistant', data.text || '(no reply)', {
            meta: { steps: data.steps, model: data.model, changed },
          }),
        ]);
      } catch (err) {
        if (err.name === 'AbortError') {
          setMessages((prev) => [...prev, makeMessage('assistant', 'Cancelled.', { error: true })]);
        } else {
          setMessages((prev) => [
            ...prev,
            makeMessage('assistant', err.message, { error: true }),
          ]);
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [messages, renderedHtml, promptOverride, theme, deckId],
  );

  const handleCancel = useCallback(() => abortRef.current?.abort(), []);
  const handleClearChat = useCallback(() => setMessages([]), []);

  // --- persistence ------------------------------------------------------
  // handleSaveFile is defined below; a ref defers the lookup past the TDZ.
  const saveFileRef = useRef(null);

  const handleSave = useCallback(async () => {
    // A file opened from the browser saves back to that file.
    if (filePath) {
      await saveFileRef.current?.();
      return;
    }

    // Nothing on disk yet: create a .jsnb in the browsed directory so the
    // document shows up in the file tree instead of vanishing into the API.
    const name = (deckName || 'Untitled').trim() || 'Untitled';
    try {
      const created = await createAt(browseDir, name, 'notebook');
      setFilePath(created.path);
      await writeFileAt(
        created.path,
        JSON.stringify(
          {
            version: 1,
            name,
            html,
            styleSettings: theme,
            messages: toApiHistory(messages),
          },
          null,
          2,
        ),
      );
      setDirty(false);
      setSavedAt(new Date());
      setTreeNonce((n) => n + 1);
      notify(`Saved ${basename(created.path)}`, 'ok');
      return;
    } catch (err) {
      // Name collision or a read-only directory: fall through to the deck API
      // so work is never lost, and say why.
      notify(`Could not write a file (${err.message}); saved locally instead.`, 'error');
    }
    const payload = {
      name: deckName,
      html,
      styleSettings: theme,
      messages: toApiHistory(messages),
    };
    try {
      await fetch(`/api/decks/${deckId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      /* fall through to local */
    }
    const entry = saveLocalDeck({ id: deckId, name: deckName, html, theme });
    setDecks((prev) => [entry, ...prev.filter((d) => d.id !== deckId)]);
    setDirty(false);
    setSavedAt(new Date());
    notify('Deck saved.', 'ok');
  }, [deckName, html, theme, messages, deckId, notify, filePath]);

  const handleOpenFile = useCallback(
    async (entry) => {
      try {
        const data = await readFileAt(entry.path);
        if (entry.kind === 'notebook' || entry.name.endsWith('.jsnb')) {
          const parsed = JSON.parse(data.text);
          if (!parsed.html) throw new Error('Notebook has no html field.');
          const t = parsed.styleSettings || theme;
          setTheme(t);
          setHtml(parsed.html);
          setMessages(parsed.messages || []);
          setDeckName(parsed.name || basename(entry.path).replace(/\.jsnb$/, ''));
        } else {
          // Any HTML file can be opened directly as a deck.
          setHtml(data.text);
          setMessages([]);
          setDeckName(basename(entry.path));
        }
        setFilePath(entry.path);
        setDirty(false);
        notify(`Opened ${entry.name}`, 'ok');
      } catch (err) {
        notify(`Could not open ${entry.name}: ${err.message}`, 'error');
      }
    },
    [theme, notify],
  );

  const handleSaveFile = useCallback(async () => {
    if (!filePath) return false;
    try {
      const body = filePath.endsWith('.jsnb')
        ? JSON.stringify(
            {
              version: 1,
              name: deckName,
              html,
              styleSettings: theme,
              messages: toApiHistory(messages),
            },
            null,
            2,
          )
        : html;
      await writeFileAt(filePath, body);
      setDirty(false);
      setSavedAt(new Date());
      notify(`Saved ${basename(filePath)}`, 'ok');
      return true;
    } catch (err) {
      notify(`Save failed: ${err.message}`, 'error');
      return false;
    }
  }, [filePath, deckName, html, theme, messages, notify]);

  /**
   * Enter in the title field. If the document already lives on disk and the
   * name changed, rename the file first so the tree and the title agree;
   * otherwise this is an ordinary save.
   */
  const handleRenameAndSave = useCallback(async () => {
    const name = (deckName || '').trim();
    if (!name) return;

    if (filePath && filePath.endsWith('.jsnb')) {
      const current = basename(filePath).replace(/\.jsnb$/, '');
      if (current !== name) {
        try {
          const moved = await renameAt(filePath, `${name}.jsnb`);
          setFilePath(moved.path);
          setTreeNonce((n) => n + 1);
        } catch (err) {
          notify(`Rename failed: ${err.message}`, 'error');
          return;
        }
      }
    }

    await saveRef.current?.();
  }, [deckName, filePath, notify]);

  useEffect(() => {
    saveRef.current = handleSave;
  }, [handleSave]);

  useEffect(() => {
    saveFileRef.current = handleSaveFile;
  }, [handleSaveFile]);

  const handleNew = useCallback(async () => {
    try {
      const res = await fetch('/api/deck/new');
      const data = await res.json();
      const id = newId();
      setHtml(data.html);
      setDeckId(id);
      setDeckName('Untitled deck');
      setMessages([]);
      setDirty(false);
      notify('New deck started.', 'ok');
    } catch {
      notify('Could not reach the server.', 'error');
    }
  }, [notify]);

  const handleOpen = useCallback(
    async (id) => {
      let deck = null;
      try {
        const res = await fetch(`/api/decks/${id}`);
        if (res.ok) deck = await res.json();
      } catch {
        /* ignore */
      }
      if (!deck) {
        deck = loadLocalDecks().find((d) => d.id === id) || null;
      }
      if (!deck?.html) {
        notify('Deck not found.', 'error');
        return;
      }
      const t = deck.styleSettings || deck.theme || theme;
      setTheme(t);
      setHtml(deck.html);
      setDeckId(id);
      setDeckName(deck.name || 'Untitled deck');
      setMessages(deck.messages?.length ? deck.messages : loadTranscript(id));
      setDirty(false);
      notify(`Opened “${deck.name || id}”.`, 'ok');
    },
    [theme, notify],
  );

  const handleDeleteDeck = useCallback(
    async (id) => {
      if (!window.confirm('Delete this deck? This cannot be undone.')) return;
      try {
        await fetch(`/api/decks/${id}`, { method: 'DELETE' });
      } catch {
        /* ignore */
      }
      deleteLocalDeck(id);
      setDecks((prev) => prev.filter((d) => d.id !== id));
      notify('Deck deleted.', 'ok');
    },
    [notify],
  );

  const handleImport = useCallback(
    async (file) => {
      try {
        const text = await readFileAsText(file);
        let parsed;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { html: text };
        }
        if (!parsed.html) throw new Error('No HTML found in that file.');
        const t = parsed.styleSettings || theme;
        setTheme(t);
        setHtml(parsed.html);
        setDeckId(newId());
        setDeckName(parsed.name || file.name.replace(/\.[^.]+$/, ''));
        setMessages(parsed.messages || []);
        notify('Imported.', 'ok');
      } catch (err) {
        notify(`Import failed: ${err.message}`, 'error');
      }
    },
    [theme, notify],
  );

  // --- export -----------------------------------------------------------
  const exportCtx = useMemo(
    () => ({ html: renderedHtml, name: deckName, styleSettings: theme, messages: toApiHistory(messages) }),
    [renderedHtml, deckName, theme, messages],
  );

  const handleExportHtml = useCallback(() => {
    exportHtml({ ...exportCtx, runtimeScript: RUNTIME_SCRIPT });
    notify('Standalone HTML exported.', 'ok');
  }, [exportCtx, notify]);

  const handleExportJson = useCallback(() => {
    exportJson(exportCtx);
    notify('Project JSON exported.', 'ok');
  }, [exportCtx, notify]);

  const handleExportPng = useCallback(async () => {
    try {
      const res = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html,
          styleSettings: theme,
          slideId: outline[currentIndex]?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Screenshot failed.');

      const a = document.createElement('a');
      a.href = data.image;
      a.download = `${slugify(deckName)}-${currentIndex + 1}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      notify('Slide exported as PNG.', 'ok');
    } catch (err) {
      notify(`PNG export failed: ${err.message}`, 'error');
    }
  }, [html, theme, outline, currentIndex, deckName, notify]);

  const handlePrint = useCallback(() => window.print(), []);

  const handleReorder = useCallback(
    (from, to) => {
      const moving = outline[from];
      const anchor = outline[to];
      if (!moving?.id || !anchor?.id) return;

      setHtml((prev) => moveSlideById(prev, moving.id, anchor.id, to > from ? 'after' : 'before') || prev);
      setCurrentIndex(to);
      setDirty(true);
    },
    [outline],
  );

  // --- render -----------------------------------------------------------
  const cells = useMemo(() => {
    if (!renderedHtml) return [];
    return findCells(renderedHtml).map((c) => ({
      id: c.id,
      lang: c.lang,
      exec: c.exec,
      source: c.source,
    }));
  }, [renderedHtml]);

  /**
   * Writes grid columns straight to the DOM. Doing this through React state on
   * every pointermove re-renders the tree and round-trips through the iframe,
   * which is what made the old slider stutter.
   */
  const applyGrid = useCallback((pct, colL, colR, sidePx) => {
    const el = workspaceRef.current;
    if (!el) return;
    const left = colL ? '0px 0px' : `${pct}fr 6px`;
    const right = colR ? '0px 0px' : `6px ${sidePx}px`;
    el.style.gridTemplateColumns = `${left} ${100 - pct}fr ${right}`;
  }, []);

  useEffect(() => {
    applyGrid(editorWidth, editorCollapsed, sideCollapsed, sideWidth);
  }, [editorWidth, sideWidth, editorCollapsed, sideCollapsed, applyGrid]);

  const handleEditorDrag = useCallback(
    (clientX) => {
      const el = workspaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = Math.min(72, Math.max(16, ((clientX - rect.left) / rect.width) * 100));
      applyGrid(pct, false, sideCollapsed, sideWidth);
    },
    [applyGrid, sideCollapsed, sideWidth],
  );

  const handleSideDrag = useCallback(
    (clientX) => {
      const el = workspaceRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const px = Math.min(620, Math.max(220, rect.right - clientX));
      applyGrid(editorWidth, editorCollapsed, false, px);
    },
    [applyGrid, editorWidth, editorCollapsed],
  );

  const handleEditorDragEnd = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return;
    // Columns: [editor, split, preview, split, side]
    const parts = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat);
    const left = parts[0];
    const mid = parts[2];
    if (Number.isFinite(left) && Number.isFinite(mid) && left + mid > 0) {
      setEditorWidth(Math.min(72, Math.max(16, (left / (left + mid)) * 100)));
    }
  }, []);

  const handleSideDragEnd = useCallback(() => {
    const el = workspaceRef.current;
    if (!el) return;
    const parts = getComputedStyle(el).gridTemplateColumns.split(' ').map(parseFloat);
    const side = parts[4];
    if (Number.isFinite(side)) setSideWidth(Math.min(620, Math.max(220, side)));
  }, []);

  // --- cells ------------------------------------------------------------
  const handleCellOutput = useCallback((id, entries) => {
    setCellOutputs((prev) => ({ ...prev, [id]: { entries } }));
  }, []);

  const notebook = useMemo(() => buildNotebook(renderedHtml), [renderedHtml]);

  const handleAddCellTo = useCallback((slideId) => {
    setHtml((prev) =>
      ensureCellIds(
        insertCell(prev, {
          slideId,
          lang: 'javascript',
          exec: 'kernel',
          source: '',
        }),
      ),
    );
    setDirty(true);
  }, []);

  const handleCellEdit = useCallback((cell, index, source) => {
    setHtml((prev) => replaceCellSource(prev, { id: cell.id, index }, source));
    setDirty(true);
  }, []);

  const runKernelCell = useCallback(
    async (cell) => {
      const id = cell.id;
      if (!id) return;
      setCellRunning((prev) => ({ ...prev, [id]: true }));
      try {
        const result = await execCell({
          deckId,
          lang: cell.lang || 'javascript',
          code: cell.source,
        });
        const seq = ++execSeq.current;
        setCellOutputs((prev) => ({ ...prev, [id]: { ...result, seq } }));
        const next = await kernelStatus().catch(() => null);
        if (next) setKernel(kernelForDeck(next, deckId));
      } catch (err) {
        setCellOutputs((prev) => ({ ...prev, [id]: { error: err.message } }));
      } finally {
        setCellRunning((prev) => ({ ...prev, [id]: false }));
      }
    },
    [deckId],
  );

  const handleCellRun = useCallback(
    (cell) => {
      if ((cell.exec || 'inline') === 'kernel') {
        runKernelCell(cell);
      } else {
        previewRef.current?.runCell(cell.id);
      }
    },
    [runKernelCell],
  );

  const handleRunAll = useCallback(() => {
    const kernelCells = cells.filter((c) => (c.exec || 'inline') === 'kernel');
    kernelCells.forEach((c) => runKernelCell(c));
    if (kernelCells.length < cells.length) previewRef.current?.runAll();
  }, [cells, runKernelCell]);

  const handleRestartKernel = useCallback(async () => {
    try {
      await restartKernel({ deckId });
      setCellOutputs({});
      setKernel(null);
      execSeq.current = 0;
      notify('Kernel restarted. Cell state cleared.', 'ok');
    } catch (err) {
      notify(`Restart failed: ${err.message}`, 'error');
    }
  }, [deckId, notify]);

  const handleAddCell = useCallback(() => {
    const slideId = outline[currentIndex]?.id;
    setHtml((prev) =>
      ensureCellIds(
        insertCell(prev, {
          slideId,
          lang: 'javascript',
          exec: 'kernel',
          source: 'console.log("hello from cell");',
        }),
      ),
    );
    setDirty(true);
  }, [outline, currentIndex]);

  const handleDeleteCell = useCallback((cell, index) => {
    setHtml((prev) => removeCell(prev, { id: cell.id, index }));
    setDirty(true);
  }, []);

  if (auth === 'checking') {
    return <div className="gate"><div className="gate-card"><h1>notebookjs</h1><p className="gate-hint">Connecting…</p></div></div>;
  }

  if (auth === 'locked') {
    return <TokenGate onSignedIn={() => { setAuth('ok'); window.location.reload(); }} />;
  }

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <span className="brand-mark">📓</span>
          <input
            className="deck-title"
            value={deckName}
            onChange={(e) => {
              setDeckName(e.target.value);
              setDirty(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
                handleRenameAndSave();
              } else if (e.key === 'Escape') {
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            aria-label="Deck name"
            title="Name the document, then press Enter to save"
          />
          {dirty && <span className="dirty-dot" title="Unsaved changes" />}
        </div>

        <div className="toolbar-center">
          <span className="counter">
            {outline.length ? `${currentIndex + 1} / ${outline.length}` : '—'}
          </span>
          <button type="button" className="ghost sm" onClick={() => setCurrentIndex((i) => i - 1)}>
            ‹
          </button>
          <button
            type="button"
            className="ghost sm"
            onClick={() => setCurrentIndex((i) => i + 1)}
          >
            ›
          </button>
        </div>

        <div className="actions">
          <button
            type="button"
            className="ghost sm"
            onClick={() => setEditorCollapsed((v) => !v)}
            title={editorCollapsed ? 'Show code pane' : 'Hide code pane'}
          >
            {editorCollapsed ? '⇥ Code' : 'Code ⇤'}
          </button>
          <button type="button" className="ghost" onClick={handleNew}>
            New
          </button>
          <button
            type="button"
            className="primary"
            onClick={handleSave}
            title={
              filePath
                ? `Save to ${filePath}  (⌘S)`
                : `Create ${(deckName || 'Untitled').trim()}.jsnb  (⌘S)`
            }
          >
            {dirty ? 'Save' : 'Saved'}
          </button>
          {filePath ? (
            <span className="saved-at" title={filePath}>
              {basename(filePath)}
              {savedAt && ` · ${savedAt.toLocaleTimeString()}`}
            </span>
          ) : (
            savedAt && <span className="saved-at">{savedAt.toLocaleTimeString()}</span>
          )}
          <button
            type="button"
            className="gear"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      {playwright === false && (
        <div className="banner">
          Playwright is not installed, so the assistant cannot take screenshots or inspect the rendered
          DOM. Run <code>npm i -D playwright &amp;&amp; npx playwright install chromium</code> to enable it.
        </div>
      )}

      <div className="workspace" ref={workspaceRef}>
        <section className={editorCollapsed ? 'pane editor-pane collapsed' : 'pane editor-pane'}>
          <div className="rail">
            <div className={railOpen.files ? 'rail-section grow' : 'rail-section closed'}>
              <div
                className="rail-head"
                onClick={() => setRailOpen((r) => ({ ...r, files: !r.files }))}
              >
                <span className="rail-chevron">▾</span>
                <h4>Files</h4>
              </div>
              <div className="rail-content">
                <FileTree
                  openPath={filePath}
                  refreshKey={treeNonce}
                  onOpen={handleOpenFile}
                  onCreated={handleOpenFile}
                  onCwdChange={setBrowseDir}
                  onError={(m) => notify(m, 'error')}
                />
              </div>
            </div>

            <div className={railOpen.structure ? 'rail-section grow' : 'rail-section closed'}>
              <div
                className="rail-head"
                onClick={() => setRailOpen((r) => ({ ...r, structure: !r.structure }))}
              >
                <span className="rail-chevron">▾</span>
                <h4>{deckName || 'Document'}</h4>
                <span className="struct-count">{notebook.cellCount || ''}</span>
              </div>
              <div className="rail-content">
                <StructureTree
                  blocks={notebook.blocks}
                  orphans={notebook.orphans}
                  currentIndex={currentIndex}
                  onSelectSlide={setCurrentIndex}
                  onSelectCell={(id) => {
                    const el = document.querySelector(`[data-cell-anchor="${id}"]`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  onAddCell={handleAddCellTo}
                />
              </div>
            </div>

            <div className={railOpen.code ? 'rail-section grow' : 'rail-section closed'}>
              <div
                className="rail-head"
                onClick={() => setRailOpen((r) => ({ ...r, code: !r.code }))}
              >
                <span className="rail-chevron">▾</span>
                <h4>Source</h4>
              </div>
              <div className="rail-content">
                <Editor
                  value={renderedHtml}
                  onChange={(v) => {
                    setHtml(v);
                    setDirty(true);
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        <Splitter onResize={handleEditorDrag} onEnd={handleEditorDragEnd} hidden={editorCollapsed} />

        <section className="pane preview-pane">
          <div className="pane-header">
            <ModeSwitch mode={ui.mode} onChange={(mode) => setUi((u) => ({ ...u, mode }))} />
            <span className="muted sm">
              {outline[currentIndex]?.title ? outline[currentIndex].title.slice(0, 44) : ''}
            </span>
          </div>

          <div className="stage" data-mode={ui.mode}>
            {ui.mode !== 'deck' && (
              <div className="stage-pane">
                <NotebookView
                  blocks={notebook.blocks}
                  orphans={notebook.orphans}
                  currentIndex={currentIndex}
                  onSelect={setCurrentIndex}
                  outputs={cellOutputs}
                  running={cellRunning}
                  onEdit={(cell, source) => handleCellEdit(cell, undefined, source)}
                  onRun={handleCellRun}
                  onDelete={(cell) => handleDeleteCell(cell)}
                  onAddCell={handleAddCellTo}
                />
              </div>
            )}

            {ui.mode === 'split' && <div className="stage-divider" />}

            {ui.mode !== 'notebook' && (
              <div className="stage-pane deck-stage">
                {renderedHtml && (
                  <Preview
                    ref={previewRef}
                    html={renderedHtml}
                    index={currentIndex}
                    onState={handlePreviewState}
                    onCellOutput={handleCellOutput}
                    onNavigate={setCurrentIndex}
                  />
                )}
              </div>
            )}
          </div>
        </section>

      </div>

      <ChatDock
        open={chatOpen}
        onToggle={() => setChatOpen((v) => !v)}
        messages={messages}
        outline={outline}
        onSend={handleSend}
        busy={busy}
        onCancel={handleCancel}
        onClear={handleClearChat}
      />

      <SettingsDrawer
        open={settingsOpen}
        tab={settingsTab}
        onTab={setSettingsTab}
        onClose={() => setSettingsOpen(false)}
        ui={ui}
        onUiChange={setUi}
        theme={theme}
        onThemeChange={handleThemeChange}
        promptOverride={promptOverride}
        builtinPrompt={builtinPrompt}
        onPromptChange={setPromptOverride}
        kernel={kernel}
        onRestartKernel={handleRestartKernel}
        playwright={playwright}
        serverRoot={serverRoot}
        decks={decks}
        currentDeckId={deckId}
        onExportHtml={handleExportHtml}
        onExportJson={handleExportJson}
        onExportPng={handleExportPng}
        onPrint={handlePrint}
      />

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDone={() => setToast(null)}
      />
    </div>
  );
}