import React, { useEffect } from 'react';

export default function Toast({ message, tone = 'info', onDone, duration = 4000 }) {
  useEffect(() => {
    if (!message) return undefined;
    const t = setTimeout(() => onDone && onDone(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onDone]);

  if (!message) return null;

  return (
    <div className={`toast toast-${tone}`} role="status">
      <span>{message}</span>
      <button onClick={() => onDone && onDone()} aria-label="Dismiss">×</button>
    </div>
  );
}