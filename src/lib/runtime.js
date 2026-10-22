export const RUNTIME_ID = 'nb-runtime';

const FIT_CSS =
  'html,body{margin:0;padding:0;height:100%;overflow:hidden}' +
  '.slide{min-height:100vh !important;height:100vh !important;overflow:hidden}' +
  '.slide:not(.nb-visible){display:none !important}' +
  '.slide.nb-visible{display:flex !important}';

const CELL_CSS = `
.slide{position:relative !important}
.nb-cell{position:absolute;display:flex;z-index:2}
.nb-cell.nb-flow{position:relative !important;left:auto !important;top:auto !important;
  width:auto !important;height:auto !important;margin:.5rem 0}
/* The chrome fills its box exactly — never more.
   It used to carry min-width:196px/min-height:92px, which meant that on a small
   stage (or any cell at the percent floor) .nbc rendered LARGER than the
   .nb-cell that owns it. Three things broke at once: the chrome spilled over
   neighbouring cells, the grips — absolutely positioned against .nb-cell, since
   .nbc was never a positioned ancestor — detached from the visible edge, and the
   overhang became a transparent region that swallowed drags aimed at whatever
   was underneath. Those were the "invisible boxes".
   The floor is now enforced where it belongs: in the resize gesture, in percent
   derived from the live slide. The chrome adapts instead of overflowing. */
.nbc{position:relative;display:flex;flex-direction:column;width:100%;height:100%;text-align:left;align-items:stretch;justify-content:flex-start;
  background:rgba(12,17,28,.94);border:1px solid #2a3850;border-radius:8px;
  overflow:hidden;font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace;color:#e7edf9;
  box-shadow:0 6px 22px -14px #000;transition:border-color .14s,box-shadow .14s}
/* Adaptive chrome. A cell that is too small to hold the full bar drops its
   optional controls rather than clipping them. Run, Output and Delete are the
   last three standing, so a cell can never become one you cannot run or
   remove — which is exactly what happened when the bar simply overflowed. */
.nb-cell.nb-narrow .nbc-meta{display:none}
.nb-cell.nb-tiny .nbc-lang{display:none}
.nb-cell.nb-tiny .nbc-btn[data-act="copy"]{display:none}
/* Shorter than one bar: the cell collapses to its bar and stays fully usable. */
.nb-cell.nb-short .nbc-pre,.nb-cell.nb-short .nbc-src,.nb-cell.nb-short .nbc-cm{display:none !important}
.nb-cell.nb-short .nbc-bar{border-bottom:none;height:100%}
/* During a gesture, nothing animates: a transition on the dragged box is what
   made dragging feel like it lagged behind the pointer. */
.nb-cell.nb-drag{will-change:left,top,width,height}
.nb-cell.nb-drag .nbc{transition:none}
.nb-cell.nb-drag,.nb-cell.nb-drag *{user-select:none}
.nb-cell:hover .nbc{border-color:#3d4f6d}
.nb-cell.nb-sel .nbc{border-color:#6d8dff;box-shadow:0 0 0 1px rgba(109,141,255,.35),0 8px 26px -14px #000}
/* Execution state, in order of precedence: running, failed, ran clean, never ran.
   "Never executed" is a visible state of its own — an untouched cell must not
   look like one that ran and produced nothing. */
.nb-cell.nb-ran .nbc{border-color:#2f6b4a}
.nb-cell.nb-bad .nbc{border-color:#b4453f}
.nb-cell.nb-busy .nbc{border-color:#6d8dff;animation:nb-beat 1.1s ease-in-out infinite}
.nb-cell.nb-busy.nb-bad .nbc{border-color:#f87171}
@keyframes nb-beat{
  0%,100%{box-shadow:0 0 0 0 rgba(109,141,255,0),0 6px 22px -14px #000}
  50%{box-shadow:0 0 0 3px rgba(109,141,255,.28),0 6px 22px -14px #000}
}
@keyframes nb-spin{to{transform:rotate(360deg)}}
/* A one-shot ring for "this is the cell you asked for". */
.nb-cell.nb-flash .nbc{border-color:#6d8dff !important;animation:nb-flash 1.2s ease-out}
@keyframes nb-flash{
  0%{box-shadow:0 0 0 0 rgba(109,141,255,.75)}
  70%{box-shadow:0 0 0 10px rgba(109,141,255,0)}
  100%{box-shadow:0 0 0 0 rgba(109,141,255,0)}
}
.nbc-bar{display:flex;align-items:center;gap:6px;padding:3px 6px;flex-shrink:0;
  background:rgba(25,34,53,.96);border-bottom:1px solid #2a3850;cursor:grab;user-select:none}
.nb-cell.nb-flow .nbc-bar{cursor:default}
/* The run button is the primary action in the bar; it is meant to be the most
   visible thing there, not a faint dot. */
.nbc-run{position:relative;width:22px;height:22px;display:grid;place-items:center;
  border-radius:50%;border:1px solid #6d8dff;background:#6d8dff;color:#fff;
  cursor:pointer;font-size:9px;padding:0;flex-shrink:0;
  box-shadow:0 0 0 2px rgba(109,141,255,.16);transition:background .12s,border-color .12s,box-shadow .12s}
.nbc-run:hover{background:#8aa4ff;border-color:#8aa4ff;box-shadow:0 0 0 3px rgba(109,141,255,.3)}
.nbc-run:active{transform:translateY(1px)}
.nbc-run.nbc-stop{background:#e5484d;border-color:#e5484d;box-shadow:0 0 0 2px rgba(229,72,77,.2)}
.nbc-run.nbc-stop:hover{background:#f2555a;border-color:#f2555a}
/* Running: the button itself turns into a spinner and doubles as Stop. */
.nb-cell.nb-busy .nbc-run{background:#192235;border-color:#6d8dff;color:#6d8dff}
.nb-cell.nb-busy .nbc-run::before{content:'';position:absolute;inset:4px;border-radius:50%;
  border:2px solid rgba(109,141,255,.28);border-top-color:#6d8dff;animation:nb-spin .7s linear infinite}
.nb-cell.nb-busy .nbc-run .nbc-run-glyph{visibility:hidden}
.nbc-lang{background:#121a2a;border:1px solid #2a3850;border-radius:4px;color:#94a3bd;
  font:inherit;font-size:10px;padding:1px 4px;cursor:pointer;text-transform:uppercase;letter-spacing:.04em}
.nbc-meta{font-size:10px;color:#5d6b85;font-variant-numeric:tabular-nums}
.nbc-spacer{flex:1}
.nbc-btn{width:20px;height:20px;display:grid;place-items:center;border-radius:4px;border:none;
  background:transparent;color:#5d6b85;cursor:pointer;font-size:11px;padding:0;position:relative}
.nbc-btn:hover{background:#192235;color:#e7edf9}
.nbc-btn.nbc-del:hover{color:#f87171}
.nbc-btn[data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:130%;left:50%;
  transform:translateX(-50%);white-space:nowrap;background:#192235;border:1px solid #2a3850;
  color:#e7edf9;font-size:10px;padding:2px 6px;border-radius:4px;z-index:20;pointer-events:none}
.nbc-src{flex:0 0 auto;max-height:45%;overflow:auto;display:flex}
.nbc-src textarea{flex:1;width:100%;border:none;outline:none;background:transparent;color:#e7edf9;
  font:inherit;line-height:1.55;padding:6px 8px;resize:none;tab-size:2;min-height:2.4em}
.nbc-src textarea:focus{background:rgba(109,141,255,.06)}
/* Code is flush left. A deck's slide styles centre their text, and the
   collapsed preview inherits that — which reads as broken indentation. */
.nbc-pre{margin:0;padding:6px 8px;white-space:pre-wrap;word-break:break-word;color:#e7edf9;
  max-height:45%;overflow:auto;font:inherit;display:none;text-align:left !important}
.nb-cell:not(.nb-edit) .nbc-pre{display:block}
.nb-cell:not(.nb-edit) .nbc-src{display:none}
/* Execution shows as a count in the bar, not an output pane. Results are read
   in the output dock; a failing run leaves the count red so a broken cell cannot
   look like a quiet success. */
/* The count lives inside the output button. */
.nbc-count{font-size:10px;line-height:1;font-variant-numeric:tabular-nums;opacity:.9}
.nbc-outicon{display:inline-flex !important;align-items:center;gap:3px;width:auto !important;
  min-width:24px;padding:0 5px !important;color:#8aa4ff;background:rgba(109,141,255,.16);
  border:1px solid rgba(109,141,255,.35) !important;border-radius:5px}
.nbc-outicon:hover{background:rgba(109,141,255,.3) !important;color:#fff}
.nbc-outicon .nbc-out-glyph{font-size:10px;line-height:1}
.nbc-outicon-bad{color:#f87171;background:rgba(248,113,113,.18);border-color:rgba(248,113,113,.45) !important}
.nbc-outicon-bad:hover{background:rgba(248,113,113,.3) !important}
.nbc-cm{flex:1;min-height:0;overflow:auto;display:none}
.nb-cell.nb-edit .nbc-cm{display:block}
.nbc-cm .cm-editor{height:100%;font:12px/1.55 'IBM Plex Mono',ui-monospace,monospace}
.nbc-cm .cm-scroller{font-family:inherit;overflow:auto}
.nbc-cm .cm-gutters{background:transparent;border-right:1px solid #1d2739;color:#3d4f6d}
/* Output popover: the whole output, only while you want it. */
.nbc-pop{position:fixed;z-index:60;max-width:min(46rem,86vw);max-height:min(24rem,60vh);
  display:flex;flex-direction:column;background:#0c111c;border:1px solid #2a3850;
  border-radius:6px;box-shadow:0 12px 34px -12px #000;overflow:hidden;
  font:12px/1.5 'IBM Plex Mono',ui-monospace,monospace}
.nbc-pop-head{display:flex;justify-content:space-between;gap:12px;padding:4px 8px;
  border-bottom:1px solid #1d2739;color:#5d6b85;font-size:10px;text-transform:uppercase;letter-spacing:.04em}
.nbc-pop-head-latest{color:#8aa4ff}
.nbc-pop-body[hidden]{display:none}
.nbc-pop-ms{font-variant-numeric:tabular-nums}
.nbc-pop-body{overflow:auto;padding:6px 8px;min-height:0}
.nbc-pop-send{position:sticky;bottom:0;border:none;border-top:1px solid #1d2739;
  background:#121a2a;color:#8aa4ff;font:inherit;font-size:11px;padding:5px 8px;
  cursor:pointer;text-align:left}
.nbc-pop-send:hover{background:#192235;color:#fff}
.nbc-pop .nbc-o{white-space:pre-wrap;word-break:break-word}
.nbc-pop .nbc-o-log{color:#94a3bd}
.nbc-pop .nbc-o-error{color:#f87171}
.nbc-pop .nbc-o-warn{color:#fbbf24}
.nbc-pop .nbc-o-return{color:#4ade80}
/* Three grips: right edge changes width, bottom edge changes height, corner
   changes both. One corner alone means you can never widen a cell without also
   making it taller, which is what made resizing feel uncontrollable. */
/* Grips live inside .nbc (now position:relative), so they track the visible
   edge instead of a box that may not match it. touch-action:none stops the
   browser claiming the gesture as a scroll before pointermove ever fires. */
.nbc-grip{position:absolute;display:none;z-index:5;touch-action:none}
.nbc-grip-x{right:0;top:0;bottom:12px;width:10px;cursor:ew-resize}
.nbc-grip-y{left:0;right:12px;bottom:0;height:10px;cursor:ns-resize}
.nbc-grip-c{right:0;bottom:0;width:16px;height:16px;cursor:nwse-resize;
  background:linear-gradient(135deg,transparent 50%,#5a7099 50%);border-bottom-right-radius:7px}
/* Visible on hover as well as selection: needing to select a cell before you
   could find its resize handle was half of what made resizing feel clunky. */
.nb-cell.nb-edit:hover .nbc-grip,.nb-cell.nb-edit.nb-sel .nbc-grip{display:block}
.nb-cell.nb-edit:hover .nbc-grip-c,.nb-cell.nb-edit.nb-sel .nbc-grip-c{background:linear-gradient(135deg,transparent 50%,#6d8dff 50%)}
.nb-cell.nb-flow .nbc-grip{display:none}
.nbc-bar{touch-action:none}
`;

// Mirrors the kernel registry. `bash` and `pwsh` are real kernels — marked as
// shells in the UI so nobody mistakes a provisioning cell for an authoring one.

/**
 * The deck runtime. One script does two jobs:
 *
 *   editable:false  presentation only — arrows, fit, run inline cells. This is
 *                   what a standalone export ships.
 *   editable:true   the app preview. Cells become boxes you can drag, resize,
 *                   edit, re-language, run on the kernel, and delete.
 *
 * Editing lives inside the iframe because the cells are part of the slide, and
 * a cell you cannot touch in its own layout is not really an element. The
 * parent persists every change; this never writes to the document itself.
 */
export function makeRuntime({ editable = false, theme = 'dark', accent = 'indigo' } = {}) {
  return `<script id="${RUNTIME_ID}">
(function () {
  var EDITABLE = ${editable ? 'true' : 'false'};
  var THEME = ${JSON.stringify(theme)};
  var ACCENT = ${JSON.stringify(accent)};
  var slides = [];
  var current = 0;
  var FIT = ${JSON.stringify(FIT_CSS)};
  var CELLS = ${JSON.stringify(CELL_CSS)};
  var LANGS = ${JSON.stringify(['javascript', 'typescript', 'python', 'ruby', 'bash', 'pwsh'])};
  /* The editor markup exists only in the app variant. Keeping it out of the
     export's source means an export cannot render an editor even if the flag
     is flipped. */
  var SRC_HTML = ${JSON.stringify(editable ? "<div class='nbc-src'><textarea spellcheck='false'></textarea></div>" : '')};
  var hasParent = !!(window.parent && window.parent !== window);
  var selected = null;
  /* Why the last render happened. Read by render() into the state report so
     the parent can tell a boot from real navigation. */
  var stateReason = 'boot';
  /* Latest record per cell, and the full list of this session's runs. The
     history is what the output button shows: "each execution", not just the
     last one. Both are display-only and die with the view. */
  var records = {};
  var history = {};
  var running = {};
  var drafts = {};
  /* How many times each cell has run in this view. Display only — it is not
     persisted, because it describes this session, not the deck. */
  var runsMap = {};
  var editOn = EDITABLE;

  /* The iframe does not inherit app CSS, so the chrome palette is handed in.
     Only the cell frame is themed; the slide's own styles stay the deck's. */
  function palette() {
    var light = THEME === 'light';
    return light
      ? {
          bar: 'background:#f7f9fc;border-bottom-color:#dde4ee;',
          input: 'background:#eef2f8;border-color:#dde4ee;color:#566179;',
          out: 'background:#f7f9fc;border-top-color:#dde4ee;',
          dim: 'color:#566179;',
          faint: 'color:#8794a9;',
          shell: 'background:rgba(255,255,255,.96);border-color:#c6d2e3;color:#11182a;',
        }
      : {
          bar: 'background:rgba(25,34,53,.96);border-bottom-color:#2a3850;',
          input: 'background:#121a2a;border-color:#2a3850;color:#94a3bd;',
          out: 'background:rgba(8,11,18,.6);border-top-color:#1d2739;',
          dim: 'color:#94a3bd;',
          faint: 'color:#5d6b85;',
          shell: 'background:rgba(12,17,28,.94);border-color:#2a3850;color:#e7edf9;',
        };
  }

  function accentHex(name) {
    if (name === 'emerald') return '#34d399';
    if (name === 'amber') return '#f59e0b';
    if (name === 'rose') return '#fb7185';
    if (name === 'cyan') return '#22d3ee';
    if (name === 'violet') return '#a78bfa';
    return '#6d8dff';
  }

  function ensureStyle() {
    var el = document.getElementById('__nb_focus');
    if (!el) {
      el = document.createElement('style');
      el.id = '__nb_focus';
      (document.head || document.documentElement).appendChild(el);
    }
    var p = palette();
    var acc = accentHex(ACCENT);
    el.textContent =
      FIT + CELLS +
      '.nbc{' + p.shell + '}' +
      '.nbc-bar{' + p.bar + '}' +
      '.nbc-lang{' + p.input + '}' +
      '.nbc-meta,.nbc-btn,.nbc-empty{' + p.faint + '}' +
      '.nbc-o-log{' + p.dim + '}' +
      '.nb-cell.nb-sel .nbc,.nb-cell.nb-busy .nbc{border-color:' + acc + '}' +
      '.nbc-run:hover{background:' + acc + ';border-color:' + acc + ';color:#fff}';
  }

  function collect() { slides = Array.prototype.slice.call(document.querySelectorAll('.slide')); }

  function clamp(n) {
    if (!slides.length) return 0;
    return ((n % slides.length) + slides.length) % slides.length;
  }

  function post(msg) {
    if (!hasParent) return;
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  function render() {
    slides.forEach(function (s, i) {
      if (i === current) s.classList.add('nb-visible');
      else s.classList.remove('nb-visible');
    });
    post({
      type: 'nb:state', count: slides.length, current: current,
      /* Why the parent needs this: a reload boots the runtime at slide 0 and
         immediately reports its state. Without a reason the parent cannot tell
         that report apart from the operator pressing ArrowRight, so it adopted
         0 and every cell add/delete teleported to the first slide. */
      reason: stateReason,
      ids: slides.map(function (s) { return s.getAttribute('data-slide-id'); }),
      titles: slides.map(function (s) {
        return (s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
      })
    });
  }

  /* The reason travels with the state report: 'boot' means "this is just where
     I started", anything else means "this is where the deck now is". */
  function goto(n, reason) {
    current = clamp(n);
    stateReason = reason || 'nav';
    render();
  }

  /* ---------- boxes ---------- */

  function cells() {
    return Array.prototype.slice.call(document.querySelectorAll('script[type="text/nb-cell"]'));
  }

  function idOf(el, i) {
    var id = el.getAttribute('data-cell-id');
    if (!id) { id = 'cell-' + i; el.setAttribute('data-cell-id', id); }
    return id;
  }

  /* The script may be bare (older decks). Give it a box on first sight, in the
     document only — the parent gets the upgrade on the next persist. */
  function boxOf(el) {
    var parent = el.parentNode;
    if (parent && parent.classList && parent.classList.contains('nb-cell')) return parent;
    var box = document.createElement('div');
    box.className = 'nb-cell nb-flow';
    box.setAttribute('data-cell-id', el.getAttribute('data-cell-id') || '');
    parent.insertBefore(box, el);
    box.appendChild(el);
    return box;
  }

  function applyGeometry(box) {
    var x = box.getAttribute('data-cell-x');
    var y = box.getAttribute('data-cell-y');
    var w = box.getAttribute('data-cell-w');
    var h = box.getAttribute('data-cell-h');
    if (x == null || y == null || w == null || h == null) { box.classList.add('nb-flow'); return; }
    box.classList.remove('nb-flow');

    // Render what was stored. The chrome adapts to any size now (see
    // fitChrome), so a small cell is small rather than broken, and a stored
    // box is no longer silently rewritten on mount — which used to make a
    // deliberately compact cell jump back to a size the operator never chose.
    // The gesture enforces the floor; rendering only keeps the box on-slide.
    var nw = Math.max(1, parseFloat(w) || 1);
    var nh = Math.max(1, parseFloat(h) || 1);
    var nx = Math.min(parseFloat(x) || 0, 100 - nw);
    var ny = Math.min(parseFloat(y) || 0, 100 - nh);

    box.style.left = Math.max(0, nx) + '%';
    box.style.top = Math.max(0, ny) + '%';
    box.style.width = nw + '%';
    box.style.height = nh + '%';
  }

  function geometry(box) {
    return {
      x: parseFloat(box.style.left) || 0,
      y: parseFloat(box.style.top) || 0,
      w: parseFloat(box.style.width) || 0,
      h: parseFloat(box.style.height) || 0
    };
  }

  /* ---------- cell chrome ---------- */

  function fmt(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (e) { return String(value); }
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * A cell's output as plain text, for handing to the agent.
   *
   * The agent cannot read a sliding iframe, so this is the only way it can see
   * what a cell actually printed. Entries are joined one per line, with errors
   * marked, and return values prefixed the same way the popover shows them —
   * so what the model reads matches what the operator saw.
   */
  function outputText(id) {
    var rec = records[id];
    if (!rec) return '';
    var lines = [];
    if (rec.error) lines.push('Error: ' + String(rec.error));
    (rec.entries || []).forEach(function (e) {
      var prefix = e.level === 'return' ? '=> ' : e.level === 'error' ? '! ' : '';
      lines.push(prefix + String(e.text));
    });
    return lines.join('\\n');
  }

  /**
   * Show one cell's output in a popover anchored to the output icon.
   *
   * The pane is created on demand and removed on mouse-leave, blur, Escape, or
   * a click elsewhere, so a cell's box does not permanently spend its area on
   * output. It is a hover affordance: leaving it dismisses it, which is what
   * makes it cheap to glance at and impossible to get stuck behind.
   */
  function showOutput(box, id, ev) {
    hideOutput();
    var runs = history[id] || [];
    if (runs.length === 0) return;

    var pop = document.createElement('div');
    pop.className = 'nbc-pop';
    pop.setAttribute('role', 'tooltip');

    /*
     * Every run of this cell, newest first. A cell that is re-run to fix a bug
     * is the normal case, so "what did it print before" is the question the
     * popover has to answer — showing only the last run throws that away.
     */
    runs.slice().reverse().forEach(function (run, i) {
      var rec = run.record || {};
      var entries = rec.entries || [];

      var head = document.createElement('div');
      head.className = 'nbc-pop-head' + (i === 0 ? ' nbc-pop-head-latest' : '');

      var label = document.createElement('span');
      label.textContent = i === 0 ? 'Latest' : 'Run ' + (runs.length - i);
      head.appendChild(label);

      var right = document.createElement('span');
      right.className = 'nbc-pop-ms';
      var bits = [];
      if (rec.error) bits.push('error');
      else bits.push(entries.length + ' line' + (entries.length === 1 ? '' : 's'));
      if (rec.ms != null) bits.push(rec.ms + ' ms');
      right.textContent = bits.join(' · ');
      head.appendChild(right);

      pop.appendChild(head);

      var body = document.createElement('div');
      body.className = 'nbc-pop-body';
      body.hidden = i !== 0;

      if (rec.error) {
        var e0 = document.createElement('div');
        e0.className = 'nbc-o nbc-o-error';
        e0.textContent = String(rec.error);
        body.appendChild(e0);
      } else if (entries.length === 0) {
        var none = document.createElement('div');
        none.className = 'nbc-o nbc-empty';
        none.textContent = 'No output.';
        body.appendChild(none);
      }

      entries.forEach(function (entry) {
        var line = document.createElement('div');
        var level = entry.level === 'log' || entry.level === 'info' ? 'log' : entry.level || 'log';
        line.className = 'nbc-o nbc-o-' + level;
        line.textContent = (entry.level === 'return' ? '\u21d2 ' : '') + String(entry.text);
        body.appendChild(line);
      });

      pop.appendChild(body);

      // Older runs open on click rather than piling every run's output on
      // screen at once — the popover would be unusable at 20 runs.
      if (i > 0) {
        head.style.cursor = 'pointer';
        head.addEventListener('click', function () {
          body.hidden = !body.hidden;
        });
      }
    });

    // Anchor under the icon, kept inside the viewport.
    var anchor = box.querySelector('.nbc-outicon') || ev.target;
    document.body.appendChild(pop);
    var r = anchor.getBoundingClientRect();
    var top = r.bottom + 6;
    var left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8);
    if (top + pop.offsetHeight > window.innerHeight - 8) {
      top = Math.max(8, r.top - pop.offsetHeight - 6);
    }
    pop.style.top = Math.max(8, top) + 'px';
    pop.style.left = Math.max(8, left) + 'px';

    pop.__cell = box;
    pop.__leave = function (e) {
      if (pop.contains(e.relatedTarget)) return;
      // Crossing the 6px gap between the button and the popover fires
      // mouseleave on the button first. Dismissing immediately would make the
      // popover impossible to reach, so leaving either one starts a timer that
      // entering the other cancels.
      pop.__timer = setTimeout(hideOutput, 180);
    };
    pop.__enter = function () {
      if (pop.__timer) clearTimeout(pop.__timer);
      pop.__timer = null;
    };
    pop.addEventListener('mouseleave', pop.__leave);
    pop.addEventListener('mouseenter', pop.__enter);

    /*
     * Send this run to the agent. A cell's output is invisible to the model —
     * it cannot read the iframe — so "why did this print that?" needs the text
     * carried over explicitly, along with the source that produced it.
     */
    var cellSrc = findSrc(id);
    var send = document.createElement('button');
    send.type = 'button';
    send.className = 'nbc-pop-send';
    send.textContent = 'Send to agent';
    send.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      post({
        type: 'nb:cell-output-to-agent',
        id: id,
        lang: (cellSrc && cellSrc.getAttribute('data-lang')) || 'javascript',
        source: drafts[id] != null
          ? drafts[id]
          : (cellSrc ? (cellSrc.textContent || '').replace(/^\\n/, '') : ''),
        output: outputText(id)
      });
      hideOutput();
    });
    pop.appendChild(send);
  }

  function hideOutput() {
    var pop = document.querySelector('.nbc-pop');
    if (!pop) return;
    if (pop.__timer) clearTimeout(pop.__timer);
    pop.remove();
  }

  function paint(box, id) {
    if (!box || !box.querySelector) return;
    var rec = records[id];
    var busy = !!running[id];
    var runs = id in runsMap ? runsMap[id] : 0;
    box.classList.toggle('nb-busy', busy);
    box.classList.toggle('nb-bad', !busy && !!(rec && rec.error));
    box.classList.toggle('nb-ran', !busy && !(rec && rec.error) && runs > 0);

    // The run button flips to Stop while a cell is executing.
    var btn = box.querySelector('.nbc-run');
    if (btn) {
      btn.classList.toggle('nbc-stop', busy);
      btn.setAttribute('data-tip', busy ? 'Stop (kills the kernel)' : 'Run cell (⌘↵)');
    }

    /*
     * One control for output. Hidden until the cell has run; filled once it
     * has, with the run count inside the button rather than beside it. The
     * fill colour is the state: accent = shown, red = last run failed.
     */
    var outBtn = box.querySelector('.nbc-outicon');
    var count = box.querySelector('.nbc-count');
    var has = !busy && runs > 0;

    if (outBtn) {
      outBtn.hidden = !has;
      outBtn.classList.toggle('nbc-outicon-bad', !!(rec && rec.error));
      outBtn.classList.toggle('nbc-outicon-busy', busy);
      outBtn.setAttribute('data-tip', !has
        ? ''
        : (rec && rec.error ? 'Output — last run failed' : 'Output') +
          (runs > 1 ? ' (' + runs + ' runs)' : ''));
    }
    if (count) count.textContent = has ? String(runs) : '';

    var meta = box.querySelector('.nbc-meta');
    if (meta) meta.textContent = !busy && rec && rec.ms != null ? rec.ms + ' ms' : '';
  }

  function build(box, src, id) {
    if (box.querySelector('.nbc')) return;
    var lang = (src.getAttribute('data-lang') || 'javascript').toLowerCase();
    var exec = (src.getAttribute('data-exec') || 'inline').toLowerCase();

    var shell = document.createElement('div');
    shell.className = 'nbc';
    shell.innerHTML =
      '<div class="nbc-bar">' +
        '<button class="nbc-run" data-act="run" data-tip="Run cell (⌘↵)"><span class="nbc-run-glyph">▶</span></button>' +
        '<select class="nbc-lang" data-act="lang" data-tip="Kernel for this cell"></select>' +
        '<span class="nbc-meta"></span>' +
        '<span class="nbc-spacer"></span>' +
        '<button class="nbc-btn nbc-outicon" data-act="out" data-tip="Output" hidden>' +
          '<span class="nbc-out-glyph">▤</span><span class="nbc-count"></span>' +
        '</button>' +
        '<button class="nbc-btn" data-act="copy" data-tip="Copy source">⧉</button>' +
        '<button class="nbc-btn nbc-del" data-act="del" data-tip="Delete cell">×</button>' +
      '</div>' +
      SRC_HTML +
      '<pre class="nbc-pre"></pre>' +
      (EDITABLE ? '<div class="nbc-cm"></div>' : '') +
      '<div class="nbc-grip nbc-grip-x" data-act="resize" data-edge="x" data-tip="Drag to change width"></div>' +
      '<div class="nbc-grip nbc-grip-y" data-act="resize" data-edge="y" data-tip="Drag to change height"></div>' +
      '<div class="nbc-grip nbc-grip-c" data-act="resize" data-edge="xy" data-tip="Drag to resize"></div>';

    box.insertBefore(shell, src);

    var select = shell.querySelector('.nbc-lang');
    LANGS.forEach(function (l) {
      var o = document.createElement('option');
      o.value = l; o.textContent = l;
      if (l === lang) o.selected = true;
      select.appendChild(o);
    });
    if (LANGS.indexOf(lang) === -1) {
      var o2 = document.createElement('option');
      o2.value = lang; o2.textContent = lang; o2.selected = true;
      select.appendChild(o2);
    }

    var text = (src.textContent || '').replace(/^\\n/, '').replace(/\\s+$/, '');
    shell.querySelector('.nbc-pre').textContent = text;
    var area = mountEditor(shell, src, id, lang, text);
    box.__nbEditor = area;

    box.setAttribute('data-exec', exec);
    box.classList.toggle('nb-edit', editOn);
    box.classList.toggle('nb-kernel', exec === 'kernel');

    shell.addEventListener('mousedown', function () { select_(box); });
    shell.addEventListener('click', function (e) {
      // Walk up from the target: the run button contains a glyph span and the
      // output button contains two, so reading data-act off e.target misses
      // every click that lands on the visible icon.
      var hit = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      var act = hit && hit.getAttribute('data-act');
      // Grips drag themselves; the select and the empty bar do nothing here.
      if (!act || act === 'lang' || act === 'resize') return;
      e.preventDefault();
      if (act === 'run') {
        // While running the same button is Stop: killing the kernel is the only
        // way to interrupt (see server/kernel/index.js).
        if (running[id]) { post({ type: 'nb:interrupt', id: id, lang: src.getAttribute('data-lang') || 'javascript' }); return; }
        commitSource(src, id);
        run(src, id);
      }
      if (act === 'del') { post({ type: 'nb:cell-delete', id: id }); }
      if (act === 'copy') {
        try { if (area) navigator.clipboard.writeText(area.value); } catch (e) {}
      }
      if (act === 'out') { showOutput(box, id, e); }
    });

    select.addEventListener('change', function () {
      // Update the live script too. run() reads data-lang from here, so a
      // re-language followed by Run must not execute in the old kernel.
      src.setAttribute('data-lang', select.value);
      if (area && area.setLanguage) area.setLanguage(select.value);
      records[id] = null;
      paint(box, id);
      post({ type: 'nb:cell-meta', id: id, lang: select.value });
    });

    // Hover, not click: the output button is a peek, and a click would demand
    // a second click to dismiss. Both events are on the button itself so a
    // large cell does not dismiss the popover when the pointer wanders.
    var outIcon = shell.querySelector('.nbc-outicon');
    if (outIcon) {
      outIcon.addEventListener('mouseenter', function (e) {
        if (outIcon.hidden) return;
        showOutput(box, id, e);
        var pop = document.querySelector('.nbc-pop');
        if (pop && pop.__timer) {
          clearTimeout(pop.__timer);
          pop.__timer = null;
        }
      });
      outIcon.addEventListener('mouseleave', function (e) {
        var pop = document.querySelector('.nbc-pop');
        if (!pop) return;
        if (pop.contains(e.relatedTarget)) return;
        pop.__timer = setTimeout(hideOutput, 180);
      });
    }

    drag(box, shell.querySelector('.nbc-bar'));
    Array.prototype.forEach.call(shell.querySelectorAll('.nbc-grip'), function (g) {
      resize(box, g, g.getAttribute('data-edge'));
    });
    paint(box, id);
  }

  function select_(box) {
    if (selected && selected !== box) selected.classList.remove('nb-sel');
    selected = box;
    if (box) box.classList.add('nb-sel');
  }

  function commitSource(src, id) {
    var box = src.parentNode;
    if (!box || !box.querySelector) return;
    var next = drafts[id] != null ? drafts[id] : null;
    if (next == null) return;
    var prev = (src.textContent || '').replace(/^\\n/, '').replace(/\\s+$/, '');
    if (next === prev) return;
    src.textContent = '\\n' + next + '\\n';
    delete drafts[id];
    post({ type: 'nb:cell-source', id: id, source: next });
  }

  /**
   * Mount the source editor for one cell.
   *
   * CodeMirror is loaded from /cm/editor.js *inside this iframe*, not imported
   * by the app: it builds its DOM with the document of the realm that loaded
   * it, and nodes from the parent document cannot be inserted here. Until the
   * script arrives — or if it fails, as in an export — the plain textarea is
   * what the user gets, so editing always works.
   */
  function mountEditor(shell, src, id, lang, text) {
    // The editor only exists in the app. An export has no /cm/editor.js next to
    // it, so it must not even try to fetch one.
    var mount = EDITABLE ? shell.querySelector('.nbc-cm') : null;
    var fallback = shell.querySelector('textarea');
    if (!mount) {
      // Export, or no editor markup: the textarea is the editor.
      return {
        get value() { return fallback ? fallback.value : text; },
        setValue: function (v) { if (fallback) fallback.value = v; },
        setLanguage: function () {},
      };
    }

    var attached = null;

    function attach() {
      if (attached || !window.NBEditor) return;
      try {
        attached = window.NBEditor.create({
          parent: mount,
          doc: text,
          lang: lang,
          onDoc: function (value) { drafts[id] = value; },
          onRun: function () { commitSource(src, id); run(src, id); }
        });
        // The textarea is the fallback only; once CM is up it is redundant.
        if (fallback && fallback.parentNode) fallback.parentNode.style.display = 'none';
        mount.nbEditor = attached;
      } catch (e) {
        attached = null;
      }
    }

    if (window.NBEditor) attach();
    else loadEditorScript(attach);

    return {
      get value() {
        if (attached) return window.NBEditor.getDoc(attached);
        return fallback ? fallback.value : text;
      },
      setLanguage: function (next) {
        if (attached) window.NBEditor.setLanguage(attached, next);
      },
      setValue: function (value) {
        if (attached) window.NBEditor.setDoc(attached, value);
        else if (fallback) fallback.value = value;
      }
    };
  }

  /* One <script> per document; every cell waits on the same load. */
  function loadEditorScript(done) {
    if (window.__nbEditorLoading) {
      if (window.__nbEditorReady) done();
      else window.__nbEditorQueue.push(done);
      return;
    }
    window.__nbEditorLoading = true;
    window.__nbEditorQueue = [done];
    var s = document.createElement('script');
    s.src = '/cm/editor.js';
    s.onload = function () {
      window.__nbEditorReady = true;
      var q = window.__nbEditorQueue || [];
      window.__nbEditorQueue = [];
      q.forEach(function (fn) { try { fn(); } catch (e) {} });
    };
    s.onerror = function () {
      // Stay on the textarea. A missing bundle is not a broken cell.
      window.__nbEditorQueue = [];
    };
    document.head.appendChild(s);
  }

  /* ---------- drag & resize ---------- */

  /* The absolute floor, in CSS pixels: the bar's three essential controls
     (run, output, delete) plus padding. Percent minimums cannot be constants —
     20% of a 400px stage is 80px, which clips, while 20% of a 1600px stage
     wastes a fifth of the slide. So the floor is defined in pixels and
     converted against the live slide at gesture time. */
  var MIN_PX_W = 104;
  var MIN_PX_H = 30;

  /* Percent floor for this slide, right now. */
  function minPct(slide) {
    var r = slide.getBoundingClientRect();
    return {
      w: r.width ? Math.min(100, (MIN_PX_W / r.width) * 100) : 8,
      h: r.height ? Math.min(100, (MIN_PX_H / r.height) * 100) : 5
    };
  }

  function clampTo(n, lo, hi) { return Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100; }

  /* Reflect the rendered size back into classes, so the chrome can shed
     controls instead of clipping them. Measured in pixels, because that is
     what the controls actually occupy. */
  function fitChrome(box) {
    var r = box.getBoundingClientRect();
    if (!r.width && !r.height) return;
    box.classList.toggle('nb-narrow', r.width < 260);
    box.classList.toggle('nb-tiny', r.width < 190);
    box.classList.toggle('nb-short', r.height < 64);
  }

  /* One gesture driver for both drag and resize.
   *
   * Pointer events, not mouse events, and capture on the handle: a fast drag
   * used to outrun the box and drop the gesture the moment the pointer left
   * it, which is most of what made this feel clunky. With capture the element
   * keeps receiving moves wherever the pointer goes.
   *
   * Geometry is written straight to style on every move (cheap: no layout
   * read) and posted to the parent only on release, so a drag is one undo step
   * and not one per pixel.
   */
  function gesture(box, handle, onMove) {
    if (!handle) return;
    handle.addEventListener('pointerdown', function (e) {
      if (!editOn || box.classList.contains('nb-flow')) return;
      if (e.button != null && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('button, select, input, textarea')) return;
      var slide = box.closest('.slide');
      if (!slide) return;

      e.preventDefault();
      e.stopPropagation();
      select_(box);
      hideOutput();

      var rect = slide.getBoundingClientRect();
      var min = minPct(slide);
      var startX = e.clientX, startY = e.clientY;
      var g = geometry(box);
      var moved = false;

      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      box.classList.add('nb-drag');

      var move = function (ev) {
        var dx = ((ev.clientX - startX) / rect.width) * 100;
        var dy = ((ev.clientY - startY) / rect.height) * 100;
        // A 3px deadzone: a click that twitches must not register as a move
        // and push a history entry.
        if (!moved && Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        moved = true;
        onMove(box, g, dx, dy, min);
        fitChrome(box);
      };

      var up = function (ev) {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        try { handle.releasePointerCapture(ev.pointerId); } catch (err) {}
        box.classList.remove('nb-drag');
        fitChrome(box);
        if (moved) {
          post({ type: 'nb:cell-geometry', id: box.getAttribute('data-cell-id'), box: geometry(box) });
        }
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });
  }

  function drag(box, handle) {
    gesture(box, handle, function (b, g, dx, dy) {
      b.style.left = clampTo(g.x + dx, 0, 100 - g.w) + '%';
      b.style.top = clampTo(g.y + dy, 0, 100 - g.h) + '%';
    });
  }

  /**
   * Resize from an edge or corner.
   *
   * The edge decides which axes that grip owns: 'x' widens, 'y' heightens,
   * 'xy' does both. Separate edges matter because a single corner couples the
   * two — you cannot make a cell wider without also making it taller, which is
   * what made resizing feel like it fought back.
   *
   * The minimum arrives per-gesture from the slide's live size rather than as
   * a constant, so the floor is the smallest genuinely usable cell at the
   * current stage size instead of a fixed share of the slide.
   *
   * (No backticks in this file: the runtime is one template literal, and a
   * backtick ends it. That mistake is a syntax error at import time.)
   */
  function resize(box, grip, edge) {
    var axes = edge || 'xy';
    gesture(box, grip, function (b, g, dx, dy, min) {
      if (axes.indexOf('x') !== -1) {
        b.style.width = clampTo(g.w + dx, min.w, 100 - g.x) + '%';
      }
      if (axes.indexOf('y') !== -1) {
        b.style.height = clampTo(g.h + dy, min.h, 100 - g.y) + '%';
      }
    });
  }

  function mount() {
    cells().forEach(function (src, i) {
      var box = boxOf(src);
      if (!box.getAttribute('data-cell-id')) {
        box.setAttribute('data-cell-id', src.getAttribute('data-cell-id') || 'cell-' + i);
      }
      applyGeometry(box);
      build(box, src, idOf(src, i));
      fitChrome(box);
    });
  }

  /* The stage can change size without the document changing at all — the nav
     collapsing, the chat dock opening, the window resizing. Percent geometry
     survives that, but the pixel-derived chrome classes do not, so re-measure
     every box. */
  function fitAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.nb-cell'), fitChrome);
  }

  /* ---------- execution ---------- */

  function isKernel(src) { return (src.getAttribute('data-exec') || '').toLowerCase() === 'kernel'; }

  function findSrc(id) {
    var found = null;
    cells().forEach(function (s, i) { if (idOf(s, i) === id) found = s; });
    return found;
  }

  function run(src, id) {
    if (isKernel(src)) {
      running[id] = true;
      runsMap[id] = (runsMap[id] || 0) + 1;
      // A run reads what is on screen. The editor is the source while the cell
      // is being written; the script text is what it was last saved as.
      var ed = src.parentNode && src.parentNode.__nbEditor;
      if (ed) drafts[id] = ed.value;
      paint(src.parentNode, id);
      post({
        type: 'nb:kexec', id: id,
        lang: (src.getAttribute('data-lang') || 'javascript').toLowerCase(),
        code: drafts[id] != null ? drafts[id] : (src.textContent || '').replace(/^\\n/, '')
      });
      return;
    }
    runInline(src, id);
  }

  function runInline(src, id) {
    var code = drafts[id] != null ? drafts[id] : (src.textContent || '');
    var lang = (src.getAttribute('data-lang') || 'javascript').toLowerCase();
    var entries = [];
    if (lang !== 'javascript' && lang !== 'js') {
      records[id] = {
        error: 'No in-browser runtime for "' + lang + '". Set this cell to run on the kernel.'
      };
      var elist = history[id] || (history[id] = []);
      elist.push({ at: Date.now(), record: records[id] });
      paint(src.parentNode, id);
      post({ type: 'nb:cell-output', id: id, entries: [] });
      return;
    }

    var realConsole = window.console;
    function capture(level) {
      return function () {
        entries.push({
          level: level,
          text: Array.prototype.slice.call(arguments).map(fmt).join(' ')
        });
      };
    }
    function finish() {
      records[id] = { entries: entries, ok: true };
      var list = history[id] || (history[id] = []);
      list.push({ at: Date.now(), record: records[id] });
      if (list.length > 20) list.shift();
      paint(src.parentNode, id);
      post({ type: 'nb:cell-output', id: id, entries: entries });
    }

    window.console = {
      log: capture('log'), info: capture('info'), warn: capture('warn'),
      error: capture('error'), debug: capture('log')
    };
    var returned;
    try {
      var slide = src.closest ? src.closest('.slide') : null;
      var root = slide || document;
      var api = {
        slide: slide, root: root,
        $: function (s) { return root.querySelector(s); },
        $$: function (s) { return Array.prototype.slice.call(root.querySelectorAll(s)); },
        on: function (t, type, fn, o) { (t || root).addEventListener(type, fn, o); },
        setText: function (s, text) { var e = root.querySelector(s); if (e) e.textContent = text; },
        setHtml: function (s, html) { var e = root.querySelector(s); if (e) e.innerHTML = html; }
      };
      var fn = new Function('cell', code + '\\n//# sourceURL=nb-cell-' + id + '.js');
      returned = fn(api);
      if (returned !== undefined) entries.push({ level: 'return', text: fmt(returned) });
    } catch (err) {
      entries.push({ level: 'error', text: String(err && err.message ? err.message : err) });
    } finally {
      window.console = realConsole;
    }

    if (returned && typeof returned.then === 'function') {
      returned.then(function (v) {
        if (v !== undefined) entries.push({ level: 'return', text: fmt(v) });
        finish();
      }, function (e) {
        entries.push({ level: 'error', text: String(e && e.message ? e.message : e) });
        finish();
      });
      return;
    }
    finish();
  }

  function runAll() {
    cells().forEach(function (src, i) {
      if (isKernel(src)) return;
      runInline(src, idOf(src, i));
    });
  }

  /* ---------- wiring ---------- */

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;

    /* The parent asked for this index; it already knows. Only in-iframe
       navigation (the arrow keys below) is news worth adopting. */
    if (d.type === 'nb:goto') goto(d.index, 'boot');
    /* A sync carries the parent's index, so echoing it back is not news —
       report it as 'boot' so the parent does not adopt its own stale value. */
    if (d.type === 'nb:sync') { collect(); ensureStyle(); mount(); fitAll(); goto(d.index == null ? current : d.index, 'boot'); }
    if (d.type === 'nb:run-cell') { var s1 = findSrc(d.id); if (s1) run(s1, d.id); }
    if (d.type === 'nb:run-all') runAll();
    if (d.type === 'nb:focus-cell') {
      var s3 = findSrc(d.id);
      if (s3) {
        /*
         * Select and flash, never scroll.
         *
         * scrollIntoView on a box inside a slide whose document is
         * overflow:hidden does not scroll anything — it shifts the iframe's
         * viewport and leaves the operator somewhere with no scroll control to
         * get back. The slide always fits the frame, so the cell is already on
         * screen; a ring says where it is without moving anything.
         */
        select_(s3.parentNode);
        var target = s3.parentNode;
        target.classList.remove('nb-flash');
        // Force a reflow so a second click re-runs the animation.
        void target.offsetWidth;
        target.classList.add('nb-flash');
        setTimeout(function () { target.classList.remove('nb-flash'); }, 1200);
      }
    }

    if (d.type === 'nb:kout') {
      running[d.id] = false;
      records[d.id] = d.record || {};
      if (d.record) {
        var list = history[d.id] || (history[d.id] = []);
        list.push({ at: Date.now(), record: d.record });
        // A long session should not grow without bound; the last 20 runs are
        // what anyone scrolls back through.
        if (list.length > 20) list.shift();
      }
      var s2 = findSrc(d.id);
      if (s2) paint(s2.parentNode, d.id);
    }

    if (d.type === 'nb:edit') {
      editOn = !!d.on;
      var boxes = document.querySelectorAll('.nb-cell');
      for (var i = 0; i < boxes.length; i++) boxes[i].classList.toggle('nb-edit', editOn);
    }

    /* In-place patch: the parent changed geometry, source or lang without a
       reload. Keeps the iframe from re-running every cell on each drag. */
    if (d.type === 'nb:patch') {
      (d.cells || []).forEach(function (patch) {
        var src = findSrc(patch.id);
        if (!src) return;
        var box = src.parentNode;
        if (patch.box) {
          ['x', 'y', 'w', 'h'].forEach(function (k) {
            if (patch.box[k] == null) return;
            box.setAttribute('data-cell-' + k, patch.box[k]);
          });
          applyGeometry(box);
        }
        if (patch.lang) {
          src.setAttribute('data-lang', patch.lang);
          var sel = box.querySelector('select');
          if (sel) sel.value = patch.lang;
          // Keep the grammar in step, and keep run() from using the old one.
          if (box.__nbEditor && box.__nbEditor.setLanguage) box.__nbEditor.setLanguage(patch.lang);
        }
        if (typeof patch.source === 'string') {
          var prev = (src.textContent || '').replace(/^\\n/, '').replace(/\\s+$/, '');
          if (prev !== patch.source) {
            src.textContent = '\\n' + patch.source + '\\n';
            var pre = box.querySelector('.nbc-pre');
            if (pre) pre.textContent = patch.source;
            // The editor, not a textarea: CodeMirror owns the source now, and
            // writing to a stale textarea would silently diverge.
            delete drafts[patch.id];
            if (box.__nbEditor && box.__nbEditor.setValue) box.__nbEditor.setValue(patch.source);
          }
        }
      });
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); goto(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goto(current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goto(0); }
    else if (e.key === 'End') { e.preventDefault(); goto(slides.length - 1); }
    else if (e.key === 'Escape') { hideOutput(); select_(null); }
  });

  window.addEventListener('resize', function () { render(); fitAll(); });
  // A popover anchored to a box that just moved or scrolled is in the wrong
  // place; dismiss rather than chase it.
  window.addEventListener('scroll', hideOutput, true);

  function boot(index) {
    ensureStyle();
    collect();
    mount();
    goto(index || 0, 'boot');
    post({ type: 'nb:runtime', editable: EDITABLE });
    runAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(0); });
  } else {
    boot(0);
  }

  window.__nb = {
    goto: goto, collect: collect, render: render, runAll: runAll, mount: mount,
    run: function (id) { var s = findSrc(id); if (s) run(s, id); }
  };
})();
<\/script>`;
}

/** What a standalone export ships: presentation, no editing chrome. */
export const RUNTIME_SCRIPT = makeRuntime({ editable: false });

/** The app builds an editable runtime carrying the current UI palette. */
export function editableRuntime({ theme, accent } = {}) {
  return makeRuntime({ editable: true, theme, accent });
}

const RUNTIME_RE = new RegExp(
  `<script\\s+id\\s*=\\s*["']${RUNTIME_ID}["'][^>]*>[\\s\\S]*?<\\/script\\s*>\\s*`,
  'i',
);

export function injectRuntime(html, runtime = RUNTIME_SCRIPT) {
  if (html.includes(`id="${RUNTIME_ID}"`)) return html;
  const bodyClose = html.search(/<\/body>/i);
  if (bodyClose !== -1) return `${html.slice(0, bodyClose)}${runtime}\n${html.slice(bodyClose)}`;
  return `${html}\n${runtime}`;
}

export function stripRuntime(html) {
  return html.replace(RUNTIME_RE, '');
}

export function extractOutline(html) {
  const out = [];
  const re = /<(section|div)\b[^>]*class\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>/gi;
  const idRe = /data-slide-id\s*=\s*["']([^"']+)["']/i;
  let m;
  while ((m = re.exec(html))) {
    const id = m[0].match(idRe);
    const rest = html.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const text = rest.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70);
    out.push({ id: id ? id[1] : null, title: text || '(empty slide)' });
  }
  return out;
}