import React, { useEffect, useState } from 'react';

const LEVEL_CLASS = {
  error: 'o-error',
  warn: 'o-warn',
  return: 'o-return',
  info: 'o-log',
  log: 'o-log',
};

/**
 * Cell output, docked over the stage. A run opens it with a flash; it folds
 * back to its bar after `timeout` ms unless it is pinned. Same shape as the
 * assistant dock so the two read as one family.
 *
 * `runs` is newest-first and owned by App: [{ cellId, seq, at }].
 */
export default function CellOutputDock({
  open,
  pinned,
  onToggle,
  onPinToggle,
  onClear,
  onSendToAgent,
  agentBusy = false,
  runs,
  outputs,
  running,
  timeout,
  runKey = 0,
}) {
  const pending = Object.keys(running || {}).filter((id) => running[id]);

  // `running` only changes on start and finish, so a slow cell would sit on
  // "running…" with no sign of life. Tick while any run is open.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (pending.length === 0) return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [pending.length]);

  const rows = [];
  const seen = new Set();
  for (const id of pending) {
    seen.add(id);
    rows.push({ cellId: id, seq: 'pending', pending: true });
  }
  for (const run of runs || []) {
    if (seen.has(run.cellId)) continue;
    seen.add(run.cellId);
    rows.push(run);
  }

  const latest = rows[0];
  const latestOut = latest ? (outputs || {})[latest.cellId] : null;
  const seconds = Math.max(1, Math.round((Number(timeout) || 4500) / 1000));

  // What the collapsed bar shows: the first line of the newest output, so the
  // minimised dock still says something useful without being opened.
  const peek = latestOut
    ? String(latestOut.error || latestOut.entries?.[0]?.text || '')
        .split('\n')[0]
        .trim()
        .slice(0, 64)
    : '';

  let state = '';
  if (pending.length) state = 'running…';
  else if (latestOut?.error) state = 'error';
  else if (latestOut?.ms != null) state = `${latestOut.ms} ms`;
  else if (rows.length) state = 'done';
  else state = 'idle';

  return (
    <div className={open ? 'outdock open' : 'outdock'}>
      {runKey ? <span key={runKey} className="outdock-burst" aria-hidden="true" /> : null}
      <div className="outdock-bar">
        <button
          type="button"
          className="outdock-tab"
          onClick={onToggle}
          aria-expanded={!!open}
          title={open ? 'Minimise output' : 'Show output'}
        >
          <span className="outdock-icon">{pending.length ? <span className="spin" /> : '▤'}</span>
          <span className="outdock-label">Output</span>
          <span className="outdock-state">
            {state}
            {open && !pinned && rows.length > 0 ? ` · folds in ${seconds}s` : ''}
          </span>
          {latest && <span className="outdock-cell">{latest.cellId}</span>}
          {!open && peek && (
            <span className={latestOut?.error ? 'outdock-peek bad' : 'outdock-peek'}>{peek}</span>
          )}
          <span className="outdock-chevron">{open ? '▾' : '▴'}</span>
        </button>
        <button
          type="button"
          className={pinned ? 'outdock-pin on' : 'outdock-pin'}
          onClick={onPinToggle}
          title={pinned ? 'Unpin — let it fold away' : 'Pin open'}
          aria-pressed={!!pinned}
        >
          ⌖
        </button>
        {open && rows.length > 0 && (
          <button type="button" className="outdock-pin" onClick={onClear} title="Clear output">
            ×
          </button>
        )}
      </div>

      <div className="outdock-bodywrap">
        <div className="outdock-body">
          {rows.length === 0 && (
            <p className="outdock-empty">
              Run a cell with <strong>▶</strong> and it executes on the kernel. The output lands
              here, flashes, then folds back into this bar after {seconds}s.
            </p>
          )}

          {rows.map((run) => {
            const record = (outputs || {})[run.cellId] || {};
            const entries = record.entries || [];
            return (
              <section
                key={`${run.cellId}:${run.seq}`}
                className={record.error ? 'outdock-run bad' : 'outdock-run'}
              >
                <header className="outdock-run-head">
                  <span className="outdock-dot" />
                  <span>{run.cellId}</span>
                  {run.pending ? (
                    <span className="outdock-meta">running…</span>
                  ) : (
                    record.ms != null && <span className="outdock-meta">{record.ms} ms</span>
                  )}
                  {run.at && (
                    <span className="outdock-meta outdock-when">
                      {new Date(run.at).toLocaleTimeString()}
                    </span>
                  )}

                  {/*
                    * A failed run is the moment the agent is most useful, so the
                    * ask is offered right where the error is read rather than
                    * only in the in-slide popover. A clean run gets the same
                    * action, quietly — "explain this" is a fair question too.
                    */}
                  {!run.pending && onSendToAgent && (
                    <button
                      type="button"
                      className={
                        record.error ? 'outdock-ask bad' : 'outdock-ask'
                      }
                      onClick={() => onSendToAgent(run.cellId)}
                      disabled={agentBusy}
                      title={
                        agentBusy
                          ? 'The assistant is busy'
                          : record.error
                            ? 'Send this error and the cell source to the assistant'
                            : 'Send this output and the cell source to the assistant'
                      }
                    >
                      {record.error ? '✦ Fix with agent' : '✦ Ask agent'}
                    </button>
                  )}
                </header>
                <div className="outdock-run-body">
                  {run.pending && <div className="o-log">Waiting for the kernel…</div>}
                  {!run.pending && record.error && <div className="o-error">{record.error}</div>}
                  {!run.pending && !record.error && entries.length === 0 && (
                    <div className="o-log o-empty">No output.</div>
                  )}
                  {!run.pending &&
                    entries.map((entry, i) => (
                      <div key={i} className={LEVEL_CLASS[entry.level] || 'o-log'}>
                        {entry.level === 'return' ? '⇒ ' : ''}
                        {entry.text}
                      </div>
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}