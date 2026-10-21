const KEY = 'notebookjs:ui';

export const ACCENTS = ['indigo', 'emerald', 'amber', 'rose', 'cyan', 'violet'];
export const DENSITIES = ['compact', 'cozy', 'roomy'];
export const MODES = ['notebook', 'deck', 'split'];

export const DEFAULT_UI = {
  theme: 'dark',
  accent: 'indigo',
  density: 'cozy',
  mode: 'split',
  monoSize: 12.5,
  showLineNumbers: true,
  sidebar: true,
};

export function loadUi() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_UI, ...JSON.parse(raw) } : { ...DEFAULT_UI };
  } catch {
    return { ...DEFAULT_UI };
  }
}

export function saveUi(ui) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ui));
  } catch {
    /* quota — preferences are not worth failing over */
  }
}

/** Applies UI prefs as data-attributes so CSS can switch on them. */
export function applyUi(ui) {
  const el = document.documentElement;
  el.dataset.uiTheme = ui.theme;
  el.dataset.accent = ui.accent;
  el.dataset.density = ui.density;
  el.style.setProperty('--mono-size', `${ui.monoSize}px`);
}