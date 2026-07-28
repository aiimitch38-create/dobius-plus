import { useState, useEffect } from 'react';

// Google Workspace (gws) accounts (v1.0.41). Connect multiple Google accounts
// so the gws CLI (and later in-app views / voice) can act as a chosen account
// by email. Connect snapshots the account currently logged into gws.
export default function GwsAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  const reload = async () => {
    try {
      const list = await window.electronAPI?.gwsList?.();
      setAccounts(Array.isArray(list) ? list : []);
    } catch {
      setAccounts([]);
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => { reload(); }, []);

  const flash = (msg, isError = false) => {
    setFeedback({ msg, isError });
    setTimeout(() => setFeedback(''), 5000);
  };

  const handleConnect = async () => {
    setBusy(true);
    try {
      const res = await window.electronAPI?.gwsConnect?.();
      if (res?.ok) {
        flash(`Connected ${res.account?.email || 'account'}.`);
        await reload();
      } else {
        flash(res?.error || 'Could not connect.', true);
      }
    } catch {
      flash('Could not connect.', true);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id) => {
    try {
      await window.electronAPI?.gwsRemove?.(id);
      await reload();
      flash('Account removed.');
    } catch {
      flash('Could not remove.', true);
    }
  };

  const btn = (variant = 'default', extra = {}) => ({
    padding: '5px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: busy ? 'wait' : 'pointer',
    backgroundColor: variant === 'primary' ? 'var(--accent)' : 'var(--surface)',
    color: variant === 'primary' ? '#fff' : 'var(--fg)',
    border: variant === 'primary' ? '1px solid var(--accent)' : '1px solid var(--border)',
    ...extra,
  });

  return (
    <div className="mt-6">
      <div
        className="text-xs font-medium uppercase tracking-wider mb-3 pb-1"
        style={{ color: 'var(--dim)', borderBottom: '1px solid var(--border)', letterSpacing: '0.08em' }}
      >
        Google Workspace accounts
      </div>

      {loaded && accounts.length === 0 && (
        <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
          No Google accounts connected. Log into an account with <code style={{ fontFamily: 'monospace' }}>gws auth login</code> in a terminal, then click Connect. Repeat (logout, log into the next account, Connect) to add more.
        </p>
      )}

      <div className="space-y-2 mb-3">
        {accounts.map((a) => (
          <div
            key={a.id}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{a.email}</div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
                {(a.scopes?.length || 0)} scope{(a.scopes?.length || 0) === 1 ? '' : 's'} granted
              </div>
            </div>
            <button
              style={btn('default', { color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' })}
              onClick={() => handleRemove(a.id)}
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      <button style={btn('primary', { opacity: busy ? 0.6 : 1 })} disabled={busy} onClick={handleConnect}>
        {busy ? 'Connecting…' : '+ Connect Google Account'}
      </button>

      {feedback && (
        <p className="text-xs mt-2" style={{ color: feedback.isError ? '#f87171' : 'var(--dim)' }}>
          {feedback.msg}
        </p>
      )}

      <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
        Connect snapshots the account currently logged into gws. Tokens are stored per account in <code style={{ fontFamily: 'monospace' }}>~/.gws-profiles</code> (0600) and never leave the main process.
      </p>
    </div>
  );
}
