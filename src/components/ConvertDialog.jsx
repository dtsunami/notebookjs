import React, { useEffect } from 'react';

/**
 * Asked when a cell's language changes and the cell has source in it.
 *
 * There is no undo in this app — every edit goes straight into the document —
 * so a rewrite never happens silently. Three outcomes:
 *
 *   Convert   ask the assistant, then show the result for approval
 *   Keep      change the language and leave the source alone
 *   Cancel    put the language back where it was
 *
 * The converted source is shown before it is applied, because a model can
 * produce code that is plausible and wrong.
 */
export default function ConvertDialog({
  request,
  busy,
  result,
  error,
  onConvert,
  onKeep,
  onApply,
  onCancel,
}) {
  useEffect(() => {
    if (!request) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [request, onCancel]);

  if (!request) return null;

  const stage = error ? 'error' : result ? 'review' : busy ? 'busy' : 'ask';

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Convert cell">
      <div className="drawer-scrim" onClick={onCancel} />
      <aside className="drawer convert-dialog">
        <header className="drawer-head">
          <h3>
            Convert <code>{request.from}</code> → <code>{request.to}</code>
          </h3>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close">
            ×
          </button>
        </header>

        <div className="drawer-body convert-body">
          {stage === 'ask' && (
            <>
              <p className="panel-hint">
                This cell has code written for <strong>{request.from}</strong>. Ask the assistant to
                rewrite it as <strong>{request.to}</strong>?
              </p>
              <p className="panel-hint">
                Some things do not cross languages — JavaScript cells can reach the slide&rsquo;s DOM
                through <code>cell.$</code>, which Python and Ruby cannot. The assistant is told to
                refuse rather than invent an equivalent.
              </p>
              <div className="panel-actions tight wrap">
                <button type="button" className="primary" onClick={onConvert}>
                  Convert with the assistant
                </button>
                <button type="button" className="ghost" onClick={onKeep}>
                  Keep the source as-is
                </button>
                <button type="button" className="ghost" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {stage === 'busy' && (
            <p className="panel-hint">Converting — this is one model call, usually a second or two.</p>
          )}

          {stage === 'error' && (
            <>
              <p className="panel-hint danger">{error}</p>
              <p className="panel-hint">
                The language was left unchanged and the source was not touched.
              </p>
              <div className="panel-actions tight wrap">
                <button type="button" className="ghost" onClick={onCancel}>
                  Close
                </button>
              </div>
            </>
          )}

          {stage === 'review' && (
            <>
              <p className="panel-hint">{result.notes}</p>
              <div className="convert-pair">
                <div>
                  <h4>{request.from}</h4>
                  <pre className="convert-code">{request.source}</pre>
                </div>
                <div>
                  <h4>{request.to}</h4>
                  <pre className="convert-code">{result.source}</pre>
                </div>
              </div>
              <div className="panel-actions tight wrap">
                <button type="button" className="primary" onClick={onApply}>
                  Apply conversion
                </button>
                <button type="button" className="ghost" onClick={onKeep}>
                  Keep the original source
                </button>
                <button type="button" className="ghost" onClick={onCancel}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}