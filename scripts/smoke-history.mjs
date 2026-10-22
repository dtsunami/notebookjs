/**
 * History is what makes a destructive edit survivable, so its edge cases are
 * worth more than its happy path: coalescing, branch discard, projection.
 */
import { createHistory, versionsOf } from '../src/lib/history.js';
import { findCells, replaceCellSource } from '../src/lib/cells.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

// A clock we control, so coalescing is deterministic.
let clock = 0;
const h = createHistory({ coalesceMs: 100, now: () => clock });

h.reset('<A>');
check('reset seeds one entry', h.size() === 1);
check('nothing to undo at the seed', h.canUndo() === false);

clock = 10;
h.record('<B>', 'source');
check('a record is undoable', h.canUndo() === true);

clock = 20;
h.record('<C>', 'source');
check('same label inside the window coalesces', h.size() === 2, String(h.size()));

clock = 500;
h.record('<D>', 'source');
check('same label outside the window stacks', h.size() === 3, String(h.size()));

const back = h.undo();
check('undo returns the previous document', back === '<C>', back);
check('redo is available after undo', h.canRedo() === true);
check('the label names what would be redone', h.redoLabel() === 'source');

clock = 600;
h.record('<E>', 'different');
check('editing after undo discards the redo branch', h.canRedo() === false);
check('the new tip is the edit', h.current() === '<E>', h.current());

const dup = h.record('<E>', 'noop');
check('recording identical html is a no-op', dup === false);

const capped = createHistory({ limit: 3, now: () => clock });
capped.reset('<1>');
for (const v of ['<2>', '<3>', '<4>']) {
  clock += 1000;
  capped.record(v, 'edit');
}
check('the stack is capped', capped.size() === 3, String(capped.size()));
check('the oldest entry is dropped', capped.current() === '<4>');
check('only two undos remain after the cap', [capped.undo(), capped.undo(), capped.undo()].filter((v) => v != null).length === 2);

// --- projection: a cell's own versions -------------------------------------
const deck = `<!DOCTYPE html><html><head></head><body><div id="deck">
<section class="slide" data-slide-id="s1"><h1>One</h1>
<script type="text/nb-cell" data-cell-id="c1" data-lang="python">print(1)</script>
</section>
</div></body></html>`;

const sourceOf = (html) => findCells(html).find((c) => c.id === 'c1')?.source ?? null;

const v1 = deck;
const v2 = replaceCellSource(deck, { id: 'c1' }, 'print(2)');
const v3 = replaceCellSource(v2, { id: 'c1' }, 'print(3)');
const snapshots = [
  { html: v1, at: 1, label: 'open' },
  { html: v2, at: 2, label: 'source' },
  { html: v2, at: 3, label: 'geometry' }, // a drag: the cell's source is unchanged
  { html: v3, at: 4, label: 'source', active: true },
];

const cellVersions = versionsOf(snapshots, sourceOf);
check('only changes to the cell count as its versions', cellVersions.length === 3, String(cellVersions.length));
check('the versions are the source states, in order', cellVersions.map((v) => v.value).join('|') === 'print(1)|print(2)|print(3)');
check('the live version is marked', cellVersions[cellVersions.length - 1]?.active === true);
check('a geometry-only snapshot is not a source version', !cellVersions.some((v) => v.label === 'geometry'));

const gone = versionsOf([{ html: '<html></html>', at: 5, label: 'delete' }], sourceOf);
check('a deleted cell has no versions in that snapshot', gone.length === 0);

const unparseable = versionsOf([{ html: 'not html at all <<<', at: 6, label: 'x' }], sourceOf);
check('a snapshot with no cell is skipped, not thrown', unparseable.length === 0);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall history checks passed');
process.exit(failures ? 1 : 0);