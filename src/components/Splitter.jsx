import React, { useCallback, useRef } from 'react';

export default function Splitter({ onResize, onEnd, hidden = false }) {
  const dragging = useRef(false);

  const down = useCallback((e) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    document.body.classList.add('resizing');
  }, []);

  const move = useCallback(
    (e) => {
      if (!dragging.current) return;
      onResize?.(e.clientX);
    },
    [onResize],
  );

  const up = useCallback(
    (e) => {
      if (!dragging.current) return;
      dragging.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      document.body.classList.remove('resizing');
      onEnd?.();
    },
    [onEnd],
  );

  return (
    <div
      className={hidden ? 'splitter hidden' : 'splitter'}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize code pane"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}