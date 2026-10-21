import React, { useEffect, useMemo, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';

export default function Editor({ value, onChange, showSlideIds = true }) {
  const viewRef = useRef(null);

  const extensions = useMemo(() => {
    const base = [html(), javascript({ jsx: false }), EditorView.lineWrapping];
    if (!showSlideIds) {
      const hide = EditorView.theme({
        '.cm-content': { fontFamily: "'IBM Plex Mono', monospace" },
      });
      base.push(hide);
    }
    return base;
  }, [showSlideIds]);

  useEffect(() => {
    const view = viewRef.current?.view;
    if (!view) return;
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        document.dispatchEvent(new CustomEvent('nb:save-request'));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={extensions}
      theme={oneDark}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = { view };
      }}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: true,
        autocompletion: true,
        bracketMatching: true,
        closeBrackets: true,
      }}
    />
  );
}