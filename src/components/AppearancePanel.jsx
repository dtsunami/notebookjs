import React from 'react';
import { ACCENTS, DENSITIES } from '../lib/ui-prefs.js';

const ACCENT_HEX = {
  indigo: '#6d8dff',
  emerald: '#34d399',
  amber: '#f59e0b',
  rose: '#fb7185',
  cyan: '#22d3ee',
  violet: '#a78bfa',
};

export default function AppearancePanel({ ui, onChange }) {
  const patch = (p) => onChange({ ...ui, ...p });

  return (
    <div className="panel-body">
      <section className="panel-section">
        <h4>Interface theme</h4>
        <div className="seg">
          {['dark', 'light'].map((t) => (
            <button
              key={t}
              type="button"
              className={ui.theme === t ? 'seg-item active' : 'seg-item'}
              onClick={() => patch({ theme: t })}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Accent</h4>
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              className={ui.accent === a ? 'swatch active' : 'swatch'}
              style={{ background: ACCENT_HEX[a] }}
              title={a}
              aria-label={a}
              onClick={() => patch({ accent: a })}
            />
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Density</h4>
        <div className="seg">
          {DENSITIES.map((d) => (
            <button
              key={d}
              type="button"
              className={ui.density === d ? 'seg-item active' : 'seg-item'}
              onClick={() => patch({ density: d })}
            >
              {d}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <h4>Code</h4>
        <label className="field-row">
          <span>Mono size</span>
          <input
            type="range"
            min="10"
            max="18"
            step="0.5"
            value={ui.monoSize}
            onChange={(e) => patch({ monoSize: Number(e.target.value) })}
          />
          <code>{ui.monoSize}px</code>
        </label>
        <label className="field-row">
          <span>Line numbers</span>
          <input
            type="checkbox"
            checked={ui.showLineNumbers}
            onChange={(e) => patch({ showLineNumbers: e.target.checked })}
          />
        </label>
      </section>
    </div>
  );
}