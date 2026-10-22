/**
 * Cell-box data model checks. No DOM, no server: this only exercises the
 * HTML rewriting in src/lib/cells.js, which is where positions get lost if
 * the index arithmetic is wrong.
 */
import {
  findCells,
  ensureCellBoxes,
  ensureCellIds,
  setCellGeometry,
  setCellMeta,
  replaceCellSource,
  removeCell,
  insertCell,
} from '../src/lib/cells.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const bare = `<!DOCTYPE html>
<html><body><div id="deck">
<section class="slide" data-slide-id="s1">
  <h1>One</h1>
  <script type="text/nb-cell" data-lang="python" data-exec="kernel">
print("hi")
  </script>
</section>
</div></body></html>`;

// --- bare script -> boxed element -------------------------------------

const boxed = ensureCellBoxes(bare);
const cells1 = findCells(boxed);
check('one cell survives the upgrade', cells1.length === 1, String(cells1.length));
check('cell got an id', cells1[0].id === 'c1', cells1[0].id);
check('cell got a box', !!cells1[0].box, JSON.stringify(cells1[0].box));
check('wrapper wraps the script', /<div class="nb-cell"[^>]*>\s*<script/.test(boxed));
check('wrapper is closed', boxed.includes('</script></div>'));
check('source is unchanged', cells1[0].source === 'print("hi")', JSON.stringify(cells1[0].source));
check('lang survives', cells1[0].lang === 'python', cells1[0].lang);
check('exec survives', cells1[0].exec === 'kernel', cells1[0].exec);

const again = ensureCellBoxes(boxed);
check('ensureCellBoxes is idempotent', again === boxed);

// --- geometry ---------------------------------------------------------

const moved = setCellGeometry(boxed, 'c1', { x: 10, y: 20, w: 30, h: 40 });
const m1 = findCells(moved)[0];
check(
  'geometry round-trips',
  m1.box.x === 10 && m1.box.y === 20 && m1.box.w === 30 && m1.box.h === 40,
  JSON.stringify(m1.box),
);
check('geometry lands in the style attribute', /left:10%;top:20%/.test(moved));
check('style is not duplicated', (moved.match(/style="/g) || []).length === 1);
check('geometry edit keeps the source', m1.source === 'print("hi")');

const clamped = findCells(setCellGeometry(moved, 'c1', { x: -20, w: 400 }))[0];
check('x is clamped at 0', clamped.box.x === 0, String(clamped.box.x));
check('w is clamped at 100', clamped.box.w === 100, String(clamped.box.w));

const halfway = findCells(setCellGeometry(moved, 'c1', { x: 12.345 }))[0];
check('fractional percent survives', halfway.box.x === 12.35, String(halfway.box.x));

// --- source and meta edits inside a box --------------------------------

const edited = replaceCellSource(moved, { id: 'c1' }, 'print("edited")');
const e1 = findCells(edited)[0];
check('source edit round-trips', e1.source === 'print("edited")', JSON.stringify(e1.source));
check('source edit keeps geometry', e1.box.x === 10);

const relang = findCells(setCellMeta(moved, 'c1', { lang: 'ruby', exec: 'inline' }))[0];
check('lang can be changed', relang.lang === 'ruby', relang.lang);
check('exec can be changed', relang.exec === 'inline', relang.exec);
check('meta edit keeps source', relang.source === 'print("hi")');
check('meta edit keeps geometry', relang.box.x === 10);

// --- removal ----------------------------------------------------------

const gone = removeCell(moved, { id: 'c1' });
check('the cell is gone', findCells(gone).length === 0);
check('the wrapper is gone too', !gone.includes('nb-cell'), gone.slice(-200));
check('the slide is intact', gone.includes('data-slide-id="s1"') && gone.includes('</section>'));

// --- insertion --------------------------------------------------------

const added = insertCell(boxed, { slideId: 's1', lang: 'ruby', source: 'puts 1' });
const cells2 = findCells(added);
check('insert adds one cell', cells2.length === 2, String(cells2.length));
check('insert picks the next id', cells2[1].id === 'c2', cells2[1].id);
check('insert creates a box', !!cells2[1].box);
check('insert lands inside the slide', added.indexOf('puts 1') < added.indexOf('</section>'));
check('insert does not stack boxes', cells2[0].box.y !== cells2[1].box.y);

// --- hand-written ids -------------------------------------------------

const handWritten = ensureCellIds(
  '<div id="deck"><section class="slide" data-slide-id="s1">' +
    '<script type="text/nb-cell" data-cell-id="c7">1</script></section></div>',
);
const hand = findCells(handWritten)[0];
check('an existing id is respected', hand.id === 'c7', hand.id);
check('a later cell skips past a high id', insertCell(handWritten, { slideId: 's1' }).includes('data-cell-id="c8"'));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall cell-box checks passed');
process.exit(failures ? 1 : 0);