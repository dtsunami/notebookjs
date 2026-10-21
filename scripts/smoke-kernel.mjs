import * as kernel from '../server/kernel/index.js';

let failures = 0;

const check = (label, cond, detail) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${cond || !detail ? '' : ` — ${detail}`}`);
  if (!cond) failures += 1;
};

// fmt() renders a string result as-is, so `typeof x` comes back as undefined,
// not "undefined". These helpers read entries without assuming JSON quoting.
const returned = (res) => (res.entries || []).filter((e) => e.level === 'return');
const lastReturn = (res) => {
  const r = returned(res);
  return r.length ? r[r.length - 1].text : undefined;
};

const DECK = `smoke-${Date.now()}`;

try {
  const first = await kernel.exec({ deckId: DECK, lang: 'javascript', code: 'var a = 41;' });
  check('exec runs', first.ok, JSON.stringify(first.entries));

  const second = await kernel.exec({ deckId: DECK, lang: 'javascript', code: 'a + 1' });
  check('state persists between cells', lastReturn(second) === '42', JSON.stringify(second.entries));

  const logged = await kernel.exec({
    deckId: DECK,
    lang: 'javascript',
    code: "console.log('hello', { n: 7 });",
  });
  check(
    'console output is captured',
    logged.entries.some((e) => e.level === 'log' && e.text.includes('hello')),
    JSON.stringify(logged.entries),
  );

  const thrown = await kernel.exec({
    deckId: DECK,
    lang: 'javascript',
    code: "throw new Error('boom');",
  });
  check(
    'errors are reported, not fatal',
    !thrown.ok && thrown.entries.some((e) => e.level === 'error'),
    JSON.stringify(thrown.entries),
  );

  const survives = await kernel.exec({ deckId: DECK, lang: 'javascript', code: 'a * 2' });
  check('kernel survives an error', lastReturn(survives) === '82', JSON.stringify(survives.entries));

  const awaited = await kernel.exec({
    deckId: DECK,
    lang: 'javascript',
    code: "globalThis.awaitedValue = await Promise.resolve('awaited');",
  });
  check('top-level await is accepted', awaited.ok, JSON.stringify(awaited.entries));

  const readBack = await kernel.exec({ deckId: DECK, lang: 'javascript', code: 'globalThis.awaitedValue' });
  check('await result survives to the next cell', lastReturn(readBack) === 'awaited', JSON.stringify(readBack.entries));

  const isolated = await kernel.exec({
    deckId: `${DECK}-other`,
    lang: 'javascript',
    code: 'typeof a',
  });
  check(
    'a different deck gets a separate kernel',
    lastReturn(isolated) === 'undefined',
    JSON.stringify(isolated.entries),
  );

  const unsupported = await kernel
    .exec({ deckId: DECK, lang: 'ruby', code: 'puts 1' })
    .then(() => null)
    .catch((e) => e.message);
  check(
    'unsupported language fails cleanly',
    !!unsupported && /No runtime/.test(unsupported),
    unsupported,
  );

  const before = kernel.status().length;
  await kernel.restart({ deckId: DECK, lang: 'javascript' });
  check('restart drops the kernel', kernel.status().length < before);

  const fresh = await kernel.exec({ deckId: DECK, lang: 'javascript', code: 'typeof a' });
  check('restart clears state', lastReturn(fresh) === 'undefined', JSON.stringify(fresh.entries));
} finally {
  await kernel.killAll();
}

// --- Python, skipped cleanly when no interpreter is present ---

try {
  const py = await kernel
    .exec({ deckId: `${DECK}-py`, lang: 'python', code: 'x = 6 * 7' })
    .catch((e) => ({ error: e.message }));

  if (py.error) {
    console.log(`skip python (${py.error.split('.')[0]})`);
  } else {
    check('python cell runs', py.ok, JSON.stringify(py.entries));

    const reads = await kernel.exec({ deckId: `${DECK}-py`, lang: 'python', code: 'x' });
    check(
      'python state persists between cells',
      (reads.entries || []).some((e) => e.level === 'return' && e.text === '42'),
      JSON.stringify(reads.entries),
    );

    const printed = await kernel.exec({
      deckId: `${DECK}-py`,
      lang: 'python',
      code: 'print("hello from python")',
    });
    check(
      'python stdout is captured',
      (printed.entries || []).some((e) => e.level === 'log' && e.text.includes('hello from python')),
      JSON.stringify(printed.entries),
    );

    const pyError = await kernel.exec({
      deckId: `${DECK}-py`,
      lang: 'python',
      code: 'raise ValueError("boom")',
    });
    check(
      'python errors are reported, not fatal',
      !pyError.ok && (pyError.entries || []).some((e) => e.level === 'error'),
      JSON.stringify(pyError.entries),
    );

    const pySurvives = await kernel.exec({ deckId: `${DECK}-py`, lang: 'python', code: 'x + 1' });
    check(
      'python kernel survives an error',
      (pySurvives.entries || []).some((e) => e.level === 'return' && e.text === '43'),
      JSON.stringify(pySurvives.entries),
    );
  }
} finally {
  await kernel.killAll();
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall kernel checks passed');
process.exit(failures ? 1 : 0);