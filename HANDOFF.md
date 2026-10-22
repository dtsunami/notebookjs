# notebookjs — handoff

Written at a context break. Read this before touching `src/`.

## Where the product is going

Cells are **elements inside a slide**, not rows in a side pane. A cell is a box you
can drag, resize, edit, re-language and run, with hover tooltips and the controls
JupyterLab trained people to expect. It is backed by a persistent kernel process
per (deck, language). A thumbnail timeline of slides is planned.

Everything below exists to serve that model. If a change moves cells back out of
the slide, it is going the wrong way.

## Verified state

Last confirmed green (2026-10-21, after the CSS deletion and the runtime edit fix):

- `npm run build` — passes.
- `node scripts/smoke-kernel.mjs` — JS, TypeScript, Python, Ruby all pass
  persistence, output capture, error survival, restart.
- `node scripts/smoke-cellboxes.mjs` — cell box data model, 30 checks.
- `node scripts/smoke-runtime.mjs` — runtime compiles, palette injection.
- `smoke-auth`, `smoke-cells`, `smoke-cli`, `smoke-files`, `smoke-render`,
  `smoke-save` — all pass.

### Verified

The final two edits both landed and pass:

1. `src/styles/notebook.css` — `.cellb*` block deleted (dead once `CellBlock.jsx`
   was removed). No `cellb` / `nb-block` references remain in `src/`.
2. `scripts/smoke-runtime.mjs` — assertion strengthened, and it immediately
   caught a real bug: `build()` emitted the editor `<textarea>` unconditionally,
   hiding it only with `.nb-cell:not(.nb-edit) .nbc-src{display:none}`. **Exports
   shipped an editor.** Fixed by hoisting the editor markup into `SRC_HTML`, a
   `makeRuntime`-level constant that is the empty string when `editable` is false —
   so it is not in the export's string at all. All `.nbc-src` call sites in
   `build()` are now null-guarded.

Run:

```
npm run build
for f in scripts/smoke-*.mjs; do echo "== $f"; node $f 2>&1 | tail -4; done
```

## Architecture decisions (and why)

### Cell storage: box wraps script

```html
<div class="nb-cell" data-cell-id="c1"
     data-cell-x="4" data-cell-y="4" data-cell-w="92" data-cell-h="12"
     style="left:4%;top:4%;width:92%;height:12%">
  <script type="text/nb-cell" data-cell-id="c1" data-lang="python" data-exec="kernel">
...source...
  </script>
</div>
```

- The **script** remains the source of truth for code. The **div** is the element.
- A bare `<script>` is still valid (old decks, hand-written cells). `ensureCellBoxes()`
  upgrades in place and is idempotent. The runtime falls back to a flow layout
  (`nb-flow`) until the parent persists the upgrade.
- Geometry is **percent of the slide**, so a cell keeps its place at any projection
  size. Clamped 0–100 in `setCellGeometry`.
- `src/lib/cells.js` owns all of this: `findCells`, `ensureCellBoxes`,
  `ensureCellIds`, `setCellGeometry`, `setCellMeta`, `replaceCellSource`,
  `removeCell`, `insertCell`.

### Editing lives inside the iframe

Cells are part of the slide's layout, so dragging/resizing must happen in the
slide's own coordinate space. The runtime therefore owns:

- cell chrome (header, run, language select, source textarea, output pane, resize grip)
- drag (header) and resize (bottom-right grip)
- inline JS execution (`data-exec="inline"`)
- posting kernel runs to the parent (`data-exec="kernel"`)
- tooltips via `data-tip` + CSS `::after`

The runtime **never writes to the document**. Every change is posted to the parent,
which persists it into `html` state:

| runtime → parent | parent handler |
|---|---|
| `nb:cell-geometry` | `handleCellGeometry` → `setCellGeometry` |
| `nb:cell-source` | `handleCellSource` → `replaceCellSource` |
| `nb:cell-meta` | `handleCellMeta` → `setCellMeta` |
| `nb:cell-delete` | `handleCellDeleteInline` → `removeCell` + reload |
| `nb:kexec` | `handleKernelExec` → server kernel |
| `nb:cell-output` | `handleCellOutput` (inline cells) |
| `nb:state` | `handlePreviewState` (outline; ignores `reason: 'boot'`) |

Parent → runtime: `nb:sync`, `nb:goto`, `nb:run-cell`, `nb:run-all`,
`nb:focus-cell`, `nb:patch`, `nb:edit`, `nb:kout`.

### Reload is keyed, not reactive

`Preview` takes `reloadKey` (App state `reloadVersion`). The iframe rebuilds only
when that counter changes:

- deck opened / new / imported
- assistant rewrote the document
- slide added
- cell added or deleted

A drag or keystroke must **not** reload — it would re-run every cell and drop the
selection mid-gesture. So `html` changes alone do not reload; only `reloadKey` does.
`nb:patch` handles in-place source/geometry/lang updates without a reload.

If you add a structural mutation, call `reload()` or the iframe will never see it.

### Runtime is a factory, export is not editable

`makeRuntime({ editable, theme, accent })`:

- `RUNTIME_SCRIPT` = `makeRuntime({ editable: false })` — what an export ships.
  No editor, no grips, no drag.
- `editableRuntime({ theme, accent })` — what the app injects.

The iframe does not inherit app CSS, so the chrome palette (dark/light + accent
hex) is passed in as `THEME` / `ACCENT` and applied in `ensureStyle()`.

`smoke-runtime.mjs` compiles both variants and asserts the export has no editor.
The runtime is a string, so **the bundler never parses it** — that smoke test is
the only thing catching a syntax error before the browser does.

### Kernel

`server/kernel/languages.js` is the registry; `index.js` is protocol + lifecycle.

Protocol (newline-delimited JSON over stdin/stdout):

```
in  {"type":"exec","id":1,"code":"..."}
out {"type":"ready","lang":"python"}
    {"type":"result","id":1,"ok":true,"entries":[…],"ms":12}
```

| lang | harness | notes |
|---|---|---|
| javascript | `harness-node.mjs` (vm, retained context) | |
| typescript | `harness-node.mjs --typescript` | `node:module` `stripTypeScriptTypes`, mode `strip` |
| python | `harness-python.py` | shared dict namespace; `NB_PYTHON` |
| ruby | `harness-ruby.rb` | retained `Binding`; `NB_RUBY` |
| bash | `harness-shell.mjs --shell bash` | one retained shell; `NB_BASH` |
| pwsh | `harness-shell.mjs --shell pwsh` | one retained shell; `NB_PWSH` |

### Backend resolution and install

JavaScript and TypeScript need nothing beyond the Node running the server. The
interpreted targets and shells are separate binaries, resolved **at spawn time**
in this order: `NB_PYTHON` / `NB_RUBY` / `NB_BASH` / `NB_PWSH`, then
`~/.labjs/bin/<name>`, then a repo `.venv`, then PATH. `~/.labjs` is already the
per-machine `CONFIG_DIR`, so installed backends live in `~/.labjs/bin` and are
picked up by the next kernel start — no server restart.

`GET /api/kernel/languages` returns that resolution table (`probeLanguages()`),
rendered in Settings → Kernel. `GET /api/deck/install` returns the provisioning
deck (`server/templates/install.js`), opened from the same tab.

The install deck uses shell cells because a shell is the only language that can
run before the interpreters exist — and a JavaScript cell is sandboxed without
`child_process`. Its install cells carry a 15-minute budget (`timeoutMs` on the
language entry) instead of the default 30 s. `exec()` kills the kernel on
timeout: after an abandoned command the protocol can no longer tell where the
cell ended.

Limits worth knowing:

- A cell's stdin is `/dev/null` and there is no TTY, so `sudo` cannot prompt. The
  Linux cell tries `sudo -n` and prints the command when it refuses.
- Homebrew installs into a non-login shell's PATH only if `shellenv` is evaluated;
  the macOS cell does that explicitly.
- An installed backend lands on the server's inherited PATH only after a restart
  on Windows. The Windows cell says so.

Adding a target = one harness speaking the protocol + one registry entry. Compiled
languages reuse the protocol with the build step inside the harness (stubs for
rust/go/c are commented in `languages.js`). Out-of-tree targets:
`NB_LANGUAGES=/abs/languages.json`.

One kernel per `(deckId, lang)`. Interrupt = kill the process (state is lost, the
UI says so). Idle timeout `KERNEL_IDLE_MS` (10 min default).

## What changed in this session

### Added
- `server/kernel/languages.js` — registry
- `server/kernel/harness-ruby.rb` — Ruby kernel
- `scripts/smoke-cellboxes.mjs`, `scripts/smoke-runtime.mjs`, `scripts/smoke-shell.mjs`
- `server/kernel/harness-shell.mjs` — bash/PowerShell kernel
- `server/templates/install.js` — provisioning deck
- `server/convert.js` — cell language conversion
- `src/components/ConvertDialog.jsx` — convert/keep/cancel + preview
- `src/lib/history.js` — document history + per-thing projection
- `src/cm/editor.js` — CodeMirror entry, bundled for the iframe
- `scripts/build-cm.mjs`, `scripts/render-entry.jsx`
- `src/components/VersionsPanel.jsx` — per-cell / per-slide versions
- `src/components/Timeline.jsx` — slide filmstrip
- `scripts/smoke-shell.mjs`, `scripts/smoke-convert.mjs`, `scripts/smoke-handoff.mjs`,
  `scripts/smoke-history.mjs`, `scripts/smoke-stream.mjs`
- `scripts/smoke-handoff.mjs` — create_cell across all four languages, aliases,
  the wrapper, and the UI-prefs defaults
- `src/components/Timeline.jsx` — filmstrip

### Deleted (all unreferenced)
- `src/components/NotebookView.jsx` — vertical cells projection
- `src/components/CellBlock.jsx` — cell row (superseded by in-slide box)
- `src/components/CellsPanel.jsx` — older flat cells pane
- `src/components/SlideOutline.jsx` — flat outline with drag-reorder
- `src/components/DeckBrowser.jsx` — unused
- `src/components/ModeSwitch.jsx` — slide/cells toggle, gone with the split

### Rewritten
- `src/lib/cells.js` — box model
- `src/lib/runtime.js` — factory, in-slide editing, palette
- `src/components/Preview.jsx` — reloadKey, editable, event wiring, `deliverOutput`, `focusCell`

### Edited
- `src/App.jsx` — kernel-in-slide plumbing, `reloadVersion`, `handleKernelInterrupt`,
  `ensureCellBoxes` on every document load; cells pane and mode switch removed
- `src/lib/ui-prefs.js` — added `editCells`
- `src/components/AppearancePanel.jsx` — "Edit cells in the slide" toggle
- `src/components/NavPane.jsx` — collapsible rail, larger create buttons
- `src/styles/shell.css` — nav collapse, docked chat, output dock fold, `.edit-badge`
- `src/styles/notebook.css` — dead `.nb-block*` / `.cellb*` removed
- `src/App.css` — dead `.splitter` / `.workspace` / collapsed-pane rules removed
- `scripts/smoke-kernel.mjs` — Ruby + TypeScript cases; unsupported-language check
  moved from `ruby` to `cobol`
- `src/lib/runtime.js` — editor markup gated out of the export via `SRC_HTML`;
  `build()` tolerates a missing textarea

## Closed in this session

1. **Thumbnail timeline — done.** `src/components/Timeline.jsx`, horizontal
   filmstrip under the stage. Each slot renders `slideThumbDoc` through the
   existing read-only `SlideThumb`, so the strip never runs a cell. Click jumps,
   native HTML5 drag reorders through `handleReorder` (now wired), `+` adds a
   slide, `⌄` folds it away. Toggle: `ui.timeline` (toolbar `▤ Slides` and
   Appearance → Slides). Off by choice, so a small stage stays uncluttered.

2. **Prompt rewritten — done.** `prompts/system.md` now documents the wrapped
   form, the language list, and the JS `cell` vs. plain-program distinction. Two
   things it claimed were false and are now fixed in code rather than prose:
   `create_cell` had no `lang` parameter, and `server/cells.js` only accepted
   javascript/python. Both now take the four kernel languages (plus `ts`/`py`/
   `rb`/`js` aliases, unknown → javascript), and create `data-exec="kernel"`.

3. **`ui-prefs.js` cleaned.** `MODES`, `DEFAULT_UI.mode`, and the validation
   against it are gone; `loadUi` deletes a stored `mode` from older builds.
   `DEFAULT_UI.timeline` added.

4. **`handleImport` wired — and fixed.** It was unreferenced, and it also skipped
   `ensureCellBoxes` and never reloaded, so an imported deck with bare cells
   rendered wrong until the next structural change. Now upgrades, clears
   `filePath`, marks dirty, reloads. Toolbar `Import` button + hidden file input.

5. **Kernel `Stop`** (`handleKernelInterrupt`) interrupts every language the deck
   uses. Per-cell interrupt is not possible: interrupt kills the process.

6. **Resize minimums are now in pixels, not percent, and live in the gesture.**
   `MIN_PX_W` / `MIN_PX_H` in `runtime.js` (104 × 30) are converted to percent
   against the live slide each time a gesture starts, so the floor is "the
   smallest cell that still works at this stage size" rather than a fixed share
   of the slide. `cells.js` `MIN_W`/`MIN_H` dropped to 2% and are now only a
   storage sanity floor — they must *not* be raised back to match the runtime,
   or persistence will spring small cells back on the next mount.

7. **Cell language switch did not take effect until reload — fixed.** The
   runtime's `change` handler posted `nb:cell-meta` but left the live
   `<script data-lang>` stale, and `run()` reads that attribute, so re-language
   then Run executed in the old kernel. It now sets the attribute, clears the
   record, and repaints.

8. **No `nb:patch` callers.** `Preview` exposes `patch()` and the runtime handles
   it, but nothing in `App.jsx` calls it. Harmless; it is the intended path if a
   parent-side edit ever needs to reach a mounted cell without a reload.

## History: undo, redo, and versions

`src/lib/history.js` is the one stack. A deck is a single HTML string, so history
lives at the document level; a cell's versions and a slide's versions are
*projections* of that stack via `versionsOf(snapshots, extract)`, not parallel
stores. Two histories of the same text would eventually disagree.

- Recording happens in an effect on `html`, not in each setter, so no edit path
  can forget to record — including ones added later.
- `editLabel.current` names the edit; the effect consumes it. Consecutive edits
  with the same label inside 700 ms coalesce, so **a drag is one undo step**.
- `loadDocument()` resets the stack on open / new / import / install deck —
  undoing into a closed document is not undo. An **assistant rewrite is
  recorded**, not reset: undoing it is the point.
- `⌘Z` / `⇧⌘Z` are ignored inside text fields, where the field owns its own undo.
- Restoring an old cell or slide version is an ordinary edit, so it is itself
  undoable and nothing is ever lost.

One consequence to know: **undo reloads the iframe**, which re-runs every cell
on the slide. A structural restore can add or remove a cell, so patching is not
an option. Kernel state is untouched — the kernel process is not restarted — but
any side effects the cells produce happen again.

The stack is capped at 120 entries (~a few MB) and lives in memory only. It is
not persisted across a reload or a server restart.

## CodeMirror inside the iframe

Cells are edited with CodeMirror 6, but **not** with the app's copy. The
runtime lives in a sandboxed iframe, and CodeMirror builds its DOM with the
`document` of the realm that imported it — nodes from the parent document
cannot be inserted into the iframe. So `src/cm/editor.js` is a separate entry,
bundled by `scripts/build-cm.mjs` into `public/cm/editor.js` (436 KB, IIFE),
and the runtime loads it **inside the iframe** with a `<script>` tag.

- `npm run build` runs `build:cm` first, so the bundle is never stale.
- The runtime guards on `window.NBEditor`; until it loads — or if it fails, as
  in an export — the plain textarea is the editor. Editing never depends on it.
- The mount element is emitted only when `EDITABLE`, so an export never tries
  to fetch a bundle that is not beside it.
- Language changes go through a `Compartment`, so re-language keeps the
  document and undo history rather than rebuilding the view.

## Execution shows as a counter, not output

Cells no longer render an output pane. The bar carries `.nbc-count`: how many
times this cell has run in this view, and whether the last run failed.

- **A red count is the only failure signal in the slide**, so it must stay
  visible. The output itself is read in `CellOutputDock`.
- The count is per-view, not persisted — it describes the session.

## Streaming the assistant

`/api/chat/stream` is SSE over POST. `sendChatStream` reads the body and parses
frames with `readSseFrames` (shared with the smoke test, which feeds it one byte
at a time).

- **Reasoning is streamed.** DeepSeek sends `delta.reasoning_content`; others
  use `delta.reasoning`. Both are surfaced live and stored on the message's
  `meta.thinking` for review — and **never** appended to `content`, so thinking
  is not fed back to the model as conversation.
- `content-start` is emitted on the first content token after reasoning, which
  is what folds the thinking pane away and switches the bubble to answering.
- Tool calls arrive in fragments indexed by position; `streamModel`
  reassembles them before the loop runs. A missing `id` is synthesised.
- **Reassembly preserves fields it does not understand**, and must keep doing
  so. Gemini's OpenAI-compatible endpoint attaches a `thought_signature` to a
  thinking model's function calls (under `extra_content`) and rejects the next
  request unless it comes back on the assistant message replaying them.
  Rebuilding a call from id/type/name/arguments alone dropped it, so every
  tool-calling turn died on its *second* request with "Function call is missing
  a thought_signature". Unknown top-level and `function` keys are now copied
  verbatim rather than Gemini's being named, so the next provider that tags its
  tool calls works without a change. `smoke-agent.mjs` asserts the signature
  reaches the replayed message in both the streamed and non-streamed paths.
- A 15 s keep-alive comment stops a proxy timing out during a long think.
- Aborting the request (the Cancel button) aborts the model call server-side.

The non-streaming `/api/chat` is unchanged and still works.

## Converting a cell to another language

Changing a cell's language when it holds code opens `ConvertDialog`. Three
outcomes, because **there is no undo**:

- **Convert** — `POST /api/convert` (one-shot, temperature 0, JSON-only reply),
  then the converted source is shown beside the original for approval.
- **Keep** — change the language, leave the source alone.
- **Cancel** — revert the language in the document *and* in the iframe select.

The runtime's select has already moved by the time the parent hears about it, so
every non-convert path must post `nb:patch` back or the select lies about the
document.

`server/convert.js` never edits the deck — it returns `{ok, source, notes}` or
`{ok: false, error}`, and the client applies it. It refuses rather than guesses
when the source depends on the JavaScript `cell` DOM API, which has no Python or
Ruby equivalent. With no `LLM_API_KEY` it returns an error; it does **not** do
what `agent.js` does (insert a placeholder) — silently replacing real code with
a placeholder would be worse than declining.

Applying a conversion patches the iframe (`nb:patch`) instead of reloading, so
it does not re-run every cell on the slide.

## Gotchas

- `smoke-render.mjs` cannot render `App` past its auth gate: `resolveAuth` is
  async and `renderToString` is not. Render the authenticated components from
  `scripts/render-entry.jsx` instead. A green suite once shipped a blank screen
  because nothing rendered the real layout.
- `public/cm/editor.js` is generated. Rebuild it (`npm run build:cm`) after
  changing `src/cm/editor.js` or CodeMirror will be silently out of date.

- **The `grep` op in this environment returns spurious `0 matches` for alternation
  patterns** (`a|b`). Use one literal per call, or read the file.
- `postMessage` is `'*'`. The iframe is `sandbox="allow-scripts allow-same-origin"`.
  If the preview ever loads untrusted content, tighten the target origin.
- `undo` exists now (`src/lib/history.js`, `⌘Z` / `⇧⌘Z`, toolbar arrows,
  Nav → Versions). It is in-memory only and does not survive a reload.
- `removeCell` deletes the wrapper *and* the script. Removing only the div leaves
  an invisible runnable cell.
- **Never give `.nbc` a `min-width`/`min-height`.** It had both, which let the
  chrome render larger than the `.nb-cell` that owns it. The overhang was
  transparent but still hit-tested, so it ate drags aimed at anything beneath —
  the "invisible boxes" — and the grips, positioned against `.nb-cell`, drifted
  off the visible edge. `.nbc` is now `position:relative` (so grips anchor to the
  chrome) and sizes to its box exactly. Small cells are handled by *shedding*
  controls via the `nb-narrow` / `nb-tiny` / `nb-short` classes that `fitChrome()`
  sets from measured pixels — run, output and delete are the last to go, so a
  cell can never become unrunnable or undeletable.
- Drag and resize share one driver (`gesture()`) built on **pointer events with
  `setPointerCapture`**. The old mouse-event version dropped the gesture when the
  pointer outran the box. Do not reintroduce `document`-level mousemove here.
- **`nb:state` carries a `reason`, and the parent must keep ignoring `'boot'`.**
  A reloaded iframe starts at slide 0 and reports it. The parent used to adopt
  that, so adding or deleting a cell — both of which reload — teleported to the
  first slide. `goto()` tags the report: `'boot'` for anything the parent itself
  asked for (`nb:sync`, `nb:goto`, initial boot), `'nav'` for in-iframe arrow-key
  navigation. **The parent owns the current slide across a reload**; `Preview`
  re-asserts it with `nb:goto` once the runtime is ready. Any new call to
  `goto()` must pass `'boot'` if it echoes a parent-supplied index, or the loop
  comes back.
- `ensureCellBoxes` runs on boot, open, import, new deck, and after assistant
  rewrites. If you add another document entry point, call it there too.

## Layout (current)

```
┌────────────────────────────────────────────────────────┐
│ toolbar: title · pager · Nav · Source · New · Save · ⚙ │
├──────────┬───────────────────────────────┬─────────────┤
│ NavPane  │ stage                          │ ChatDock    │
│ (slides  │   ┌───────────────────────┐   │ (collapses  │
│  out,    │   │ slide (iframe)        │   │  to a rail) │
│  files,  │   │  ┌──────┐ ┌──────┐    │   │             │
│  decks)  │   │  │ cell │ │ cell │    │   │             │
│          │   │  └──────┘ └──────┘    │   │             │
│          │   └───────────────────────┘   │             │
├──────────┴───────────────────────────────┴─────────────┤
│ CellOutputDock — flashes on run, folds to a bar        │
└────────────────────────────────────────────────────────┘
```

Nav collapses with `⌘B` / the topline `‹`. Output dock timeout is
`ui.outputTimeout` (Appearance → Cell output, 1.5–30 s), overridable by pinning.