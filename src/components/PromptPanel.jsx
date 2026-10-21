import React, { useEffect, useState } from 'react';

export default function PromptPanel({ value, defaultPrompt, onChange, onReset }) {
  const [draft, setDraft] = useState(value ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(value ?? '');
    setDirty(false);
  }, [value]);

  useEffect(() => {
    if (!defaultPrompt) return;
    setDraft((d) => (d ? d : defaultPrompt));
  }, [defaultPrompt]);

  const save = () => {
    onChange(draft);
    setDirty(false);
  };

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h4>System prompt</h4>
        <p className="panel-hint">
          Sent as the first message on every request. Leave blank to use the built-in prompt on the server.
        </p>
        <textarea
          className="prompt-editor"
          value={draft}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
        />
        <div className="panel-actions">
          <button type="button" onClick={save} disabled={!dirty}>
            {dirty ? 'Save prompt' : 'Saved'}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setDraft(defaultPrompt || '');
              setDirty(true);
            }}
            disabled={!defaultPrompt}
          >
            Load built-in
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setDraft('');
              onChange('');
              setDirty(false);
            }}
          >
            Clear
          </button>
        </div>
      </section>

      <section className="panel-section">
        <h4>Effective prompt</h4>
        <pre className="prompt-preview">{draft || defaultPrompt || '(none)'}</pre>
      </section>
    </div>
  );
}