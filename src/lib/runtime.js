export const RUNTIME_ID = 'nb-runtime';

const FIT_CSS =
  'html,body{margin:0;padding:0;height:100%;overflow:hidden}' +
  '.slide{min-height:100vh !important;height:100vh !important;overflow:hidden}' +
  '.slide:not(.nb-visible){display:none !important}' +
  '.slide.nb-visible{display:flex !important}';

export const RUNTIME_SCRIPT = `<script id="${RUNTIME_ID}">
(function () {
  var slides = [];
  var current = 0;
  var FIT = ${JSON.stringify(FIT_CSS)};
  var hasParent = !!(window.parent && window.parent !== window);

  function ensureStyle() {
    var el = document.getElementById('__nb_focus');
    if (!el) {
      el = document.createElement('style');
      el.id = '__nb_focus';
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = FIT;
  }

  function collect() {
    slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  }

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
      type: 'nb:state',
      count: slides.length,
      current: current,
      ids: slides.map(function (s) { return s.getAttribute('data-slide-id'); }),
      titles: slides.map(function (s) {
        return (s.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 70);
      })
    });
  }

  function goto(n) { current = clamp(n); render(); }

  /* ---------- cells ---------- */

  function cellScripts() {
    return Array.prototype.slice.call(document.querySelectorAll('script[type="text/nb-cell"]'));
  }

  function cellId(el, i) {
    var id = el.getAttribute('data-cell-id');
    if (!id) { id = 'cell-' + i; el.setAttribute('data-cell-id', id); }
    return id;
  }

  function scope(el) {
    var slide = el.closest ? el.closest('.slide') : null;
    var root = slide || document;
    return {
      slide: slide,
      root: root,
      $: function (sel) { return root.querySelector(sel); },
      $$: function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); },
      on: function (target, type, fn, opts) { (target || root).addEventListener(type, fn, opts); },
      raf: function (fn) { return window.requestAnimationFrame(fn); },
      every: function (ms, fn) { return window.setInterval(fn, ms); },
      setText: function (sel, text) { var e = root.querySelector(sel); if (e) e.textContent = text; },
      setHtml: function (sel, html) { var e = root.querySelector(sel); if (e) e.innerHTML = html; }
    };
  }

  function runCell(el, id) {
    var src = el.textContent || '';
    var lang = (el.getAttribute('data-lang') || 'javascript').toLowerCase();
    var entries = [];
    if (lang !== 'javascript' && lang !== 'js') {
      post({ type: 'nb:cell-output', id: id, entries: [{ level: 'warn', text: 'No runtime for "' + lang + '" in this build. Cell not executed.' }] });
      return;
    }
    var realConsole = window.console;

    function capture(level) {
      return function () {
        var parts = Array.prototype.slice.call(arguments).map(function (a) {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        });
        entries.push({ level: level, text: parts.join(' ') });
      };
    }

    function flush() {
      post({ type: 'nb:cell-output', id: id, entries: entries });
    }

    window.console = {
      log: capture('log'), info: capture('info'), warn: capture('warn'),
      error: capture('error'), debug: capture('log')
    };

    var returned;
    try {
      var fn = new Function('cell', src + '\\n//# sourceURL=nb-cell-' + id + '.js');
      returned = fn(scope(el));
      if (returned !== undefined) entries.push({ level: 'return', text: String(returned) });
    } catch (err) {
      entries.push({ level: 'error', text: String(err && err.message ? err.message : err) });
    } finally {
      window.console = realConsole;
    }

    if (returned && typeof returned.then === 'function') {
      returned.then(function (v) {
        if (v !== undefined) entries.push({ level: 'return', text: String(v) });
        flush();
      }, function (e) {
        entries.push({ level: 'error', text: String(e && e.message ? e.message : e) });
        flush();
      });
      return;
    }

    flush();
  }

  function postCells() {
    var list = cellScripts().map(function (el, i) {
      return {
        id: cellId(el, i),
        source: (el.textContent || '').replace(/^\\n/, '')
      };
    });
    post({ type: 'nb:cells', cells: list });
  }

  function isKernelCell(el) {
    return (el.getAttribute('data-exec') || '').toLowerCase() === 'kernel';
  }

  function runAll() {
    cellScripts().forEach(function (el, i) {
      if (isKernelCell(el)) return;
      runCell(el, cellId(el, i));
    });
  }

  function runOne(id) {
    var found = cellScripts();
    for (var i = 0; i < found.length; i++) {
      if (cellId(found[i], i) === id) {
        if (isKernelCell(found[i])) {
          post({ type: 'nb:cell-output', id: id, entries: [{ level: 'warn', text: 'Kernel cell: press Run in the Cells tab.' }] });
          return;
        }
        runCell(found[i], id);
        return;
      }
    }
  }

  /* ---------- wiring ---------- */

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d.type !== 'string') return;
    if (d.type === 'nb:goto') goto(d.index);
    if (d.type === 'nb:sync') { collect(); ensureStyle(); goto(d.index == null ? current : d.index); postCells(); }
    if (d.type === 'nb:run-cell') runOne(d.id);
    if (d.type === 'nb:run-all') runAll();
  });

  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); goto(current + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goto(current - 1); }
    else if (e.key === 'Home') { e.preventDefault(); goto(0); }
    else if (e.key === 'End') { e.preventDefault(); goto(slides.length - 1); }
  });

  window.addEventListener('resize', render);

  function boot(index) {
    ensureStyle();
    collect();
    goto(index || 0);
    postCells();
    runAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(0); });
  } else {
    boot(0);
  }

  window.__nb = { goto: goto, collect: collect, render: render, runAll: runAll, runOne: runOne };
})();
<\/script>`;

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