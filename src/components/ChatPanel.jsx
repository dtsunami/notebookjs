import React, { useEffect, useRef, useState } from 'react';
import { promptSuggestions } from '../lib/chat.js';

export default function ChatPanel({ messages, outline, onSend, busy, onCancel, onClear }) {
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

  const suggestions = promptSuggestions(outline);

  return (
    <div className="chat-panel">
      <div className="pane-header">
        <span>Assistant</span>
        <button type="button" className="link" onClick={onClear} disabled={messages.length === 0}>
          clear
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>The assistant edits the deck through tools. It can read slides, make exact replacements, insert and reorder slides, restyle the deck, and screenshot the result to check its work.</p>
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
            <div className="bubble typing">
              <span className="dot" /><span className="dot" /><span className="dot" />
              <button type="button" className="link" onClick={onCancel}>cancel</button>
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
          placeholder="Ask the assistant to build or change slides…"
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