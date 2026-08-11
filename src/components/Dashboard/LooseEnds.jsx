import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../store/store';
import { timeAgo } from '../../lib/time-ago';
import { parseDismissed, visibleLooseEnds, withDismissal } from '../../../shared/loose-dismiss.js';

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
  // "Not important" covers the session AS IT STOOD, so re-abandoned work comes
  // back. The rule is shared with the phone board (shared/loose-dismiss.js) to
  // stop the two copies drifting; keying on sessionId alone hid it forever.
  const [dismissed, setDismissed] = useState(() => {
    try { return parseDismissed(localStorage.getItem('dobius-loose-dismissed')); }
    catch { return {}; }
  });
  const resumeSession = useStore((s) => s.resumeSession);

  const load = useCallback(() => {
    if (!window.electronAPI?.dataGetLooseEnds) { setItems([]); return; }
    window.electronAPI.dataGetLooseEnds({ maxAgeDays: 30, limit: 25 })
      .then((r) => { setItems(Array.isArray(r) ? r : []); setErr(''); })
      .catch((e) => { setErr(e?.message || 'Could not read history'); setItems([]); });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Refresh when the window comes back. The list goes stale in ways that
  // matter: resuming from the phone (or another window) makes a row here a
  // duplicate-run waiting to happen. The scan is 36-87ms over a 21-day
  // history, so this is cheap enough to just do. Codex Critical.
  useEffect(() => {
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [load]);

  const dismiss = (item) => {
    setDismissed((cur) => {
      const next = withDismissal(cur, item);
      try { localStorage.setItem('dobius-loose-dismissed', JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  };

  // Refusing a session that is already running lives in the store's
  // resumeSession, not here: EVERY desktop resume path goes through it, so one
  // atomic claim there covers Cmd+R, the sidebar, Sessions and this list at
  // once. A guard only on this button left the others able to start a second
  // `claude --resume` on the same transcript (Codex Critical).
  //
  // `project` is REQUIRED: without it the store falls through to its legacy
  // bare-sessionId branch and resumes in whatever window is currently focused,
  // so a loose end from project A would start inside project B and link the
  // session to the wrong project (Codex High).
  const pickBackUp = (item) => resumeSession({
    sessionId: item.sessionId,
    project: item.projectPath,
    sizeMB: item.sizeMB,
  });

  const visible = visibleLooseEnds(items, dismissed);

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <h2 className="text-sm font-medium" style={{ color: 'var(--fg)' }}>Loose ends</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--dim)' }}>
            Sessions you interrupted, that stopped mid-task, or that never answered you.
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
                color: item.ending === 'interrupted' ? '#d29922'
                  : item.ending === 'unanswered' ? '#f85149' : '#58a6ff',
                backgroundColor: 'var(--bg)',
              }}
            >
              {item.ending === 'interrupted' ? 'you interrupted it'
                : item.ending === 'unanswered' ? 'never answered you' : 'stopped mid-task'}
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
              {item.ending === 'unanswered' ? 'You asked' : 'Last said'}: {item.snippet}
            </p>
          )}

          <div className="flex gap-3 mt-2">
            <button
              onClick={() => pickBackUp(item)}
              className="text-xs"
              style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Pick it back up
            </button>
            <button
              onClick={() => dismiss(item)}
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
