import { useState, useEffect, useRef } from 'react';

// Google Workspace (gws) accounts (v1.0.41; health + reconnect v1.0.61).
// Connect multiple Google accounts so the gws CLI (and in-app flows) can act
// as a chosen account by email.
//
// The v1.0.61 half exists because a live audit found 4 of 5 stored grants
// revoked by Google (invalid_grant) and NOTHING in this panel said so: every
// Claude command through those accounts just failed. Now each row probes its
// grant and a dead one is a single Reconnect click.
const STATUS_META = {
  ok: { color: '#3fb950', label: 'connected' },
  revoked: { color: '#f87171', label: 'revoked by Google, reconnect' },
  error: { color: '#d29922', label: 'check failed' },
  unknown: { color: 'var(--dim)', label: 'checking…' },
};

export default function GwsAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState({});      // id -> 'ok' | 'revoked' | 'error'
  const [reconnecting, setReconnecting] = useState(''); // account id mid-flow
  const [feedback, setFeedback] = useState('');
  // Fallback consent link, shown a few seconds AFTER the browser opens: the
  // default browser opens its last-active profile, which can be the wrong
  // Google identity entirely (Sam, 8/15). Spec: open first, then offer the
  // copyable link.
  const [authLink, setAuthLink] = useState(null); // { id, url }
  const authLinkTimer = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    const off = window.electronAPI?.onGwsReconnectUrl?.((data) => {
      if (!data?.id || !data?.url) return;
      clearTimeout(authLinkTimer.current);
      authLinkTimer.current = setTimeout(() => {
        if (mountedRef.current) setAuthLink({ id: data.id, url: data.url });
      }, 3000);
    });
    return () => { clearTimeout(authLinkTimer.current); off?.(); };
  }, []);

  const verify = async (force = false) => {
    try {
      const res = await window.electronAPI?.gwsVerify?.({ force });
      if (!mountedRef.current || !Array.isArray(res)) return;
      const next = {};
      for (const r of res) next[r.id] = r.status;
      setHealth(next);
    } catch { /* probe is best-effort; rows fall back to 'checking' */ }
  };

  const reload = async () => {
    try {
      const list = await window.electronAPI?.gwsList?.();
      if (mountedRef.current) setAccounts(Array.isArray(list) ? list : []);
    } catch {
      if (mountedRef.current) setAccounts([]);
    } finally {
      if (mountedRef.current) setLoaded(true);
    }
  };
  useEffect(() => { reload().then(() => verify(false)); }, []);

  const flash = (msg, isError = false) => {
    // Reconnect can resolve minutes later (browser approval); by then this
    // panel may be unmounted, and setState on an unmounted component is the
    // classic leak warning (Codex P3). Guard here so no caller has to.
    if (!mountedRef.current) return;
    setFeedback({ msg, isError });
    setTimeout(() => { if (mountedRef.current) setFeedback(''); }, 8000);
  };

  const handleConnect = async () => {
    setBusy(true);
    try {
      const res = await window.electronAPI?.gwsConnect?.();
      if (res?.ok) {
        flash(`Connected ${res.account?.email || 'account'}.`);
        await reload();
        await verify(true);
      } else {
        flash(res?.error || 'Could not connect.', true);
      }
    } catch {
      flash('Could not connect.', true);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  const copyAuthLink = async () => {
    if (!authLink?.url) return;
    if (!navigator.clipboard?.writeText) {
      window.prompt('Copy this sign-in link:', authLink.url);
      return;
    }
    try {
      await navigator.clipboard.writeText(authLink.url);
      flash('Sign-in link copied. Paste it into the right browser profile.');
    } catch {
      window.prompt('Copy this sign-in link:', authLink.url);
    }
  };

  const handleReconnect = async (a) => {
    setReconnecting(a.id);
    clearTimeout(authLinkTimer.current);
    setAuthLink(null);
    flash(`Approve ${a.email} in the browser window that just opened…`);
    try {
      const res = await window.electronAPI?.gwsReconnect?.(a.id);
      if (res?.ok) {
        // The flow may have refreshed a DIFFERENT account (the browser has no
        // account hint), and it switches the terminal's base gws identity to
        // whatever was approved. Say both plainly.
        let msg = res.warning || `Reconnected ${res.approvedEmail}.`;
        if (!res.warning && res.baseChangedFrom) {
          msg += ` Heads up: your terminal's bare gws identity moved from ${res.baseChangedFrom} to ${res.approvedEmail}; reconnect ${res.baseChangedFrom} last to switch it back.`;
        }
        flash(msg, !!res.warning);
        await reload();
        await verify(true);
      } else {
        flash(res?.error || 'Reconnect failed.', true);
      }
    } catch {
      flash('Reconnect failed.', true);
    } finally {
      clearTimeout(authLinkTimer.current);
      if (mountedRef.current) { setReconnecting(''); setAuthLink(null); }
    }
  };

  const handleRemove = async (id) => {
    try {
      const res = await window.electronAPI?.gwsRemove?.(id);
      await reload();
      // removeGwsAccount returns { ok:false } (without throwing) when it keeps
      // the account because the token file could not be deleted. Honor it, or
      // the UI would claim success while the credentials are still on disk.
      // Codex v1.0.41 r6 P2.
      if (res?.ok) flash('Account removed.');
      else flash(res?.error || 'Could not remove.', true);
    } catch {
      flash('Could not remove.', true);
    }
  };

  const btn = (variant = 'default', extra = {}) => ({
    padding: '5px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: busy || reconnecting ? 'wait' : 'pointer',
    backgroundColor: variant === 'primary' ? 'var(--accent)' : 'var(--surface)',
    color: variant === 'primary' ? '#fff' : 'var(--fg)',
    border: variant === 'primary' ? '1px solid var(--accent)' : '1px solid var(--border)',
    ...extra,
  });

  const anyRevoked = accounts.some((a) => health[a.id] === 'revoked');

  return (
    <div className="mt-6">
      <div
        className="text-xs font-medium uppercase tracking-wider mb-3 pb-1 flex items-center justify-between"
        style={{ color: 'var(--dim)', borderBottom: '1px solid var(--border)', letterSpacing: '0.08em' }}
      >
        <span>Google Workspace accounts</span>
        <button
          onClick={() => verify(true)}
          style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', fontSize: 11, textTransform: 'none', letterSpacing: 0 }}
          title="Re-check every account's grant against Google"
        >
          Check health
        </button>
      </div>

      {loaded && accounts.length === 0 && (
        <p className="text-xs mb-3" style={{ color: 'var(--dim)' }}>
          No Google accounts connected. Log into an account with <code style={{ fontFamily: 'monospace' }}>gws auth login</code> in a terminal, then click Connect. Repeat (logout, log into the next account, Connect) to add more.
        </p>
      )}

      <div className="space-y-2 mb-3">
        {accounts.map((a) => {
          const st = STATUS_META[health[a.id]] || STATUS_META.unknown;
          const isReconnecting = reconnecting === a.id;
          return (
            <div
              key={a.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="min-w-0 flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, backgroundColor: st.color }}
                  title={st.label}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{a.email}</div>
                  <div className="text-xs mt-0.5" style={{ color: health[a.id] === 'revoked' ? '#f87171' : 'var(--dim)' }}>
                    {st.label} · {(a.scopes?.length || 0)} scope{(a.scopes?.length || 0) === 1 ? '' : 's'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {(health[a.id] === 'revoked' || health[a.id] === 'error') && (
                  <button
                    style={btn('primary', { opacity: reconnecting && !isReconnecting ? 0.5 : 1 })}
                    disabled={!!reconnecting}
                    onClick={() => handleReconnect(a)}
                  >
                    {isReconnecting ? 'Waiting for browser…' : 'Reconnect'}
                  </button>
                )}
                <button
                  style={btn('default', { color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' })}
                  disabled={!!reconnecting}
                  onClick={() => handleRemove(a.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button style={btn('primary', { opacity: busy ? 0.6 : 1 })} disabled={busy || !!reconnecting} onClick={handleConnect}>
        {busy ? 'Connecting…' : '+ Connect Google Account'}
      </button>

      {feedback && (
        <p className="text-xs mt-2" style={{ color: feedback.isError ? '#f87171' : 'var(--dim)' }}>
          {feedback.msg}
        </p>
      )}

      {authLink && reconnecting === authLink.id && (
        <div className="text-xs mt-2 flex items-center gap-2" style={{ color: 'var(--dim)' }}>
          <span>Browser opened in the wrong profile? Paste the sign-in link into the right one:</span>
          <button style={btn('default', { flexShrink: 0 })} onClick={copyAuthLink}>Copy link</button>
        </div>
      )}

      {anyRevoked && (
        <p className="text-xs mt-2" style={{ color: '#d29922' }}>
          Reconnect opens a Google approval in your browser: pick the matching account. Reconnecting also switches which account a bare <code style={{ fontFamily: 'monospace' }}>gws</code> acts as, so reconnect your main account last.
        </p>
      )}

      <p className="text-xs mt-3" style={{ color: 'var(--dim)' }}>
        Connect snapshots the account currently logged into gws. Tokens are stored per account in <code style={{ fontFamily: 'monospace' }}>~/.gws-profiles</code> (0600) and never leave the main process.
      </p>
    </div>
  );
}
