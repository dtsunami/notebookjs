# notebookjs

Agent-driven HTML slide decks. Edit the code, the styling, or the slides directly — the preview updates as you type. Ask the assistant in plain language and it edits the deck through tools, the same way an engineer edits files.

## Setup

```
npm install
npx playwright install chromium   # optional, enables screenshots + DOM inspection
npm run dev
```

Open http://localhost:5173. The API starts on 3001 and Vite proxies `/api` to it.

### Command line

`npm run dev` is the development workflow. For everything else there is a CLI:

```
npm install && npm link       # links `labjs` and `notebookjs` into the global prefix
npm run build                 # CLI serves dist/, so build once

labjs --host 0.0.0.0          # from any directory
labjs --port 8080 --no-open
labjs --print-token
labjs list                    # saved decks
labjs new "Q4 review"
labjs --version
```

`serve` is the default command: `labjs --host 0.0.0.0` is `labjs serve --host 0.0.0.0`.
It binds the port, prints the token and a sign-in URL, and opens a browser unless
`--no-open` is passed. It serves `dist/` when it exists, so no Vite process is
needed; `--data` overrides `DATA_DIR`.

Two directories, deliberately separate:

| Directory | Default | Holds | Scope |
|---|---|---|---|
| config | `~/.labjs` | `token`, `.env` | one per machine |
| data | `<cwd>/.labjs` | `decks/`, `sessions/` | one per project |

Credentials belong to the machine; decks belong to the project. `NB_CONFIG_DIR`
moves the first, `--data` (or `DATA_DIR`) moves the second. Both are resolved in
`server/paths.js`, which is the only module allowed to read those variables — it
is also what loads `.env`, so it must be imported before anything that snapshots
the environment.

`.env` is read from `<cwd>/.env` first, then `~/.labjs/.env`, then the real
environment. `dotenv` never overwrites a key that is already set, so the most
specific source wins and a project can override `LLM_MODEL` without touching
your global key.

The FileTree is rooted at the *current* directory, the same convention as
`jupyter lab`.

Decks created before this split lived in `data/`. Move them with `mv data .labjs`,
or keep serving the old location with `labjs --data data`.

Still available without linking: `npm run cli -- serve --host 0.0.0.0`.

Create `~/.labjs/.env` with:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_API_KEY` | *(none)* | Key for an OpenAI-compatible endpoint. Without it the assistant inserts a placeholder slide so you can still exercise the edit path. |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | Base URL. Points at OpenAI, OpenRouter, Groq, a local llama.cpp server, anything that speaks `/chat/completions` with tools. |
| `LLM_MODEL` | `gpt-4o-mini` | Model name. Needs tool-calling support for the assistant to work. |
| `DATA_DIR` | `<cwd>/.labjs` | Where decks and sessions live. Setting it also moves the config dir unless `NB_CONFIG_DIR` is set, which is how the smoke tests isolate a run. |
| `NB_CONFIG_DIR` | `~/.labjs` | Where the token and `~/.labjs/.env` live. |
| `NB_ROOT` | `<cwd>` | Root of the FileTree. |
| `NB_TOKEN` | *(generated)* | Auth token. Written to `~/.labjs/token` on first boot when unset. |
| `HOST` | `127.0.0.1` | Bind address. `0.0.0.0` exposes it on the network. |
| `PORT` | `3001` | API port. |
| `NB_CORS` | *(off)* | Set to `*` to allow cross-origin requests. Off by default because of cookie auth. |

## Authentication

Like `jupyter lab`, the server requires a token.

```
npm run dev                      # 127.0.0.1, token generated
HOST=0.0.0.0 npm run dev         # reachable on the LAN
NB_TOKEN=my-secret npm run dev   # supply your own
```

Startup prints a sign-in URL:

```
notebookjs API on http://localhost:3001
auth: token=AbC...

  Open the UI and sign in:
  http://localhost:3001/?token=AbC...
```

The `?token=` parameter is exchanged for an `HttpOnly`, `SameSite=Lax` cookie and then stripped from the address bar, so it does not linger in history and no client `fetch` needs to know about auth. A `Bearer` header also works for scripts.

`/api/health` is the only unauthenticated endpoint. It returns no data and exists so the client can distinguish "server down" from "wrong token".

**Cells are executed only by you.** The agent can create and edit cells but has no execution tool, and the system prompt forbids it from describing output it has not seen.

## The assistant

The server runs a tool-calling loop (`server/agent.js`). The model is given the deck outline and a set of tools; it calls them, sees the results, and iterates until it can answer.

**Deck tools** — operate on the document:

- `list_slides` — id, index, and a text preview of every slide
- `read_slide` — exact HTML of one slide
- `replace_in_slide` — the `old` string must match byte for byte and occur exactly once in that slide; otherwise the tool returns an error explaining which of the two failed and the model retries
- `insert_slide` / `delete_slide` / `move_slide` — placement is relative to a slide id, never an index, so reordering never invalidates an id
- `set_deck_style` / `get_deck_style` — the `deck-overrides` CSS block
- `list_cells` / `read_cell` — inspect JavaScript cells
- `create_cell` / `update_cell` / `delete_cell` — add, rewrite, and remove cells. Ids are assigned server-side, so the model never has to hand-write a `<script>` tag

**Browser tools** — operate on the *rendered* deck via Playwright:

- `screenshot` — PNG of the deck at 1280×720, fed back to the model as an image
- `query_dom` — matched elements with computed styles and bounding boxes
- `eval_js` — evaluate an expression in the rendered page
- `probe` — report elements overflowing the viewport or clipped by `overflow: hidden`

These are what let the model check its own work instead of guessing. Without Playwright installed the tool calls return a message saying so and the model continues without them; the UI shows a banner.

Limits: 14 model turns and 30 tool calls per request. Both are constants at the top of `server/agent.js`.

## Edit discipline

The whole point of `replace_in_slide` returning a specific error rather than a boolean is that the model can act on it. Three failure modes are handled explicitly:

- **not found** — "call `read_slide` and copy the exact text, including indentation"
- **ambiguous** — "occurs 3 times; extend it with surrounding lines so it is unique"
- **unknown id** — "call `list_slides` to get the current ids"

This is the same contract davai uses on files, applied to slides.

## Notebook cells

Any slide can contain a JavaScript cell:

```html
<section class="slide" data-slide-id="s1">
  <h2>Live counter</h2>
  <div class="counter">0</div>
  <script type="text/nb-cell" data-cell-id="c1">
    const out = cell.$('.counter');
    let n = 0;
    cell.every(500, () => { out.textContent = String(++n); });
  </script>
</section>
```

Cells execute inside the preview iframe, never in the host. The host owns the source: it parses cells out of the document, the Cells tab edits them, and the runtime executes them. There is one copy of every cell.

Each cell body is compiled as a function that receives a `cell` scope object:

| Member | Purpose |
|---|---|
| `cell.$` / `cell.$$` | query within this slide only |
| `cell.setText` / `cell.setHtml` | write to a matched element |
| `cell.on` | `addEventListener` on an element or the slide |
| `cell.raf` / `cell.every` | animation frame and interval helpers |
| `cell.root` / `cell.slide` | the slide element |

`console.log` and thrown errors are captured and shown under the cell. `⌘↵` runs a single cell; **Run all** reruns every cell on every slide. Add a cell with **+ Cell** in the Cells tab, which places it in the currently selected slide.

Because cells are captured in the export, a standalone `.html` export keeps its interactivity.

Two limits worth knowing: an error in one cell does not stop the others, and `console` is restored as soon as the synchronous body finishes, so logging from inside a `setTimeout` callback is not captured.

## Theming

Slides are styled from CSS variables injected in a `<style id="deck-style">` block generated by `src/lib/theme.js`. The Assistant never sees or edits that block; it styles slides using the shared classes (`.badge`, `.card`, `.grid.cols-2`, `.stat`, `.accent`, `.muted`) so slides inherit whatever the user picked in the Style tab. If the user asks for deck-wide CSS beyond the theme, the assistant writes to a separate `<style id="deck-overrides">` block via `set_deck_style`.

That separation matters: retheming a deck is instant and never requires the model to touch slide markup.

## System prompt

Fetched from `prompts/system.md`. Editable in the **Prompt** tab — your version is sent as the system message and persisted in localStorage. Clear the field to fall back to the file on disk. Delete the `systemPrompt` key from `notebookjs:preferences` in localStorage if an override is stuck.

## Persistence

Three layers, deliberately:

1. **Autosave** — the working document is written to localStorage on a 600ms debounce. Survives a refresh or a crashed tab.
2. **Saved decks** — `POST /api/decks/:id` writes JSON to `DATA_DIR/decks/`; a copy goes to localStorage as well, so a deck saved while the server was down is still recoverable from the Files tab.
3. **Transcripts** — chat history is stored per deck in localStorage, and mirrored to `DATA_DIR/sessions/` server-side.

## Export

- **Standalone .html** — the deck plus an inlined `<script id="nb-runtime">`. Arrow keys, space, Home/End and page-fit work in any browser, no build step.
- **.json project** — deck, theme, and transcript. Re-importable.
- **.png** — rendered server-side by the same Playwright browser the assistant uses, so the file matches what the agent sees. Returns 503 when Playwright is missing.
- **Print / PDF** — `@media print` hides the toolbars and prints the preview at full size.

## Layout

```
prompts/system.md        editable agent instructions
server/
  index.js               HTTP routes
  agent.js               tool-calling loop
  tools.js               tool schemas + dispatcher
  doc.js                 slide parsing, id assignment, exact-match edits
  browser.js             Playwright: screenshot, query, eval, probe
  store.js               deck + session persistence
src/
  App.jsx                orchestration, autosave, tabs
  lib/theme.js           presets → CSS variables, applyTheme/stripTheme
  lib/deck.js            client-side slide reordering by id
  lib/runtime.js         presentation runtime, injected into preview and export
  lib/storage.js         localStorage
  lib/export.js          file download helpers
  lib/chat.js            API client
  components/            Editor, Preview, SlideOutline, ChatPanel, StylePanel, PromptPanel, DeckBrowser
data/                    decks and sessions (gitignored)
```

## Known limitations

- Single user, single tab. Two tabs on the same deck will fight over localStorage.
- The theme is applied server-side before screenshots and stripped again before the document returns, so the editor shows markup rather than 200 lines of generated CSS. If you edit the `deck-style` block by hand, the next theme change overwrites it.
- The agent loop is request-scoped. Closing the tab mid-request cancels the fetch and abandons the work; there is no resume.