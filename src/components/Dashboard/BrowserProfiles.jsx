import { useState, useEffect } from 'react';

// General Chrome-profile launcher (v1.0.41). Type or paste a URL, copy it, or
// open it in any of your Chrome profiles (each logged into a different Google
// account). No OAuth: Chrome is already authenticated per profile.
export default function BrowserProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [feedback, setFeedback] = useState('');
  const [opening, setOpening] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.electronAPI?.chromeListProfiles?.();
        if (!cancelled) setProfiles(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) setProfiles([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const flash = (msg, isError = false) => {
    setFeedback({ msg, isError });
    setTimeout(() => setFeedback(''), 2500);
  };

  const normalizeUrl = (raw) => {
    const t = (raw || '').trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    return `https://${t}`;
  };

  const handleCopy = async () => {
    const u = normalizeUrl(url);
    if (!u) return flash('Enter a URL first.', true);
    try {
      await navigator.clipboard.writeText(u);
      flash('URL copied.');
    } catch {
      flash('Could not copy.', true);
    }
  };

  const handleOpen = async (dir) => {
    const u = normalizeUrl(url);
    if (!u) return flash('Enter a URL first.', true);
    setOpening(dir);
    try {
      const res = await window.electronAPI?.chromeOpenUrl?.(dir, u);
      if (res?.ok) flash('Opened in Chrome.');
      else flash(res?.error || 'Could not open.', true);
    } catch {
      flash('Could not open.', true);
    } finally {
      setOpening('');
    }
  };

  const QUICK = [
    { label: 'Gmail', url: 'https://mail.google.com/' },
    { label: 'Calendar', url: 'https://calendar.google.com/' },
    { label: 'Drive', url: 'https://drive.google.com/' },
  ];

  const inp = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--fg)',
    borderRadius: '6px',
    padding: '8px 10px',
    fontSize: '13px',
    outline: 'none',
    width: '100%',
  };
  const btn = (variant = 'default', extra = {}) => ({
    padding: '6px 12px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    backgroundColor: variant === 'primary' ? 'var(--accent)' : 'var(--surface)',
    color: variant === 'primary' ? '#fff' : 'var(--fg)',
    border: variant === 'primary' ? '1px solid var(--accent)' : '1px solid var(--border)',
    ...extra,
  });

  const f = filter.trim().toLowerCase();
  const shown = f
    ? profiles.filter((p) => `${p.name} ${p.account}`.toLowerCase().includes(f))
    : profiles;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-1 text-lg font-semibold" style={{ color: 'var(--fg)' }}>Open in Chrome profile</div>
      <p className="text-xs mb-4" style={{ color: 'var(--dim)' }}>
        Paste a URL, then copy it or open it directly in the right Google account's Chrome profile.
      </p>

      <div className="flex gap-2 mb-2">
        <input
          style={inp}
          placeholder="paste a URL (e.g. mail.google.com or a doc link)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) handleOpen(shown[0].dir); }}
        />
        <button style={btn('default')} onClick={handleCopy}>Copy</button>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {QUICK.map((q) => (
          <button key={q.label} style={btn('default', { fontSize: 11, padding: '4px 10px' })} onClick={() => setUrl(q.url)}>
            {q.label}
          </button>
        ))}
      </div>

      {loaded && profiles.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--dim)' }}>
          No Chrome profiles found. Chrome may not be installed, or has no profiles yet.
        </p>
      )}

      {profiles.length > 0 && (
        <>
          <input
            style={{ ...inp, marginBottom: 10 }}
            placeholder={`Filter ${profiles.length} profiles by name or account`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="space-y-1.5">
            {shown.map((p) => (
              <div
                key={p.dir}
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <div className="min-w-0 mr-3">
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--fg)' }}>{p.name}</div>
                  <div className="text-xs truncate" style={{ color: 'var(--dim)', fontFamily: 'monospace' }}>
                    {p.account || 'not signed in'} <span style={{ opacity: 0.5 }}>· {p.dir}</span>
                  </div>
                </div>
                <button
                  style={btn('primary', { opacity: opening === p.dir ? 0.6 : 1 })}
                  disabled={opening === p.dir}
                  onClick={() => handleOpen(p.dir)}
                >
                  {opening === p.dir ? 'Opening…' : 'Open'}
                </button>
              </div>
            ))}
            {shown.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--dim)' }}>No profiles match "{filter}".</p>
            )}
          </div>
        </>
      )}

      {feedback && (
        <p className="text-xs mt-3" style={{ color: feedback.isError ? '#f87171' : 'var(--dim)' }}>
          {feedback.msg}
        </p>
      )}
    </div>
  );
}
