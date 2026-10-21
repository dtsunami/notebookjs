import * as cells from '../server/cells.js';
import { ensureSlideIds } from '../server/doc.js';
import { ensureCellIds } from '../src/lib/cells.js';

const base = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body>
<div id="deck">
<section class="slide"><h2>A</h2></section>
<section class="slide"><h2>B</h2></section>
</div>
</body>
</html>`;

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) failures += 1;
};

let deck = ensureCellIds(ensureSlideIds(base));

check('no cells initially', cells.listCells(deck).length === 0);
check('slides received ids', /data-slide-id="s1"/.test(deck) && /data-slide-id="s2"/.test(deck));

const SRC = "const el = cell.$('h2');\ncell.every(1000, () => { el.textContent = Date.now(); });";

const created = cells.createCell(deck, { slideId: 's2', source: SRC });
check('createCell returns an id', !!created.id);
check('createCell reports its slide', created.slideId === 's2');
deck = created.html;

const listed = cells.listCells(deck);
check('one cell is listed', listed.length === 1);
check('cell maps to slide s2', listed[0] && listed[0].slideId === 's2');

const read = cells.readCell(deck, created.id);
check('readCell round-trips the source', read.source === SRC);

const updated = cells.updateCell(deck, { id: created.id }, "console.log('replaced');");
check('updateCell keeps the id', updated.id === created.id);
check('updateCell replaced the body', cells.readCell(updated.html, created.id).source === "console.log('replaced');");

const deleted = cells.deleteCell(updated.html, { id: created.id });
check('deleteCell removes the cell', cells.listCells(deleted.html).length === 0);
check('deleteCell leaves no nb-cell tag', !deleted.html.includes('nb-cell'));
check('slides survive cell deletion', (deleted.html.match(/data-slide-id/g) || []).length === 2);

const TRICKY = "const s = '</script>'; console.log(s);";
const tricky = cells.createCell(deleted.html, { slideId: 's1', source: TRICKY });
check('escapes a literal closing script tag', tricky.html.includes('<\\/script'));
check('tricky cell stays parseable', cells.listCells(tricky.html).length === 1);
check('tricky cell round-trips', cells.readCell(tricky.html, tricky.id).source === TRICKY);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall cell checks passed');
process.exit(failures ? 1 : 0);