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
import { sendChatStream, toApiHistory, makeMessage, clearSession } from './lib/chat.js';
import { resolveAuth } from './lib/auth.js';
import {
  execCell,
  restartKernel,
  interruptKernel,
  kernelStatus,
  kernelForDeck,
  kernelLanguages,
  fetchInstallDeck,
  convertCell,
} from './lib/kernel.js';
import { moveSlideById, appendSlide, findSlides } from './lib/deck.js';
import {
  findCells,

  ensureCellBoxes,
  insertCell,
  replaceCellSource,
  removeCell,
  setCellGeometry,
  setCellMeta,
} from './lib/cells.js';
import NavPane from './components/NavPane.jsx';
import CellOutputDock from './components/CellOutputDock.jsx';
import Timeline from './components/Timeline.jsx';
import ConvertDialog from './components/ConvertDialog.jsx';
import VersionsPanel from './components/VersionsPanel.jsx';
import SettingsDrawer from './components/SettingsDrawer.jsx';
import ChatDock from './components/ChatDock.jsx';
import { readFileAt, writeFileAt, createAt, renameAt, basename } from './lib/files.js';

import { buildNotebook } from './lib/notebook.js';
import { loadUi, saveUi, applyUi } from './lib/ui-prefs.js';
import { createHistory, versionsOf } from './lib/history.js';

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
  // The cell last picked in the sidebar, passed to the agent as context.
  const [selectedCellId, setSelectedCellId] = useState(null);
  const [busy, setBusy] = useState(false);
  // Live view of the turn in flight: thinking tokens and tool calls as they
  // arrive. Cleared when the turn ends and folded into the final message.
  const [live, setLive] = useState(null);
  // Totals for the agent header, accumulated over the session.
  const [turnStats, setTurnStats] = useState({ usage: null, tools: 0, turns: 0 });
  // Set when a reset deletes the session file, so the persistence effect does
  // not immediately write an empty one back.
  const sessionReset = useRef(false);
  const abortRef = useRef(null);
  const previewRef = useRef(null);
  const execSeq = useRef(0);
  const saveRef = useRef(null);
  const importInputRef = useRef(null);

  /**
   * One history stack for the document. Cells and slides are projections of it
   * (see versionsOf); there is no separate per-node store to drift out of sync.
   */
  const history = useRef(createHistory()).current;
  const [historyVersion, setHistoryVersion] = useState(0);

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
  const [codeOpen, setCodeOpen] = useState(false);

  // Output dock: open on every run, folds back to its bar after a timeout.
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputPinned, setOutputPinned] = useState(false);
  const [outputRuns, setOutputRuns] = useState([]);

  const [cellOutputs, setCellOutputs] = useState({});
  const [cellRunning, setCellRunning] = useState({});
  const [kernel, setKernel] = useState(null);
  // Resolution table for Settings → Kernel: what each language resolves to.
  const [langs, setLangs] = useState(null);
  const [langsError, setLangsError] = useState('');
  // A pending language change on a cell that holds code. There is no undo, so
  // the rewrite is proposed and previewed rather than applied silently.
  const [convert, setConvert] = useState(null);
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertResult, setConvertResult] = useState(null);
  const [convertError, setConvertError] = useState('');
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [playwright, setPlaywright] = useState(null);

  // Bumped only for changes that must rebuild the iframe (open, new deck, slide
  // added, assistant edit, cell deleted). In-slide edits stay in place.
  const [reloadVersion, setReloadVersion] = useState(0);
  const reload = useCallback(() => setReloadVersion((n) => n + 1), []);

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
      // Older decks have bare cell scripts; give them boxes so they are
      // visible, positioned elements from the first frame.
      history.reset(ensureCellBoxes(initial.html), 'open');
      setHtml(ensureCellBoxes(initial.html));
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

  // --- history ----------------------------------------------------------
  /**
   * Record a document state. Called from an effect on `html` rather than from
   * every setter, so no edit path can forget to record — including ones added
   * later. The label comes from `editLabel`, set by whichever handler is
   * responsible, which is what lets consecutive drag steps coalesce.
   */
  const editLabel = useRef('edit');

  useEffect(() => {
    if (!html) return;
    if (history.record(html, editLabel.current)) setHistoryVersion((n) => n + 1);
    editLabel.current = 'edit';
  }, [html, history]);

  /**
   * Restore a document state. A structural change needs the iframe rebuilt —
   * an undo can add or remove a cell — so this reloads rather than patching.
   */
  const restore = useCallback(
    (next) => {
      if (typeof next !== 'string') return;
      setHtml(next);
      setDirty(true);
      reload();
      setHistoryVersion((n) => n + 1);
    },
    [reload],
  );

  /**
   * Replace the document wholesale and forget the previous one's history. Used
   * by open, new, import and the install deck — undoing into a document you
   * closed is not undo, it is a different deck.
   */
  const loadDocument = useCallback(
    (nextHtml, label = 'open') => {
      history.reset(nextHtml, label);
      setHistoryVersion((n) => n + 1);
      setHtml(nextHtml);
    },
    [history],
  );

  /**
   * Put one cell's source back. This is an ordinary edit, not a jump: it is
   * recorded like any other, so restoring an old version can itself be undone.
   */
  const handleRestoreCell = useCallback(
    (id, source) => {
      editLabel.current = 'restore cell';
      setHtml((prev) => replaceCellSource(prev, { id }, source));
      setDirty(true);
      previewRef.current?.patch([{ id, source }]);
      notify(`Restored an earlier version of ${id}.`, 'ok');
    },
    [notify],
  );

  /**
   * Put one slide back by splicing its old markup over its current range. The
   * slide keeps its id, so the outline, the cells inside it and any selection
   * all survive the restore.
   */
  const handleRestoreSlide = useCallback(
    (slideId, slideHtml) => {
      setHtml((prev) => {
        const slide = findSlides(prev).find((s) => s.id === slideId);
        if (!slide) return prev;
        return `${prev.slice(0, slide.start)}${slideHtml}${prev.slice(slide.end)}`;
      });
      editLabel.current = 'restore slide';
      setDirty(true);
      reload();
      notify(`Restored an earlier version of ${slideId}.`, 'ok');
    },
    [reload, notify],
  );

  const handleUndo = useCallback(() => {
    const next = history.undo();
    if (next == null) {
      notify('Nothing to undo.', 'info');
      return;
    }
    restore(next);
  }, [history, restore, notify]);

  const handleRedo = useCallback(() => {
    const next = history.redo();
    if (next == null) {
      notify('Nothing to redo.', 'info');
      return;
    }
    restore(next);
  }, [history, restore, notify]);

  // --- outline ----------------------------------------------------------
  const handlePreviewState = useCallback((state) => {
    setOutline((state.ids || []).map((id, i) => ({ id, title: (state.titles || [])[i] })));
    /*
     * A fresh iframe always boots at slide 0 and says so. Adopting that is what
     * made adding or deleting a cell jump back to the first slide: the edit
     * reloads the preview, the reload reports 0, and the parent overwrote its
     * own perfectly good index with it.
     *
     * The parent owns the current slide across a reload. Preview re-asserts it
     * with nb:goto once the runtime is ready, so ignoring the boot report loses
     * nothing — and in-iframe navigation (arrow keys) still reports 'nav' and
     * is still adopted.
     */
    if (state.reason === 'boot') return;
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
    // A reset just deleted the session on disk; writing the empty transcript
    // back would recreate it and defeat the reset.
    if (sessionReset.current) {
      sessionReset.current = false;
      return;
    }
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
      if ((e.metaKey || e.ctrlKey) && key === 'b') {
        e.preventDefault();
        setUi((u) => ({ ...u, sidebar: !u.sidebar }));
      }
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        // Inside a text field the field owns its own undo; leave it alone and
        // let document undo handle everywhere else.
        const tag = e.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };
    const onRequest = () => saveRef.current?.();

    window.addEventListener('keydown', onKey);
    document.addEventListener('nb:save-request', onRequest);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('nb:save-request', onRequest);
    };
  }, [handleUndo, handleRedo]);

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
        // Reset the live view. `thinking` accumulates reasoning tokens,
        // `tools` tracks each call as it starts and finishes.
        let thinking = '';
        const tools = [];
        setLive({ thinking: '', tools: [], answering: false, chars: 0 });

        const data = await sendChatStream(
          {
            html: renderedHtml,
            history,
            message: text,
            systemPrompt: promptOverride,
            styleSettings: theme,
            sessionId: deckId,
            // What the operator is looking at, so "fix this" has a referent.
            focus: { slideId: outline[currentIndex]?.id || null, cellId: selectedCellId },
          },
          {
            signal: controller.signal,
            onEvent: (ev) => {
              if (ev.type === 'reasoning') {
                thinking += ev.text;
                setLive((l) => ({ ...(l || {}), thinking, tools: tools.slice() }));
              } else if (ev.type === 'content-start') {
                setLive((l) => ({ ...(l || {}), thinking, answering: true, tools: tools.slice() }));
              } else if (ev.type === 'content') {
                setLive((l) => ({
                  ...(l || {}),
                  thinking,
                  answering: true,
                  chars: ((l && l.chars) || 0) + ev.text.length,
                  tools: tools.slice(),
                }));
              } else if (ev.type === 'tool') {
                tools.push({ name: ev.name, target: ev.target, done: false });
                setLive((l) => ({ ...(l || {}), thinking, tools: tools.slice() }));
              } else if (ev.type === 'tool-done') {
                for (let i = tools.length - 1; i >= 0; i -= 1) {
                  if (tools[i].name === ev.name && !tools[i].done) {
                    tools[i].done = true;
                    break;
                  }
                }
                setLive((l) => ({ ...(l || {}), thinking, tools: tools.slice() }));
              }
            },
          },
        );

        const changed = typeof data.html === 'string' && data.html !== renderedHtml;
        if (changed) {
          // The assistant rewrites the document wholesale; nothing inside the
          // iframe is authoritative for it, so the frame is rebuilt. This one
          // is recorded, not reset — undoing an assistant edit is the whole
          // point of having history.
          editLabel.current = 'assistant';
          setHtml(ensureCellBoxes(data.html));
          setDirty(true);
          reload();
        }

        setMessages((prev) => [
          ...prev,
          makeMessage('assistant', data.text || '(no reply)', {
            // Thinking is kept for review, never sent back to the model.
            meta: {
              steps: data.steps,
              model: data.model,
              changed,
              thinking,
              usage: data.usage || null,
              tools: data.tools || null,
              elapsedMs: data.elapsedMs || null,
            },
          }),
        ]);

        // Roll the turn into the session totals shown in the header.
        const toolCount = Object.values(data.tools || {}).reduce((a, b) => a + b, 0);
        setTurnStats((prev) => ({
          usage: data.usage
            ? {
                prompt_tokens: (prev.usage?.prompt_tokens || 0) + data.usage.prompt_tokens,
                completion_tokens: (prev.usage?.completion_tokens || 0) + data.usage.completion_tokens,
                total_tokens: (prev.usage?.total_tokens || 0) + data.usage.total_tokens,
              }
            : prev.usage,
          tools: prev.tools + toolCount,
          turns: prev.turns + 1,
        }));
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
        setLive(null);
        abortRef.current = null;
      }
    },
    [messages, renderedHtml, promptOverride, theme, deckId, outline, currentIndex, selectedCellId],
  );

  const handleCancel = useCallback(() => abortRef.current?.abort(), []);

  /**
   * Start a new agent session.
   *
   * Not the same as clearing the transcript. The agent's context is the
   * messages array — `toApiHistory` sends it on every turn — so a stale
   * conversation keeps steering edits long after it scrolls out of view. This
   * drops the transcript, the on-disk session, and the per-turn stats together,
   * so the next message starts from the deck alone.
   */
  const handleNewSession = useCallback(() => {
    if (busy) return;
    abortRef.current?.abort();
    setMessages([]);
    setLive(null);
    setTurnStats({ usage: null, tools: 0, turns: 0 });
    clearSession(deckId);
    // The persistence effect would write the empty transcript straight back;
    // guard so the session file really is gone.
    sessionReset.current = true;
    notify('New agent session. It can still see the deck, not the conversation.', 'ok');
  }, [busy, deckId, notify]);

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
          loadDocument(ensureCellBoxes(parsed.html));
          setMessages(parsed.messages || []);
          setDeckName(parsed.name || basename(entry.path).replace(/\.jsnb$/, ''));
        } else {
          // Any HTML file can be opened directly as a deck.
          loadDocument(ensureCellBoxes(data.text));
          setMessages([]);
          setDeckName(basename(entry.path));
        }
        setFilePath(entry.path);
        setDirty(false);
        reload();
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
      loadDocument(ensureCellBoxes(data.html), 'new deck');
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
      loadDocument(ensureCellBoxes(deck.html));
      setDeckId(id);
      setDeckName(deck.name || 'Untitled deck');
      setMessages(deck.messages?.length ? deck.messages : loadTranscript(id));
      setDirty(false);
      reload();
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
        // Older or hand-written documents carry bare cell scripts; upgrade
        // them here so the first frame already has boxes.
        loadDocument(ensureCellBoxes(parsed.html), 'import');
        setDeckId(newId());
        setFilePath(null);
        setDeckName(parsed.name || file.name.replace(/\.[^.]+$/, ''));
        setMessages(parsed.messages || []);
        setDirty(true);
        // Import replaces the document wholesale, so the iframe must rebuild.
        reload();
        notify(`Imported ${file.name}.`, 'ok');
      } catch (err) {
        notify(`Import failed: ${err.message}`, 'error');
      }
    },
    [theme, notify, reload],
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

      editLabel.current = 'reorder slides';
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

  // --- cells ------------------------------------------------------------

  /**
   * A run opens the output dock and pushes its cell to the front of the list.
   * The timer that folds it back lives in its own effect below, so a second
   * run restarts the countdown rather than stacking timers.
   *
   * Declared before handleKernelExec, which lists it as a dependency: a
   * useCallback dependency array is evaluated during render, so referring to a
   * later `const` would throw before the callback ever ran.
   */
  const flashOutput = useCallback((cellId) => {
    setOutputRuns((prev) => {
      const at = Date.now();
      return [{ cellId, seq: at, at }, ...prev.filter((r) => r.cellId !== cellId)].slice(0, 12);
    });
    setOutputOpen(true);
  }, []);

  const handleCellOutput = useCallback((id, entries) => {
    setCellOutputs((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), entries } }));
  }, []);

  /**
   * A kernel cell ran inside the slide. The iframe holds the running state; the
   * parent does the execution and posts the record back, which paints the
   * in-cell output and feeds the dock.
   */
  const handleKernelExec = useCallback(
    async ({ id, lang, code }) => {
      if (!id) return;
      setCellRunning((prev) => ({ ...prev, [id]: true }));
      flashOutput(id);
      let record;
      try {
        const result = await execCell({ deckId, lang: lang || 'javascript', code });
        record = { ...result, seq: ++execSeq.current };
        const next = await kernelStatus().catch(() => null);
        if (next) setKernel(kernelForDeck(next, deckId));
      } catch (err) {
        record = { error: err.message, lang };
      }
      setCellOutputs((prev) => ({ ...prev, [id]: record }));
      setCellRunning((prev) => ({ ...prev, [id]: false }));
      // The runtime paints the in-cell output from the record it is handed.
      previewRef.current?.deliverOutput(id, record);
    },
    [deckId, flashOutput],
  );

  /** In-slide edits: persist without rebuilding the iframe. */
  const handleCellGeometry = useCallback((id, box) => {
    if (!id || !box) return;
    // Every mousemove posts geometry; the label lets history fold a whole
    // drag into one undo step.
    editLabel.current = 'move cell';
    setHtml((prev) => setCellGeometry(prev, id, box));
    setDirty(true);
  }, []);

  const handleCellSource = useCallback((id, source) => {
    if (!id) return;
    editLabel.current = 'edit cell';
    setHtml((prev) => replaceCellSource(prev, { id }, source));
    setDirty(true);
  }, []);

  /**
   * A language change on a cell that already holds code. The runtime has
   * already switched its own select, so the dialog owns the decision: convert
   * (and preview), keep the source as-is, or cancel and put the select back.
   */
  const handleCellMeta = useCallback(
    (id, patch) => {
      if (!id || !patch) return;

      if (patch.lang) {
        const cell = cells.find((c) => c.id === id);
        const from = cell?.lang || 'javascript';
        if (cell && cell.source.trim() && from !== patch.lang) {
          setConvert({ id, from, to: patch.lang, source: cell.source });
          setConvertBusy(false);
          setConvertResult(null);
          setConvertError('');
          return;
        }
      }

      editLabel.current = 'cell language';
      setHtml((prev) => setCellMeta(prev, id, patch));
      setDirty(true);
    },
    [cells],
  );

  /** Put the language back after a cancelled conversion. */
  const revertLang = useCallback(() => {
    if (!convert) return;
    setHtml((prev) => setCellMeta(prev, convert.id, { lang: convert.from }));
    previewRef.current?.patch([{ id: convert.id, lang: convert.from }]);
  }, [convert]);

  const handleCancelConvert = useCallback(() => {
    revertLang();
    setConvert(null);
    setConvertResult(null);
    setConvertError('');
  }, [revertLang]);

  const handleKeepSource = useCallback(() => {
    if (!convert) return;
    setHtml((prev) => setCellMeta(prev, convert.id, { lang: convert.to }));
    setDirty(true);
    setConvert(null);
  }, [convert]);

  const handleConvertWithAssistant = useCallback(async () => {
    if (!convert) return;
    setConvertBusy(true);
    setConvertError('');
    try {
      const res = await convertCell({ source: convert.source, from: convert.from, to: convert.to });
      if (!res.ok) {
        setConvertError(res.error || 'Conversion failed.');
        return;
      }
      setConvertResult(res);
    } catch (err) {
      setConvertError(err.message);
    } finally {
      setConvertBusy(false);
    }
  }, [convert]);

  /**
   * Apply the previewed source and the new language together. The source is
   * set first: replaceCellSource rewrites the script body, and a reload here
   * would re-run every cell on the slide, so the iframe is patched instead.
   */
  const handleApplyConvert = useCallback(() => {
    if (!convert || !convertResult) return;
    editLabel.current = `convert to ${convert.to}`;
    setHtml((prev) =>
      setCellMeta(replaceCellSource(prev, { id: convert.id }, convertResult.source), convert.id, {
        lang: convert.to,
      }),
    );
    setDirty(true);
    previewRef.current?.patch([{ id: convert.id, lang: convert.to, source: convertResult.source }]);
    notify(`Converted cell to ${convert.to}.`, 'ok');
    setConvert(null);
    setConvertResult(null);
  }, [convert, convertResult, notify]);

  /**
   * Widen the chat dock and give it focus, so something arriving from the slide
   * is visible rather than silently queued behind a collapsed rail.
   */
  const openChat = useCallback(() => setChatOpen(true), []);

  /**
   * Hand a cell's output to the agent.
   *
   * The agent cannot read the iframe, so its output has to travel as text. The
   * source is included because output alone is unanswerable: "why is this 42"
   * needs the code that produced it. The message is sent immediately rather
   * than pre-filling the composer — the operator already said what they wanted
   * by clicking Send to agent.
   */
  const handleOutputToAgent = useCallback(
    (d) => {
      if (!d || busy) return;
      const out = String(d.output || '').trim();
      const prompt = [
        `Here is the output of cell ${d.id} (${d.lang}):`,
        '',
        '```',
        out || '(no output)',
        '```',
        '',
        'Source:',
        '',
        '```' + (d.lang || ''),
        String(d.source || '').trim(),
        '```',
        '',
        'Explain what this output means and whether the cell is doing what it should.',
      ].join('\n');
      openChat();
      handleSend(prompt);
    },
    [busy, handleSend, openChat],
  );

  /**
   * Ask the agent about one cell's last run, from the output dock.
   *
   * The dock knows a cell id; everything else has to be assembled here. Output
   * is flattened the same way the in-slide popover does it, so what the model
   * reads matches what the operator saw.
   *
   * A failure gets a different prompt from a clean run. "Explain this output"
   * is the wrong request when there is a stack trace on screen — the operator
   * clicking a red button wants it fixed, and asking for the diagnosis plus a
   * corrected cell is what they would have typed.
   */
  const handleAskAgentAboutCell = useCallback(
    (id) => {
      if (!id || busy) return;
      const record = cellOutputs[id] || {};
      const cell = cells.find((c) => c.id === id);
      const lang = cell?.lang || record.lang || 'javascript';
      const source = String(cell?.source || '').trim();

      const lines = [];
      if (record.error) lines.push(`Error: ${record.error}`);
      for (const e of record.entries || []) {
        const text = typeof e.text === 'string' ? e.text : JSON.stringify(e.text);
        lines.push(e.level === 'return' ? `⇒ ${text}` : text);
      }
      const out = lines.join('\n').trim();
      const failed = !!record.error || (record.entries || []).some((e) => e.level === 'error');

      const prompt = [
        failed
          ? `Cell ${id} (${lang}) failed. Here is the error:`
          : `Here is the output of cell ${id} (${lang}):`,
        '',
        '```',
        out || '(no output)',
        '```',
        '',
        'Source:',
        '',
        '```' + lang,
        source || '(empty)',
        '```',
        '',
        failed
          ? 'Explain what went wrong and give me a corrected version of the cell.'
          : 'Explain what this output means and whether the cell is doing what it should.',
      ].join('\n');

      openChat();
      handleSend(prompt);
    },
    [busy, cells, cellOutputs, handleSend, openChat],
  );

  /**
   * Stop one running cell. A cell cannot be interrupted in place — a synchronous
   * loop cannot be preempted and Python has no portable unwind — so this kills
   * the kernel for that cell's language. Every cell sharing the language loses
   * its state, and the notice says so rather than pretending otherwise.
   */
  const handleCellInterrupt = useCallback(
    async (msg) => {
      const cell = cells.find((c) => c.id === msg.id);
      const lang = cell?.lang || msg.lang || 'javascript';
      try {
        await interruptKernel({ deckId, lang });
        setCellRunning((prev) => ({ ...prev, [msg.id]: false }));
        setKernel(null);
        previewRef.current?.deliverOutput(msg.id, { error: 'Stopped. Kernel restarted, state cleared.', entries: [] });
        notify(`Stopped the ${lang} kernel. Cells in that language lost their state.`, 'ok');
      } catch (err) {
        notify(`Stop failed: ${err.message}`, 'error');
      }
    },
    [cells, deckId, notify],
  );

  const handleCellDeleteInline = useCallback(
    (id) => {
      if (!id) return;
      editLabel.current = 'delete cell';
      setHtml((prev) => removeCell(prev, { id }));
      setDirty(true);
      reload();
    },
    [reload],
  );


  // Fold the dock back to its bar once the run settles, unless it is pinned.
  // Depending on outputRuns restarts the countdown when another cell runs.
  useEffect(() => {
    if (!outputOpen || outputPinned) return undefined;
    if (Object.values(cellRunning).some(Boolean)) return undefined;
    const t = setTimeout(() => setOutputOpen(false), Number(ui.outputTimeout) || 4500);
    return () => clearTimeout(t);
  }, [outputOpen, outputPinned, ui.outputTimeout, outputRuns, cellRunning]);


  const notebook = useMemo(() => buildNotebook(renderedHtml), [renderedHtml]);

  const handleAddCellTo = useCallback(
    (slideId) => {
      editLabel.current = 'add cell';
      setHtml((prev) => ensureCellBoxes(insertCell(prev, { slideId, exec: 'kernel', source: '' })));
      setDirty(true);
      // A new box has to be mounted, so this one does rebuild the iframe.
      reload();
    },
    [reload],
  );

  const handleNewSlide = useCallback(() => {
    editLabel.current = 'add slide';
    setHtml((prev) => appendSlide(prev) || prev);
    setDirty(true);
    reload();
  }, [reload]);

  /**
   * A cell lives in the slide, so "show me cell c3" means "go to the slide
   * that owns it" and hand the cell to the runtime, which scrolls its box into
   * view. The old version switched to a cells tab that no longer exists.
   */
  const scrollToCell = useCallback(
    (id) => {
      const owner = notebook.blocks.find((b) => b.cells.some((c) => c.id === id));
      if (owner && owner.index !== currentIndex) setCurrentIndex(owner.index);
      // Remember what the operator picked: it is how the agent learns which
      // cell "this cell" means.
      setSelectedCellId(id);
      requestAnimationFrame(() => previewRef.current?.focusCell(id));
    },
    [notebook, currentIndex],
  );

  /**
   * Run every cell on the visible slide. The runtime decides per cell: inline
   * cells execute in the page, kernel cells post back for the parent to run.
   * An error in one cell does not stop the run.
   */
  const handleRunAll = useCallback(() => {
    previewRef.current?.runAll();
  }, []);

  /**
   * Run one cell from outside the slide (the nav tree).
   *
   * Routed through the runtime rather than calling handleKernelExec directly,
   * because the iframe owns the live source: a cell being edited has unsaved
   * text in CodeMirror that the parent's `html` does not have yet. Running from
   * the nav must execute what the operator can see, exactly as the in-cell Run
   * button does. Selecting first also moves to the owning slide, so a run is
   * never invisible.
   */
  const handleRunCell = useCallback(
    (id) => {
      if (!id) return;
      scrollToCell(id);
      previewRef.current?.runCell(id);
    },
    [scrollToCell],
  );

  /** Stop one cell from the nav. Same kill-the-kernel semantics as in-cell. */
  const handleInterruptCellById = useCallback(
    (id) => {
      const cell = cells.find((c) => c.id === id);
      handleCellInterrupt({ id, lang: cell?.lang || 'javascript' });
    },
    [cells, handleCellInterrupt],
  );

  /** Re-probe interpreters. Called when the Kernel tab opens and on request. */
  const refreshLanguages = useCallback(async () => {
    try {
      const data = await kernelLanguages();
      setLangs(data);
      setLangsError('');
    } catch (err) {
      setLangs(null);
      setLangsError(err.message);
    }
  }, []);

  /**
   * Open the provisioning deck. It replaces the current document, so it gets a
   * new deck id — like New, but with shell cells that install into
   * ~/.labjs/bin. Nothing runs until the operator presses Run.
   */
  const handleOpenInstallDeck = useCallback(async () => {
    try {
      const data = await fetchInstallDeck();
      loadDocument(ensureCellBoxes(data.html), 'install deck');
      setDeckId(newId());
      setFilePath(null);
      setDeckName(data.name || 'Install kernels');
      setMessages([]);
      setCurrentIndex(0);
      setDirty(true);
      setSettingsOpen(false);
      reload();
      notify('Install deck opened. Run the cell for your OS.', 'ok');
    } catch (err) {
      notify(`Could not open the install deck: ${err.message}`, 'error');
    }
  }, [reload, notify]);

  const handleRestartKernel = useCallback(async () => {
    try {
      await restartKernel({ deckId });
      setCellOutputs({});
      setOutputRuns([]);
      setKernel(null);
      execSeq.current = 0;
      // In-cell output lives inside the iframe; rebuild it to clear.
      reload();
      notify('Kernel restarted. Cell state cleared.', 'ok');
    } catch (err) {
      notify(`Restart failed: ${err.message}`, 'error');
    }
  }, [deckId, notify]);

  /**
   * Stop running cells. Interrupt means "kill the process", and a deck can hold
   * cells in several languages, so every kernel this deck owns is stopped.
   */
  const handleKernelInterrupt = useCallback(async () => {
    const langs = Array.from(new Set(cells.map((c) => c.lang || 'javascript')));
    try {
      await Promise.all(langs.map((lang) => interruptKernel({ deckId, lang })));
      setCellRunning({});
      setKernel(null);
      execSeq.current = 0;
      reload();
      notify('Interrupted. Kernel restarted, state cleared.', 'ok');
    } catch (err) {
      notify(`Interrupt failed: ${err.message}`, 'error');
    }
  }, [deckId, cells, notify, reload]);

  // The stack lives in a ref, so it cannot trigger a render on its own. This
  // memo re-reads it whenever `historyVersion` changes, which is what makes
  // the Undo/Redo buttons enable and disable at the right moments.
  const { canUndo, canRedo } = useMemo(
    () => ({ canUndo: history.canUndo(), canRedo: history.canRedo() }),
    [history, historyVersion],
  );

  if (auth === 'checking') {
    return <div className="gate"><div className="gate-card"><h1>notebookjs</h1><p className="gate-hint">Connecting…</p></div></div>;
  }

  if (auth === 'locked') {
    return <TokenGate onSignedIn={() => { setAuth('ok'); window.location.reload(); }} />;
  }

  return (
    <div className="app" style={{ '--spin-speed': `${ui.spinnerSpeed ?? 0.7}s` }}>
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
            onClick={handleUndo}
            disabled={!canUndo}
            title={canUndo ? `Undo ${history.undoLabel()}  (⌘Z)` : 'Nothing to undo'}
            aria-label="Undo"
          >
            ↶
          </button>
          <button
            type="button"
            className="ghost sm"
            onClick={handleRedo}
            disabled={!canRedo}
            title={canRedo ? `Redo ${history.redoLabel()}  (⇧⌘Z)` : 'Nothing to redo'}
            aria-label="Redo"
          >
            ↷
          </button>
          <button
            type="button"
            className={ui.sidebar ? 'ghost sm on' : 'ghost sm'}
            onClick={() => setUi((u) => ({ ...u, sidebar: !u.sidebar }))}
            title={ui.sidebar ? 'Collapse navigation (⌘B)' : 'Show navigation (⌘B)'}
            aria-expanded={!!ui.sidebar}
          >
            ☰ Nav
          </button>
          <button
            type="button"
            className={ui.timeline ? 'ghost sm on' : 'ghost sm'}
            onClick={() => setUi((u) => ({ ...u, timeline: !u.timeline }))}
            title={ui.timeline ? 'Hide the slide timeline' : 'Show the slide timeline'}
            aria-pressed={!!ui.timeline}
          >
            ▤ Slides
          </button>
          <button
            type="button"
            className="ghost sm"
            onClick={() => setCodeOpen(true)}
            title="Edit the document HTML"
          >
            {'</>'} Source
          </button>
          <button
            type="button"
            className="ghost sm"
            onClick={() => importInputRef.current?.click()}
            title="Import a .html or .jsnb file"
          >
            Import
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".html,.htm,.jsnb,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files && e.target.files[0];
              e.target.value = '';
              if (f) handleImport(f);
            }}
          />
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

      <div className="main">
        <NavPane
          expanded={!!ui.sidebar}
          onToggle={() => setUi((u) => ({ ...u, sidebar: !u.sidebar }))}
          decks={decks}
          deckId={deckId}
          onOpenDeck={handleOpen}
          onDeleteDeck={handleDeleteDeck}
          filePath={filePath}
          treeNonce={treeNonce}
          onOpenFile={handleOpenFile}
          onCreated={handleOpenFile}
          onCwdChange={setBrowseDir}
          onError={(m) => notify(m, 'error')}
          onRefreshTree={() => setTreeNonce((n) => n + 1)}
          blocks={notebook.blocks}
          orphans={notebook.orphans}
          currentIndex={currentIndex}
          selectedCellId={selectedCellId}
          cellRunning={cellRunning}
          onSelectSlide={setCurrentIndex}
          onSelectCell={scrollToCell}
          onAddCell={handleAddCellTo}
          onRunCell={handleRunCell}
          onInterruptCell={handleInterruptCellById}
          onDeleteCell={handleCellDeleteInline}
          onNewSlide={handleNewSlide}
          notify={notify}
          historyEntries={history.entries()}
          historyVersion={historyVersion}
          renderedHtml={renderedHtml}
          onRestoreCell={handleRestoreCell}
          onRestoreSlide={handleRestoreSlide}
        />

        <section className="pane preview-pane">
          <div className="pane-header stage-head">
            <span
              className="edit-badge"
              title="Drag a cell by its header, resize from the bottom-right corner"
            >
              ✎ editable
            </span>
            <span className="muted sm">
              {outline[currentIndex]?.title ? outline[currentIndex].title.slice(0, 44) : ''}
            </span>
            <div className="stage-tools">
              <button
                type="button"
                className="ghost sm"
                onClick={() => handleAddCellTo(outline[currentIndex]?.id)}
                title="Add a kernel cell to this slide"
              >
                + Cell
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={handleRunAll}
                disabled={cells.length === 0}
                title="Run every kernel cell in order"
              >
                Run all
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={handleKernelInterrupt}
                title="Stop running cells (restarts the kernel)"
              >
                ■ Stop
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={handleRestartKernel}
                title="Restart the kernel and clear cell state"
              >
                ⟳ Kernel
              </button>
            </div>
          </div>

          {/* One surface: the slide. Cells are elements inside it. */}
          <div className="stage deck-stage">
            {renderedHtml ? (
              <Preview
                ref={previewRef}
                html={renderedHtml}
                index={currentIndex}
                theme={ui.theme}
                accent={ui.accent}
                reloadKey={reloadVersion}
                editable={ui.editCells !== false}
                onState={handlePreviewState}
                onCellOutput={handleCellOutput}
                onKernelExec={handleKernelExec}
                onGeometry={handleCellGeometry}
                onSource={handleCellSource}
                onMeta={handleCellMeta}
                onDelete={handleCellDeleteInline}
                onInterrupt={handleCellInterrupt}
                onOutputToAgent={handleOutputToAgent}
              />
            ) : (
              <div className="nb-empty">
                <p>No deck loaded.</p>
              </div>
            )}
          </div>

          {/* Filmstrip. Thumbnails are separate read-only documents, so the
              strip never runs a cell. Reorder goes through the same handler
              the nav used. */}
          {ui.timeline && outline.length > 0 && (
            <Timeline
              html={renderedHtml}
              slides={outline}
              currentIndex={currentIndex}
              onSelect={setCurrentIndex}
              onReorder={handleReorder}
              onNewSlide={handleNewSlide}
              onCollapse={() => setUi((u) => ({ ...u, timeline: false }))}
            />
          )}
        </section>

        <ChatDock
          open={chatOpen}
          onToggle={() => setChatOpen((v) => !v)}
          messages={messages}
          outline={outline}
          onSend={handleSend}
          busy={busy}
          live={live}
          stats={turnStats}
          onCancel={handleCancel}
          onReset={handleNewSession}
        />
      </div>

      <CellOutputDock
        open={outputOpen}
        pinned={outputPinned}
        onToggle={() => setOutputOpen((v) => !v)}
        onPinToggle={() => setOutputPinned((v) => !v)}
        onClear={() => {
          setOutputRuns([]);
          setCellOutputs({});
        }}
        onSendToAgent={handleAskAgentAboutCell}
        agentBusy={busy}
        runs={outputRuns}
        outputs={cellOutputs}
        running={cellRunning}
        timeout={ui.outputTimeout}
        runKey={outputRuns[0]?.seq ?? 0}
      />

      {codeOpen && (
        <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Document source">
          <div className="drawer-scrim" onClick={() => setCodeOpen(false)} />
          <aside className="drawer code-drawer">
            <header className="drawer-head">
              <h3>Source</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCodeOpen(false)}
                aria-label="Close source"
              >
                ×
              </button>
            </header>
            <div className="drawer-body code-drawer-body">
              <Editor
                value={html}
                onChange={(v) => {
                  setHtml(v);
                  setDirty(true);
                }}
              />
            </div>
          </aside>
        </div>
      )}

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
        languages={langs}
        languagesError={langsError}
        onRefreshLanguages={refreshLanguages}
        onOpenInstallDeck={handleOpenInstallDeck}
        playwright={playwright}
        serverRoot={serverRoot}
        decks={decks}
        currentDeckId={deckId}
        onExportHtml={handleExportHtml}
        onExportJson={handleExportJson}
        onExportPng={handleExportPng}
        onPrint={handlePrint}
      />

      <ConvertDialog
        request={convert}
        busy={convertBusy}
        result={convertResult}
        error={convertError}
        onConvert={handleConvertWithAssistant}
        onKeep={handleKeepSource}
        onApply={handleApplyConvert}
        onCancel={handleCancelConvert}
      />

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDone={() => setToast(null)}
      />
    </div>
  );
}