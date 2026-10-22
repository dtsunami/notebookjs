const KEY = 'notebookjs:ui';

export const ACCENTS = ['indigo', 'emerald', 'amber', 'rose', 'cyan', 'violet'];
export const DENSITIES = ['compact', 'cozy', 'roomy'];

export const DEFAULT_UI = {
  theme: 'dark',
  accent: 'indigo',
  density: 'cozy',
  monoSize: 12.5,
  showLineNumbers: true,
  sidebar: true,
  // ms a run stays expanded before the output dock folds back to its bar
  outputTimeout: 4500,
  // seconds for one full turn of the running-cell spinner
  spinnerSpeed: 0.7,
  // cells are draggable, resizable, and editable inside the slide
  editCells: true,
  // horizontal filmstrip of slide thumbnails under the stage
  timeline: true,
};

export function loadUi() {
  try {
    const raw = window.localStorage.getItem(KEY);
    const ui = raw ? { ...DEFAULT_UI, ...JSON.parse(raw) } : { ...DEFAULT_UI };
    // `mode` was removed with the slide/cells split. Drop it so a stored pref
    // from an older build does not linger in the object or on disk.
    delete ui.mode;
    if (!Number.isFinite(ui.outputTimeout)) ui.outputTimeout = DEFAULT_UI.outputTimeout;
    if (!Number.isFinite(ui.spinnerSpeed)) ui.spinnerSpeed = DEFAULT_UI.spinnerSpeed;
    return ui;
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