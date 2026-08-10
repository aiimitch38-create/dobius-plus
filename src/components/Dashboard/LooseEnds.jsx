import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../store/store';
import { timeAgo } from '../../lib/time-ago';

/**
 * Loose ends: work you started and walked away from.
 *
 * This exists because a read-only analysis of the real ~/.claude history said
 * so, and it contradicted the obvious design. ZERO of 102 substantive sessions
 * in 21 days ended with Claude waiting on an answer, so an "needs your reply"
 * inbox would have been a feature for a problem that does not occur. What DOES
 * happen: sessions get interrupted or cut off mid tool-call and are never
 * picked up again, some 12 to 20 days later.
 *
 * Deliberately NOT shown: sessions that ended with a finished answer, and
 * anything still live. Nagging about completed work is how a list like this
 * loses credibility and starts getting ignored.
 */
export default function LooseEnds() {
  const [items, setItems] = useState(null); // null = loading
  const [err, setErr] = useState('');
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('dobius-loose-dismissed') || '[]')); }
    catch { return new Set(); }
  });
  const resumeSession = useStore((s) => s.resumeSession);

  const load = useCallback(() => {
    if (!window.electronAPI?.dataGetLooseEnds) { setItems([]); return; }
    window.electronAPI.dataGetLooseEnds({ maxAgeDays: 30, limit: 25 })
      .then((r) => { setItems(Array.isArray(r) ? r : []); setErr(''); })
      .catch((e) => { setErr(e?.message || 'Could not read history'); setItems([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismiss = (sessionId) => {
    setDismissed((cur) => {
      const next = new Set(cur);
      next.add(sessionId);
      try { localStorage.setItem('dobius-loose-dismissed', JSON.stringify([...next])); } catch { /* private mode */ }
      return next;
    });
  };

  const visible = (items || []).filter((i) => !dismissed.has(i.sessionId));

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium" style={{ color: 'var(--fg)' }}>Loose ends</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            Sessions you interrupted or that stopped mid-task, and never came back to.
          </p>
        </div>
        <button
          onClick={load}
          className="text-xs px-2 py-1 rounded"
          style={{ color: 'var(--dim)', border: '1px solid var(--border)', cursor: 'pointer', background: 'transparent' }}
        >
          Refresh
        </button>
      </div>

      {items === null && <p className="text-xs" style={{ color: 'var(--dim)' }}>Reading history...</p>}
      {err && <p className="text-xs" style={{ color: '#f85149' }}>{err}</p>}
      {items !== null && visible.length === 0 && !err && (
        <p className="text-xs" style={{ color: 'var(--dim)' }}>
          Nothing hanging. Every recent session either finished or is still running.
        </p>
      )}

      {visible.map((item, i) => (
        <motion.div
          key={item.sessionId}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.03, 0.3) }}
          className="rounded p-3"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                fontSize: 9,
                color: item.ending === 'interrupted' ? '#d29922' : '#58a6ff',
                backgroundColor: 'var(--bg)',
              }}
            >
              {item.ending === 'interrupted' ? 'you interrupted it' : 'stopped mid-task'}
            </span>
            <span className="text-xs font-medium" style={{ color: 'var(--fg)' }}>{item.projectName}</span>
            <span className="text-xs" style={{ color: 'var(--dim)' }}>
              {timeAgo(item.lastActivityAt)}
            </span>
            {item.sizeMB > 80 && (
              <span className="text-xs" style={{ color: 'var(--dim)', fontSize: 9 }}>
                {item.sizeMB}MB transcript
              </span>
            )}
          </div>

          {item.snippet && (
            <p
              className="text-xs mt-1.5"
              style={{ color: 'var(--dim)', lineHeight: 1.45, overflowWrap: 'anywhere' }}
            >
              Last said: {item.snippet}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            <button
              // `project` is REQUIRED: without it the store falls through to
              // its legacy bare-sessionId branch and resumes in whatever
              // window is currently focused, so a loose end from project A
              // would start inside project B and link the session to the
              // wrong project (Codex High).
              onClick={() => resumeSession({
                sessionId: item.sessionId,
                project: item.projectPath,
                sizeMB: item.sizeMB,
              })}
              className="text-xs"
              style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Pick it back up
            </button>
            <button
              onClick={() => dismiss(item.sessionId)}
              className="text-xs"
              style={{ color: 'var(--dim)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
              title="Hide this one. It stays hidden on this machine."
            >
              Not important
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
