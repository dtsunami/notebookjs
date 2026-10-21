import React from 'react';
import ChatPanel from './ChatPanel.jsx';

export default function ChatDock({
  open,
  onToggle,
  messages,
  outline,
  onSend,
  busy,
  onCancel,
  onClear,
}) {
  const unread = !open && messages.length > 0;

  return (
    <div className={open ? 'chatdock open' : 'chatdock'}>
      <button
        type="button"
        className="chatdock-tab"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? 'Hide assistant' : 'Show assistant'}
      >
        <span className="chatdock-icon">✦</span>
        <span className="chatdock-label">Assistant</span>
        {busy && <span className="chatdock-pulse" />}
        {unread && !busy && <span className="chatdock-count">{messages.length}</span>}
        <span className="chatdock-chevron">{open ? '▾' : '▴'}</span>
      </button>

      {open && (
        <div className="chatdock-body">
          <ChatPanel
            messages={messages}
            outline={outline}
            onSend={onSend}
            busy={busy}
            onCancel={onCancel}
            onClear={onClear}
          />
        </div>
      )}
    </div>
  );
}