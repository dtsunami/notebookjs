import React, { useEffect } from 'react';
import AppearancePanel from './AppearancePanel.jsx';
import StylePanel from './StylePanel.jsx';
import PromptPanel from './PromptPanel.jsx';

const TABS = [
  { id: 'look', label: 'Appearance' },
  { id: 'deck', label: 'Deck theme' },
  { id: 'prompt', label: 'System prompt' },
  { id: 'kernel', label: 'Kernel' },
  { id: 'export', label: 'Export' },
];

export default function SettingsDrawer({
  open,
  tab,
  onTab,
  onClose,
  ui,
  onUiChange,
  theme,
  onThemeChange,
  promptOverride,
  builtinPrompt,
  onPromptChange,
  kernel,
  onRestartKernel,
  languages,
  languagesError,
  onRefreshLanguages,
  onOpenInstallDeck,
  playwright,
  serverRoot,
  onExportHtml,
  onExportJson,
  onExportPng,
  onPrint,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Re-probe whenever the Kernel tab is opened: an interpreter installed in a
  // shell cell a minute ago should show as available without a reload.
  useEffect(() => {
    if (open && tab === 'kernel') onRefreshLanguages?.();
  }, [open, tab, onRefreshLanguages]);

  if (!open) return null;

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <header className="drawer-head">
          <h3>Settings</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </header>

        <nav className="drawer-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'drawer-tab active' : 'drawer-tab'}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="drawer-body">
          {tab === 'look' && <AppearancePanel ui={ui} onChange={onUiChange} />}

          {tab === 'deck' && (
            <StylePanel
              theme={theme}
              onChange={onThemeChange}
              onReset={() => onThemeChange({ preset: theme.preset || 'midnight' })}
            />
          )}

          {tab === 'prompt' && (
            <PromptPanel
              value={promptOverride}
              defaultPrompt={builtinPrompt}
              onChange={onPromptChange}
              onReset={() => onPromptChange('')}
            />
          )}

          {tab === 'kernel' && (
            <div className="panel-body">
              <section className="panel-section">
                <h4>Kernel</h4>
                <div className="kernel-bar">
                  <span className={kernel ? 'kernel-dot on' : 'kernel-dot'} />
                  <span className="kernel-label">
                    {kernel
                      ? `active · ${kernel.lang} · ${kernel.seq} run${kernel.seq === 1 ? '' : 's'}`
                      : 'idle · starts on first run'}
                  </span>
                </div>
                <div className="panel-actions tight">
                  <button type="button" className="ghost" onClick={onRestartKernel}>
                    Restart &amp; clear state
                  </button>
                </div>
                <p className="panel-hint">
                  Cells run on the server and keep state between runs. Only you can execute a cell;
                  the assistant has no execution tool.
                </p>
              </section>

              <section className="panel-section">
                <h4>Backends</h4>
                {languagesError && <p className="panel-hint danger">{languagesError}</p>}
                {!languages && !languagesError && (
                  <p className="panel-hint">Checking which interpreters resolve…</p>
                )}
                {languages && (
                  <ul className="lang-list">
                    {languages.languages.map((l) => (
                      <li key={l.id} className={l.ok ? 'lang-row ok' : 'lang-row miss'}>
                        <span className="lang-dot" aria-hidden="true" />
                        <span className="lang-name">{l.label}</span>
                        <code className="lang-cmd" title={l.cmd || l.error || ''}>
                          {l.ok ? l.cmd : l.error || 'not found'}
                        </code>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="panel-hint">
                  JavaScript and TypeScript run on the app&rsquo;s own Node. Python, Ruby and the
                  shells are separate interpreters; installed backends live in{' '}
                  <code>{languages?.binDir || '~/.labjs/bin'}</code> and are found without a
                  restart.
                </p>
                <div className="panel-actions tight wrap">
                  <button type="button" className="ghost" onClick={onRefreshLanguages}>
                    Re-check
                  </button>
                  <button type="button" className="primary" onClick={onOpenInstallDeck}>
                    Open install deck
                  </button>
                </div>
                <p className="panel-hint">
                  The install deck has runnable shell cells for macOS, Linux and Windows.
                  Nothing in it runs until you press Run.
                </p>
              </section>

              <section className="panel-section">
                <h4>Environment</h4>
                <dl className="kv">
                  <dt>Server root</dt>
                  <dd title={serverRoot}>{serverRoot || '—'}</dd>
                  <dt>Screenshots</dt>
                  <dd>{playwright === false ? 'Playwright not installed' : 'available'}</dd>
                </dl>
                <p className="panel-hint">
                  Set <code>NB_PYTHON</code> or <code>NB_RUBY</code> to override the interpreter a
                  kernel uses.
                </p>
              </section>
            </div>
          )}
          {tab === 'export' && (
            <div className="panel-body">
              <section className="panel-section">
                <h4>Export</h4>
                <div className="panel-actions tight wrap">
                  <button type="button" onClick={onExportHtml}>
                    Standalone .html
                  </button>
                  <button type="button" onClick={onExportJson}>
                    .json project
                  </button>
                  <button type="button" onClick={onExportPng}>
                    Slide .png
                  </button>
                  <button type="button" className="ghost" onClick={onPrint}>
                    Print / PDF
                  </button>
                </div>
                <p className="panel-hint">
                  The standalone export inlines the slide runtime, so arrow keys and page fit work
                  in any browser with no server.
                </p>
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}