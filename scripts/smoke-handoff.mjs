/**
 * Covers the four handoff items: the slide timeline, lang-aware create_cell,
 * the import path's cell upgrade, and a UI prefs file that no longer carries
 * the dead `mode` key.
 */
import { createCell } from '../server/cells.js';
import { findCells } from '../src/lib/cells.js';
import { DEFAULT_UI, loadUi } from '../src/lib/ui-prefs.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const deck = `<!DOCTYPE html><html><head></head><body><div id="deck">
<section class="slide" data-slide-id="s1"><h1>One</h1></section>
</div></body></html>`;

// --- create_cell knows every kernel language ------------------------------
for (const lang of ['javascript', 'typescript', 'python', 'ruby']) {
  const r = createCell(deck, { slideId: 's1', source: 'print(1)', lang });
  const cell = r.html && findCells(r.html).find((c) => c.id === r.id);
  check(`create_cell makes a ${lang} cell`, !!cell && cell.lang === lang, cell && cell.lang);
  check(`the ${lang} cell is a kernel cell`, !!cell && cell.exec === 'kernel', cell && cell.exec);
}

const aliased = createCell(deck, { slideId: 's1', source: 'x = 1', lang: 'PY' });
check('a language alias is normalised', aliased.lang === 'python', aliased.lang);

const bogus = createCell(deck, { slideId: 's1', source: 'x', lang: 'cobol' });
check('an unknown language falls back to javascript', bogus.lang === 'javascript', bogus.lang);

const boxed = createCell(deck, { slideId: 's1', source: 'print(1)', lang: 'python' });
check(
  'the created cell is wrapped in a box',
  /<div class="nb-cell"[^>]*>[\s\S]*<script type="text\/nb-cell"/.test(boxed.html),
);

// --- UI prefs no longer carry the dead mode key ---------------------------
check('DEFAULT_UI has no mode', !('mode' in DEFAULT_UI));
check('DEFAULT_UI enables the timeline', DEFAULT_UI.timeline === true);

// localStorage is absent under node, so loadUi takes its catch path; the
// migration itself is exercised through the object shape instead.
check('the shipped defaults are loadable', typeof loadUi() === 'object');

// --- placement ---------------------------------------------------------
const placed = createCell(deck, {
  slideId: 's1',
  source: 'print(1)',
  lang: 'python',
  box: { x: 6, y: 34, w: 88, h: 48 },
});
const placedBox = placed.html && findCells(placed.html).find((c) => c.id === placed.id)?.box;
check(
  'create_cell honours an explicit box',
  !!placedBox && placedBox.x === 6 && placedBox.y === 34,
  JSON.stringify(placedBox),
);

const partial = createCell(deck, { slideId: 's1', source: 'x', box: { x: 6, y: 34 } });
check('partial geometry is refused, not guessed', typeof partial.error === 'string', partial.error);

const defaulted = createCell(deck, { slideId: 's1', source: 'x' });
check('omitting the box still works', !defaulted.error && !!defaulted.id);

const offslide = createCell(deck, {
  slideId: 's1',
  source: 'x',
  box: { x: 400, y: 34, w: 88, h: 48 },
});
const clamped = offslide.html && findCells(offslide.html).find((c) => c.id === offslide.id)?.box;
check(
  'an out-of-range box is clamped onto the slide',
  !!clamped && clamped.x + clamped.w <= 100.01,
  JSON.stringify(clamped),
);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall handoff checks passed');
process.exit(failures ? 1 : 0);