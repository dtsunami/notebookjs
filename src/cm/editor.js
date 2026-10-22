/**
 * CodeMirror, bundled for the deck iframe.
 *
 * This is a separate entry from the app on purpose. The runtime lives inside a
 * sandboxed iframe; CodeMirror builds its DOM with the `document` of whichever
 * realm imported it, so importing it in the app and handing an element to the
 * iframe produces nodes that cannot be inserted there. Loading this bundle
 * *inside* the iframe means every node belongs to the right document.
 *
 * The runtime guards on `window.NBEditor`, so an export — or a browser that
 * blocked the script — falls back to the plain textarea.
 */
import {
  EditorView,
  keymap,
  lineNumbers,
  drawSelection,
  highlightActiveLine,
  gutter,
  GutterMarker,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { HighlightStyle } from '@codemirror/language';
import { Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  StreamLanguage,
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language';
import { python } from '@codemirror/legacy-modes/mode/python';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

/** The grammar for a notebook language, or plain text for anything else. */
function languageFor(lang) {
  switch (String(lang || '').toLowerCase()) {
    case 'javascript':
    case 'js':
      return javascript();
    case 'typescript':
    case 'ts':
      return javascript({ typescript: true });
    case 'python':
      return StreamLanguage.define(python);
    case 'ruby':
      return StreamLanguage.define(ruby);
    case 'bash':
    case 'sh':
    case 'pwsh':
    case 'powershell':
      return StreamLanguage.define(shell);
    default:
      return [];
  }
}

/**
 * A bash prompt, on every line.
 *
 * Cells run their source as a batch, not as an interactive console — so the
 * prompt is a *label*, not a shell: it marks which rows are commands and shows
 * what the batch would look like typed. It is a gutter, so it can never be
 * selected, copied into the command, or edited away.
 */
class PromptMark extends GutterMarker {
  toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-prompt-mark';
    el.textContent = '$';
    // Decorative: the prompt is not part of the document, so a screen reader
    // reading it would be reading punctuation that is not there.
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
}

const promptMark = new PromptMark();

const promptGutter = gutter({
  class: 'cm-nb-prompt',
  lineMarker: () => promptMark,
  initialSpacer: () => promptMark,
  renderEmptyElements: true,
});

/** Languages shown with a shell prompt instead of line numbers. */
function isShell(lang) {
  return /^(bash|sh|zsh|pwsh|powershell)$/i.test(String(lang || ''));
}

/**
 * GitHub's dark token colours, tuned to this cell's palette.
 *
 * Not `oneDark`: its hues are close together at 12px, and a shell cell is read
 * in a glance rather than studied. GitHub's set separates comments, strings and
 * variables by both hue and lightness, which survives a quick look.
 */
const githubDark = HighlightStyle.define([
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: '#8b949e', fontStyle: 'italic' },
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword], color: '#ff7b72' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: '#a5d6ff' },
  { tag: [tags.number, tags.bool, tags.null], color: '#79c0ff' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: '#ffa657' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#d2a8ff' },
  { tag: [tags.operator, tags.punctuation, tags.separator], color: '#c9d1d9' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: '#7ee787' },
  { tag: [tags.meta, tags.processingInstruction], color: '#8b949e' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '600' },
]);

/** Cell chrome is dark whatever the deck theme is; a light editor would glare. */
const dark = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#e7edf9' },
    // Code is code: flush left, never centred by a deck's slide styles.
    '.cm-content': {
      caretColor: '#6d8dff',
      fontFamily: 'inherit',
      textAlign: 'left',
      justifyContent: 'flex-start',
    },
    '.cm-line': { textAlign: 'left', padding: '0 4px 0 2px' },
    '.cm-nb-prompt': { color: '#4ade80', padding: '0 6px 0 4px', opacity: 0.85 },
    '.cm-prompt-mark': { userSelect: 'none' },
    '.cm-cursor': { borderLeftColor: '#6d8dff' },
    '&.cm-focused': { outline: 'none' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(109,141,255,.25)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(109,141,255,.35)' },
    '.cm-activeLine': { backgroundColor: 'rgba(109,141,255,.06)' },
  },
  { dark: true },
);

/**
 * Create an editor in `parent`.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.parent
 * @param {string} opts.doc
 * @param {string} opts.lang
 * @param {(value: string) => void} opts.onDoc   every change, for persistence
 * @param {() => void} opts.onRun                Cmd/Ctrl+Enter
 * @param {boolean} [opts.lineNumbers]
 * @returns {EditorView}
 */
export function create({ parent, doc, lang, onDoc, onRun, lineNumbers: nums = true }) {
  // The grammar lives in a compartment so a language change reconfigures it
  // without rebuilding the view — undo history and cursor survive, which is
  // what makes "switch language, then convert" feel like one edit.
  const languageSlot = new Compartment();
  // So does the gutter: a shell shows prompts, everything else shows numbers.
  const gutterSlot = new Compartment();
  const gutterFor = (l) => (nums && isShell(l) ? promptGutter : nums ? lineNumbers() : []);
  const view = new EditorView({
    parent,
    doc: doc || '',
    extensions: [
      gutterSlot.of(gutterFor(lang)),
      history(),
      drawSelection(),
      highlightActiveLine(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(githubDark),
      // Fallback for tokens the GitHub set does not name, so nothing is
      // rendered in an unreadable default.
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      languageSlot.of(languageFor(lang)),
      oneDark,
      dark,
      keymap.of([
        {
          key: 'Mod-Enter',
          preventDefault: true,
          run: () => {
            onRun?.();
            return true;
          },
        },
        ...historyKeymap,
        indentWithTab,
        ...defaultKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) onDoc?.(u.state.doc.toString());
      }),
    ],
  });

  // Stash the compartment on the view so setLanguage can reach it without a
  // module-level map keyed by element.
  view.nbLanguageSlot = languageSlot;
  view.nbGutterSlot = gutterSlot;
  view.nbGutterFor = gutterFor;
  return view;
}

/** Swap the grammar when a cell changes language, keeping the document. */
export function setLanguage(view, lang) {
  if (!view || !view.nbLanguageSlot) return;
  view.dispatch({
    effects: [
      view.nbLanguageSlot.reconfigure(languageFor(lang)),
      view.nbGutterSlot?.reconfigure(view.nbGutterFor(lang)),
    ].filter(Boolean),
  });
}

/** Replace the whole document without touching undo history semantics. */
export function setDoc(view, text) {
  if (!view) return;
  const current = view.state.doc.toString();
  if (current === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

export function getDoc(view) {
  return view ? view.state.doc.toString() : '';
}

// The runtime looks for this after injecting the script.
window.NBEditor = { create, setDoc, getDoc, setLanguage };