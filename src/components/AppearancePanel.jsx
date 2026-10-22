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
        <h4>Cell output</h4>
        <label className="field-row">
          <span>Auto-collapse</span>
          <input
            type="range"
            min="1.5"
            max="30"
            step="0.5"
            value={(ui.outputTimeout || 4500) / 1000}
            onChange={(e) => patch({ outputTimeout: Math.round(Number(e.target.value) * 1000) })}
          />
          <code>{((ui.outputTimeout || 4500) / 1000).toFixed(1)}s</code>
        </label>
        <p className="panel-hint">
          After a cell runs, the output dock flashes and stays open for this long, then folds back
          to its bar. Pin it from the dock to keep it open.
        </p>
        <label className="field-row">
          <span>Spinner</span>
          <input
            type="range"
            min="0.25"
            max="2"
            step="0.05"
            value={ui.spinnerSpeed ?? 0.7}
            onChange={(e) => patch({ spinnerSpeed: Number(e.target.value) })}
          />
          <code>{(ui.spinnerSpeed ?? 0.7).toFixed(2)}s</code>
        </label>
      </section>

      <section className="panel-section">
        <h4>Cells</h4>
        <label className="field-row">
          <span>Edit cells in the slide</span>
          <input
            type="checkbox"
            checked={ui.editCells !== false}
            onChange={(e) => patch({ editCells: e.target.checked })}
          />
        </label>
        <p className="panel-hint">
          Off turns the slide into a clean preview: cells still run, but their source is
          read-only and boxes stop moving.
        </p>
      </section>

      <section className="panel-section">
        <h4>Slides</h4>
        <label className="field-row">
          <span>Show the slide timeline</span>
          <input
            type="checkbox"
            checked={ui.timeline !== false}
            onChange={(e) => patch({ timeline: e.target.checked })}
          />
        </label>
        <p className="panel-hint">
          A filmstrip under the stage. Click a slide to jump to it, drag one to reorder.
          Thumbnails are read-only pictures and never run a cell.
        </p>
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