import React, { useState } from 'react';
import { submitToken } from '../lib/auth.js';

export default function TokenGate({ onSignedIn }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    const token = value.trim();
    if (!token || busy) return;
    setBusy(true);
    setError('');
    const ok = await submitToken(token).catch(() => false);
    setBusy(false);
    if (ok) {
      onSignedIn?.();
    } else {
      setError('That token was not accepted.');
    }
  };

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>notebookjs</h1>
        <p className="gate-hint">
          This server requires a token. It is printed in the terminal on startup, and stored in{' '}
          <code>data/token</code>.
        </p>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Paste token"
          autoFocus
          spellCheck={false}
        />
        {error && <p className="gate-error">{error}</p>}
        <button type="submit" className="primary" disabled={busy || !value.trim()}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}