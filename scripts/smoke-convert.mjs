/**
 * The conversion path must fail loudly, never silently. These checks run with
 * no LLM key, which is the state a fresh install is in.
 */
import { convertSource } from '../server/convert.js';

let failures = 0;
const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

const saved = process.env.LLM_API_KEY;
delete process.env.LLM_API_KEY;

const noKey = await convertSource({ source: 'console.log(1)', from: 'javascript', to: 'python' });
check('no LLM key is an error, not fake code', noKey.ok === false);
check('the error names the missing key', /LLM_API_KEY/.test(noKey.error || ''), noKey.error);

const empty = await convertSource({ source: '   ', from: 'javascript', to: 'python' });
check('an empty cell is refused', empty.ok === false);
check('the empty-cell error says why', /nothing to convert/i.test(empty.error || ''), empty.error);

// A key that cannot reach a server must produce an error, not a throw.
process.env.LLM_API_KEY = 'sk-not-a-real-key';
process.env.LLM_BASE_URL = 'http://127.0.0.1:9/v1';
const unreachable = await convertSource({
  source: 'console.log(1)',
  from: 'javascript',
  to: 'python',
});
check('an unreachable model is reported', unreachable.ok === false);
check(
  'nothing is returned as source on failure',
  typeof unreachable.source !== 'string',
  unreachable.source,
);

if (saved === undefined) delete process.env.LLM_API_KEY;
else process.env.LLM_API_KEY = saved;

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall convert checks passed');
process.exit(failures ? 1 : 0);