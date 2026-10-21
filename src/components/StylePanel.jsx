import React from 'react';
import { THEME_PRESETS, FONT_OPTIONS, resolveTheme } from '../lib/theme.js';

const COLOR_FIELDS = [
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'foreground', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'border', label: 'Border' },
];

export default function StylePanel({ theme, onChange, onReset }) {
  const t = resolveTheme(theme);
  const patch = (p) => onChange({ ...theme, ...p });

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h4>Preset</h4>
        <div className="preset-grid">
          {Object.entries(THEME_PRESETS).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className={t.preset === key ? 'preset active' : 'preset'}
              onClick={() => onChange({ ...theme, preset: key })}
              title={preset.label}
            >
              <span
                className="preset-swatch"
                style={{
                  background: preset.background,
                  borderColor: preset.border,
                  color: preset.accent,
                }}
              />
              <span className="preset-label">{preset.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Colors</h4>
        {COLOR_FIELDS.map((f) => (
          <label key={f.key} className="field-row">
            <span>{f.label}</span>
            <span className="field-control">
              <input
                type="color"
                value={normalizeHex(t[f.key])}
                onChange={(e) => patch({ [f.key]: e.target.value })}
              />
              <input
                type="text"
                className="hex"
                value={t[f.key]}
                onChange={(e) => patch({ [f.key]: e.target.value })}
                spellCheck={false}
              />
            </span>
          </label>
        ))}
      </section>

      <section className="panel-section">
        <h4>Typography</h4>
        <label className="field-row">
          <span>Font</span>
          <select value={t.font} onChange={(e) => patch({ font: e.target.value })}>
            {FONT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-row">
          <span>Heading weight</span>
          <input
            type="range"
            min="400"
            max="900"
            step="100"
            value={t.headingWeight}
            onChange={(e) => patch({ headingWeight: Number(e.target.value) })}
          />
          <code>{t.headingWeight}</code>
        </label>
      </section>

      <section className="panel-section">
        <h4>Layout</h4>
        <label className="field-row">
          <span>Align</span>
          <select value={t.align} onChange={(e) => patch({ align: e.target.value })}>
            <option value="center">Centered</option>
            <option value="left">Left</option>
          </select>
        </label>
        <label className="field-row">
          <span>Corner radius</span>
          <input
            type="range"
            min="0"
            max="32"
            value={t.radius}
            onChange={(e) => patch({ radius: Number(e.target.value) })}
          />
          <code>{t.radius}px</code>
        </label>
        <label className="field-row">
          <span>Type scale</span>
          <input
            type="range"
            min="0.8"
            max="1.3"
            step="0.05"
            value={t.scale}
            onChange={(e) => patch({ scale: Number(e.target.value) })}
          />
          <code>{t.scale.toFixed(2)}×</code>
        </label>
      </section>

      <div className="panel-actions">
        <button type="button" className="ghost" onClick={onReset}>
          Reset to preset
        </button>
      </div>
    </div>
  );
}

function normalizeHex(value) {
  const v = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  return '#000000';
}