/**
 * The runtime is shipped as a string, so the bundler never parses it and a
 * syntax error would only appear in the browser. This compiles it here instead.
 */
import { editableRuntime, RUNTIME_SCRIPT } from '../src/lib/runtime.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

function bodyOf(script) {
  const open = script.indexOf('>');
  const close = script.lastIndexOf('</script>');
  return script.slice(open + 1, close === -1 ? undefined : close);
}

/**
 * Compile only; never execute a deck runtime in this process.
 *
 * The error is returned rather than swallowed: a runtime that does not parse
 * fails in three cases at once, and "FAIL compiles" with no reason costs a
 * round trip to diagnose. A stray backtick or an unescaped \n inside the
 * template literal is the usual cause.
 *
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function parse(script) {
  try {
    new Function(bodyOf(script));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

for (const [label, src] of [
  ['export runtime', RUNTIME_SCRIPT],
  ['editable runtime (dark)', editableRuntime({ theme: 'dark', accent: 'indigo' })],
  ['editable runtime (light)', editableRuntime({ theme: 'light', accent: 'emerald' })],
]) {
  const parsed = parse(src);
  check(`${label} compiles`, parsed.ok, parsed.error);
  // The escaped closing tag inside the string is what stops the browser from
  // ending the script early. A raw one here would truncate the whole runtime.
  check(`${label} escapes its own closing tag`, !bodyOf(src).includes('</script'));
}

const editable = editableRuntime({ theme: 'light', accent: 'rose' });
check('editable runtime carries EDITABLE', /var EDITABLE = true/.test(editable));
check('export runtime does not', /var EDITABLE = false/.test(RUNTIME_SCRIPT));
check('palette is handed in', /var THEME = "light"/.test(editable));
check('accent is handed in', /var ACCENT = "rose"/.test(editable));
check('the accent palette resolves', /#fb7185/.test(editable));
// An export has no editor, so the source textarea must not be in its markup.
// (The .nbc-src CSS rules are always present; the element is what matters.)
check('export ships no editor', !bodyOf(RUNTIME_SCRIPT).includes("class='nbc-src'"));
check('the app ships one', bodyOf(editable).includes("class='nbc-src'"));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall runtime checks passed');
process.exit(failures ? 1 : 0);