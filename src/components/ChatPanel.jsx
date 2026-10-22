import React, { useEffect, useMemo, useRef, useState } from 'react';
import { promptSuggestions } from '../lib/chat.js';

export default function ChatPanel({
  messages,
  outline,
  onSend,
  busy,
  live,
  stats,
  onCancel,
  onReset,
}) {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const submit = (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput('');
    setShowSuggestions(false);
  };

  // Sampled once per mount. Re-sampling on every render would make the chips
  // jump while the user is reaching for one — the exact frustration a
  // suggestion list is meant to remove.
  const suggestions = useMemo(
    () => promptSuggestions(outline, showSuggestions ? 5 : 3),
    // Intentionally not keyed on `outline`: the deck changing mid-session should
    // not silently swap the chips out from under a click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="chat-panel">
      <div className="pane-header chat-head">
        <span>Agent</span>
        {/* What the turn actually cost, in the header rather than buried in the
            message. `usage` is null when the provider does not report it. */}
        {stats && (
          <span className="chat-stats">
            {stats.usage ? (
              <span title={`${stats.usage.prompt_tokens} in / ${stats.usage.completion_tokens} out`}>
                {stats.usage.total_tokens.toLocaleString()} tok
              </span>
            ) : null}
            {stats.tools ? <span title="Tool calls this session">{stats.tools} tool{stats.tools === 1 ? '' : 's'}</span> : null}
            {stats.turns ? <span>{stats.turns} turn{stats.turns === 1 ? '' : 's'}</span> : null}
          </span>
        )}
        <button
          type="button"
          className="link"
          onClick={onReset}
          title="Start a new agent session: clears the transcript and the model's view of the deck"
          disabled={busy}
        >
          new session
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>The agent edits the deck through tools. It can read slides, make exact replacements, insert and reorder slides, place and rewrite cells, restyle the deck, and screenshot the result to check its work.</p>
            <p className="muted">Try one of these:</p>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => {
          if (m.role === 'user') {
            return (
              <div key={i} className="chat-msg user">
                <div className="bubble">{m.content}</div>
              </div>
            );
          }
          return (
            <div key={i} className={m.error ? 'chat-msg assistant' : 'chat-msg assistant'}>
              <div className={m.error ? 'bubble error-bubble' : 'bubble'}>
                <div className="bubble-text">{m.content}</div>
                {m.meta?.thinking && (
                  <details className="thinking done-thinking">
                    <summary>Reasoning</summary>
                    <div className="thinking-body">{m.meta.thinking}</div>
                  </details>
                )}
                {m.meta && (
                  <div className="bubble-meta">
                    {m.meta.steps != null && <span>{m.meta.steps} step{m.meta.steps === 1 ? '' : 's'}</span>}
                    {m.meta.model && <span>{m.meta.model}</span>}
                    {m.meta.changed === false && <span>no changes</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {busy && (
          <div className="chat-msg assistant">
            <div className="bubble live-bubble">
              {/* Thinking is shown while it happens and folded away once the
                  answer starts — the same shape as the final message. */}
              {live?.thinking && (
                <details className="thinking" open={!live.answering}>
                  <summary>
                    {live.answering ? 'Thought for a moment' : 'Thinking…'}
                  </summary>
                  <div className="thinking-body">{live.thinking}</div>
                </details>
              )}

              {live?.tools?.length > 0 && (
                <ul className="tool-list">
                  {live.tools.map((t, i) => (
                    <li key={`${t.name}-${i}`} className={t.done ? 'tool done' : 'tool'}>
                      <span className="tool-dot" />
                      <code>{t.name}</code>
                      {t.target ? <span className="tool-target">{t.target}</span> : null}
                    </li>
                  ))}
                </ul>
              )}

              {live?.answering ? (
                <div className="live-answer">
                  {live.chars || 0} chars
                </div>
              ) : !live?.thinking ? (
                <div className="typing">
                  <span className="dot" /><span className="dot" /><span className="dot" />
                </div>
              ) : null}

              <div className="live-foot">
                <button type="button" className="link" onClick={onCancel}>cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {showSuggestions && messages.length > 0 && (
        <div className="suggestions inline">
          {suggestions.slice(0, 3).map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setInput(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form className="chat-input" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask the agent to build or change slides…"
          rows={2}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}