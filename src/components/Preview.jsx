import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { injectRuntime, editableRuntime } from '../lib/runtime.js';

// Editable chrome is injected into the iframe only in the app. An export gets
// RUNTIME_SCRIPT, which is the same script with editing compiled out.

const Preview = forwardRef(function Preview(
  {
    html,
    index,
    editable = true,
    theme = 'dark',
    accent = 'indigo',
    reloadKey = 0,
    onState,
    onCellOutput,
    onKernelExec,
    onGeometry,
    onSource,
    onMeta,
    onDelete,
    onInterrupt,
    onOutputToAgent,
    onRuntimeInfo,
    zoom = 1,
    fit = true,
    readOnly = false,
  },
  ref,
) {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [errorCount, setErrorCount] = useState(0);
  const [debouncedHtml, setDebouncedHtml] = useState(html);

  /**
   * Reload only on a structural change: a new deck, a slide added, a cell
   * deleted by the parent, an assistant edit. A drag or a keystroke inside the
   * iframe is already on screen — reloading for it would re-run every cell and
   * drop the selection mid-gesture.
   */
  const seenKey = useRef(-1);
  useEffect(() => {
    if (reloadKey === seenKey.current) return undefined;
    const first = seenKey.current === -1;
    seenKey.current = reloadKey;
    if (first) {
      setDebouncedHtml(html);
      return undefined;
    }
    const t = setTimeout(() => setDebouncedHtml(html), 220);
    return () => clearTimeout(t);
  }, [html, reloadKey]);

  const doc = useMemo(() => {
    const doc0 = injectRuntime(
      debouncedHtml,
      editable ? editableRuntime({ theme, accent }) : undefined,
    );
    const fitCss = fit
      ? '<style id="__nb_host_fit">.slide{min-height:100vh !important;height:100vh !important}</style>'
      : '';
    return fitCss ? doc0.replace(/<\/head>/i, `${fitCss}</head>`) : doc0;
  }, [debouncedHtml, editable, fit]);

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
      setEditing(on) {
        post({ type: 'nb:edit', on: !!on });
      },
      patch(cells) {
        post({ type: 'nb:patch', cells });
      },
      deliverOutput(id, record) {
        post({ type: 'nb:kout', id, record });
      },
      focusCell(id) {
        post({ type: 'nb:focus-cell', id });
      },
    }),
    [post, index],
  );

  useEffect(() => {
    const onMessage = (e) => {
      const d = e.data;
      if (!d || typeof d.type !== 'string') return;
      switch (d.type) {
        case 'nb:runtime':
          onRuntimeInfo?.(d);
          break;
        case 'nb:state':
          setReady(true);
          onState?.(d);
          break;
        case 'nb:cell-output':
          onCellOutput?.(d.id, d.entries || []);
          break;
        case 'nb:kexec':
          onKernelExec?.(d);
          break;
        case 'nb:cell-geometry':
          onGeometry?.(d.id, d.box);
          break;
        case 'nb:cell-source':
          onSource?.(d.id, d.source);
          break;
        case 'nb:cell-meta':
          onMeta?.(d.id, { lang: d.lang });
          break;
        case 'nb:interrupt':
          onInterrupt?.(d);
          break;
        case 'nb:cell-output-to-agent':
          onOutputToAgent?.(d);
          break;
        case 'nb:cell-delete':
          onDelete?.(d.id);
          break;
        default:
          break;
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onState, onCellOutput, onKernelExec, onGeometry, onSource, onMeta, onDelete, onInterrupt, onOutputToAgent, onRuntimeInfo]);

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
          style={readOnly ? { pointerEvents: 'none' } : undefined}
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