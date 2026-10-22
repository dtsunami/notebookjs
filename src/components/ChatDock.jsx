import React from 'react';
import ChatPanel from './ChatPanel.jsx';

export default function ChatDock({
  open,
  onToggle,
  messages,
  outline,
  onSend,
  busy,
  live,
  stats,
  onCancel,
  onReset,
}) {
  const unread = !open && messages.length > 0;

  return (
    <div className={open ? 'chatdock open' : 'chatdock'}>
      <button
        type="button"
        className="chatdock-tab"
        onClick={onToggle}
        aria-expanded={open}
        title={open ? 'Hide the agent' : 'Show the agent'}
      >
        <span className="chatdock-icon">✦</span>
        <span className="chatdock-label">Agent</span>
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
            live={live}
            stats={stats}
            onCancel={onCancel}
            onReset={onReset}
          />
        </div>
      )}
    </div>
  );
}