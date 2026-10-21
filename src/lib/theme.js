export const THEME_PRESETS = {
  midnight: {
    label: 'Midnight',
    background: '#0b0f19',
    surface: '#131a2b',
    foreground: '#e8edf7',
    muted: '#93a1bd',
    accent: '#7c9cff',
    border: '#26304a',
    font: 'Inter',
    radius: 16,
    headingWeight: 800,
    scale: 1,
    align: 'center',
  },
  paper: {
    label: 'Paper',
    background: '#fbfaf7',
    surface: '#ffffff',
    foreground: '#1b1a17',
    muted: '#6b675e',
    accent: '#c2603a',
    border: '#e6e2d9',
    font: 'Inter',
    radius: 10,
    headingWeight: 700,
    scale: 1,
    align: 'left',
  },
  terminal: {
    label: 'Terminal',
    background: '#0a0e0a',
    surface: '#111812',
    foreground: '#d8f3d8',
    muted: '#6f9c6f',
    accent: '#4ade80',
    border: '#1f2c20',
    font: 'IBM Plex Mono',
    radius: 4,
    headingWeight: 700,
    scale: 0.95,
    align: 'left',
  },
  sunset: {
    label: 'Sunset',
    background: '#1a0f1f',
    surface: '#241528',
    foreground: '#f7e9f0',
    muted: '#b192a8',
    accent: '#ff8a5c',
    border: '#3a2340',
    font: 'Inter',
    radius: 22,
    headingWeight: 800,
    scale: 1.05,
    align: 'center',
  },
};

export const DEFAULT_THEME = { preset: 'midnight' };

export function resolveTheme(settings) {
  const preset = THEME_PRESETS[settings?.preset] || THEME_PRESETS.midnight;
  const merged = { ...THEME_PRESETS.midnight, ...preset, ...(settings || {}) };
  delete merged.label;
  return merged;
}

function withAlpha(hex, alpha) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const FONT_STACKS = {
  Inter: "'Inter', system-ui, -apple-system, sans-serif",
  'IBM Plex Mono': "'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
  Georgia: "Georgia, 'Times New Roman', serif",
  'JetBrains Mono': "'JetBrains Mono', ui-monospace, monospace",
};

export const FONT_OPTIONS = [
  { value: 'Inter', label: 'Inter (sans)' },
  { value: 'IBM Plex Mono', label: 'IBM Plex Mono' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Georgia', label: 'Georgia (serif)' },
];

export function buildThemeCss(settings) {
  const t = resolveTheme(settings);
  const stack = FONT_STACKS[t.font] || FONT_STACKS.Inter;
  const just = t.align === 'left' ? 'flex-start' : 'center';
  const textAlign = t.align === 'left' ? 'left' : 'center';

  const fonts = [
    'Inter:wght@400;500;600;800',
    'IBM+Plex+Mono:wght@400;600',
    'JetBrains+Mono:wght@400;700',
  ]
    .map((f) => `family=${f}`)
    .join('&');

  return `@import url('https://fonts.googleapis.com/css2?${fonts}&display=swap');

:root {
  --nb-bg: ${t.background};
  --nb-surface: ${t.surface};
  --nb-fg: ${t.foreground};
  --nb-muted: ${t.muted};
  --nb-accent: ${t.accent};
  --nb-accent-soft: ${withAlpha(t.accent, 0.15)};
  --nb-border: ${t.border};
  --nb-radius: ${t.radius}px;
  --nb-font: ${stack};
  --nb-scale: ${t.scale};
  --nb-heading-weight: ${t.headingWeight};
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--nb-bg);
  color: var(--nb-fg);
  font-family: var(--nb-font);
  font-size: calc(16px * var(--nb-scale));
}

.slide {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: ${just};
  text-align: ${textAlign};
  padding: 4rem 5rem;
  gap: 1.25rem;
  background: var(--nb-bg);
}

.slide > * { max-width: 52rem; }

h1 {
  font-size: calc(3.25rem * var(--nb-scale));
  font-weight: var(--nb-heading-weight);
  line-height: 1.08;
  letter-spacing: -0.02em;
  margin: 0;
  color: var(--nb-fg);
}

h2 {
  font-size: calc(2.25rem * var(--nb-scale));
  font-weight: var(--nb-heading-weight);
  line-height: 1.15;
  letter-spacing: -0.01em;
  margin: 0;
  color: var(--nb-fg);
}

h3 { font-size: calc(1.35rem * var(--nb-scale)); font-weight: 600; margin: 0; }

p, li {
  font-size: calc(1.15rem * var(--nb-scale));
  line-height: 1.65;
  color: var(--nb-muted);
  margin: 0;
}

ul, ol { text-align: left; padding-left: 1.5rem; }

.accent { color: var(--nb-accent); }
.muted { color: var(--nb-muted); }

.badge {
  display: inline-block;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--nb-accent);
}

.card {
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: var(--nb-radius);
  padding: 1.5rem;
  text-align: left;
}

.grid {
  display: grid;
  gap: 1.25rem;
  width: 100%;
}

.grid.cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.grid.cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }

.stat {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.stat .value {
  font-size: calc(2.5rem * var(--nb-scale));
  font-weight: var(--nb-heading-weight);
  color: var(--nb-accent);
  line-height: 1;
}

.stat .label {
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--nb-muted);
}

blockquote {
  margin: 0;
  padding-left: 1.25rem;
  border-left: 3px solid var(--nb-accent);
  font-size: calc(1.35rem * var(--nb-scale));
  line-height: 1.5;
  color: var(--nb-fg);
  text-align: left;
}

code, pre {
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: calc(0.95rem * var(--nb-scale));
}

pre {
  background: var(--nb-surface);
  border: 1px solid var(--nb-border);
  border-radius: var(--nb-radius);
  padding: 1.25rem;
  overflow-x: auto;
  text-align: left;
  width: 100%;
}

code:not(pre code) {
  background: var(--nb-accent-soft);
  color: var(--nb-accent);
  padding: 0.15rem 0.4rem;
  border-radius: 6px;
}

img { max-width: 100%; border-radius: var(--nb-radius); }
`;
}

const THEME_RE = /<style\s+id\s*=\s*["']deck-style["'][^>]*>[\s\S]*?<\/style>/i;

export function applyTheme(html, settings) {
  const block = `<style id="deck-style">\n${buildThemeCss(settings)}\n</style>`;
  if (THEME_RE.test(html)) return html.replace(THEME_RE, block);

  const headClose = html.search(/<\/head>/i);
  if (headClose !== -1) return `${html.slice(0, headClose)}${block}\n${html.slice(headClose)}`;

  return `${block}\n${html}`;
}

export function stripTheme(html) {
  return html.replace(THEME_RE, '');
}