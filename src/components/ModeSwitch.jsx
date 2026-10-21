import React from 'react';

const MODES = [
  { id: 'notebook', label: 'Notebook', hint: 'Cells stacked vertically' },
  { id: 'split', label: 'Split', hint: 'Notebook beside the slide' },
  { id: 'deck', label: 'Deck', hint: 'Slide only' },
];

export default function ModeSwitch({ mode, onChange }) {
  return (
    <div className="seg mode-switch" role="tablist" aria-label="Layout mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="tab"
          aria-selected={mode === m.id}
          className={mode === m.id ? 'seg-item active' : 'seg-item'}
          title={m.hint}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}