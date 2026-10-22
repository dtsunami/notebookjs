import React, { useEffect, useRef, useState } from 'react';

const W = 1280;

/**
 * A slide rendered read-only, scaled to fit whatever column it lands in.
 * No runtime and no scripts: this is a picture of the slide, not a second
 * execution surface.
 */
export default function SlideThumb({ doc, label }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setScale(el.clientWidth / W);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!doc) {
    return <div className="thumb-missing">This slide has no id, so it cannot be previewed.</div>;
  }

  return (
    <div className="thumb" ref={boxRef} aria-label={label || 'Slide preview'}>
      <iframe
        title={label || 'Slide preview'}
        srcDoc={doc}
        sandbox="allow-same-origin"
        style={{ width: `${W}px`, height: '720px', transform: `scale(${scale})` }}
      />
    </div>
  );
}