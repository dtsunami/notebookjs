import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { injectRuntime } from '../lib/runtime.js';

const Preview = forwardRef(function Preview(
  { html, index, onState, onCells, onCellOutput, zoom = 1, fit = true },
  ref,
) {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [debouncedHtml, setDebouncedHtml] = useState(html);

  // Reloading the iframe on every keystroke would re-run every cell and
  // restart every animation mid-typing. Let the document settle first.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedHtml(html), 300);
    return () => clearTimeout(t);
  }, [html]);

  const doc = useMemo(() => {
    const doc0 = injectRuntime(debouncedHtml);
    const fitCss = fit
      ? '<style id="__nb_host_fit">.slide{min-height:100vh !important;height:100vh !important}</style>'
      : '';
    return fitCss ? doc0.replace(/<\/head>/i, `${fitCss}</head>`) : doc0;
  }, [debouncedHtml, fit]);

  const post = useCallback((msg) => {
    frameRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      runCell(id) {
        post({ type: 'nb:run-cell', id });
      },
      runAll() {
        post({ type: 'nb:run-all' });
      },
      refresh() {
        post({ type: 'nb:sync', index });
      },
    }),
    [post, index],
  );

  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data;
      if (!d || typeof d.type !== 'string') return;
      if (d.type === 'nb:state') {
        setReady(true);
        onState?.(d);
      } else if (d.type === 'nb:cells') {
        onCells?.(d.cells || []);
      } else if (d.type === 'nb:cell-output') {
        onCellOutput?.(d.id, d.entries || []);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onState, onCells, onCellOutput]);

  useEffect(() => {
    if (!ready) return;
    post({ type: 'nb:goto', index });
  }, [index, ready, post]);

  useEffect(() => {
    post({ type: 'nb:sync', index });
  }, [doc, post, index]);

  return (
    <div className="preview-shell">
      <div className="preview-viewport" style={{ zoom }}>
        <iframe
          ref={frameRef}
          title="Deck preview"
          srcDoc={doc}
          sandbox="allow-scripts allow-same-origin allow-modals allow-forms allow-popups"
          onLoad={() => {
            setReady(false);
            post({ type: 'nb:sync', index });
          }}
          onError={() => setErrorCount((n) => n + 1)}
        />
      </div>
      {errorCount > 0 && (
        <div className="preview-flag">Preview reported {errorCount} load error(s).</div>
      )}
    </div>
  );
});

export default Preview;