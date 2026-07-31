import { useState, useEffect, useMemo } from 'react';
import SessionCard from './SessionCard';
import VoiceButton from './VoiceButton';
import { pushSupported, pushActive, enablePush } from './push-client';
import { timeAgo } from './format';

// Group terminals by project PATH, preserving first-seen order. Keyed on path,
// not name, so two projects that share a folder name (Sam runs several
// `blueatlasbiologics.com` / `blueatlasusa.com` checkouts) stay separate
// sections instead of merging with duplicate tab labels. Codex Phase 2 P2.
function groupByProject(list) {
  const groups = [];
  const byPath = new Map();
  for (const t of list) {
    const key = t.projectPath || t.projectName || 'other';
    let g = byPath.get(key);
    if (!g) { g = { projectPath: key, projectName: t.projectName || key, terms: [] }; byPath.set(key, g); groups.push(g); }
    g.terms.push(t);
  }
  return groups;
}

// Order projects so anything needing attention floats up: a project with a
// 'needs' tab first, then one with 'working', then the rest.
function rank(g) {
  if (g.terms.some((t) => t.status === 'needs')) return 0;
  if (g.terms.some((t) => t.status === 'working')) return 1;
  return 2;
}

/**
 * The session board: the phone's home. A live, status-rich overview of every
 * terminal on the Mac, one tap into any of them. Consumes the status-rich
 * `terminals` payload the server pushes on change (v1.0.43 Phase 1b).
 */
export default function Board({ connection, status, onOpen, onShowHistory }) {
  const [terminals, setTerminals] = useState([]);
  const [recentExits, setRecentExits] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [alerts, setAlerts] = useState('off'); // off | on | error
  const [alertMsg, setAlertMsg] = useState('');

  // Reflect an ACTUAL subscription, not just permission (Codex Phase 5b P2), so
  // the bell keeps showing if the subscription was cleared/pruned server-side.
  useEffect(() => {
    let cancelled = false;
    pushActive().then((active) => { if (!cancelled && active) setAlerts('on'); });
    return () => { cancelled = true; };
  }, []);
  // Tick so relative times ("3m") refresh on quiet sessions: the server omits
  // lastActivityAt from its change signature, so without this the board only
  // re-renders on a status change and a time could stay "just now". Codex P3.
  const [, setTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const off = connection.onMessage((msg) => {
      if (msg.type === 'authed') {
        connection.send({ type: 'listTerminals' });
      } else if (msg.type === 'terminals') {
        setTerminals(msg.list || []);
        setRecentExits(msg.recentExits || []);
      } else if (msg.type === 'projects') {
        setProjects(msg.list || []);
      } else if (msg.type === 'terminalCreated') {
        setPickerOpen(false);
        onOpen(msg.id); // jump straight into the new session
      }
    });
    if (connection.status === 'authed') connection.send({ type: 'listTerminals' });
    return off;
  }, [connection]);

  const groups = useMemo(() => {
    const g = groupByProject(terminals);
    return g.map((grp, i) => ({ ...grp, _i: i })).sort((a, b) => rank(a) - rank(b) || a._i - b._i);
  }, [terminals]);

  const needsCount = terminals.filter((t) => t.status === 'needs').length;
  const workingCount = terminals.filter((t) => t.status === 'working').length;

  const dotColor = status === 'authed' ? 'var(--status-done)'
    : status === 'connecting' ? 'var(--status-working)' : 'var(--status-needs)';

  return (
    <div className="screen board-screen">
      <header className="board-header">
        <div className="board-title-row">
          <h1 className="board-title">Sessions</h1>
          <div className="board-actions">
            {pushSupported() && alerts !== 'on' && (
              <button
                className="icon-btn"
                onClick={async () => {
                  const r = await enablePush();
                  setAlerts(r.ok ? 'on' : 'error');
                  setAlertMsg(r.ok ? '' : (r.error || 'Could not enable alerts'));
                  if (!r.ok) setTimeout(() => setAlertMsg(''), 5000);
                }}
                aria-label="Enable notifications"
                title="Get notified when a session needs you"
              >🔔</button>
            )}
            <button className="icon-btn" onClick={onShowHistory} aria-label="Chat history">☷</button>
            <button
              className="icon-btn"
              onClick={() => { setPickerOpen(true); connection.send({ type: 'listProjects' }); }}
              aria-label="New session"
            >+</button>
          </div>
        </div>
        <div className="board-summary">
          <span className="conn-pill">
            <span className="status-dot" style={{ backgroundColor: dotColor }} />
            {status === 'authed' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline'}
          </span>
          {needsCount > 0 && <span className="summary-chip chip-needs">{needsCount} needs you</span>}
          {workingCount > 0 && <span className="summary-chip chip-working">{workingCount} working</span>}
        </div>
        {alertMsg && <div className="board-alert">{alertMsg}</div>}
      </header>

      <main className="board-body">
        {terminals.length === 0 ? (
          <div className="board-empty">
            <div className="board-empty-glyph">◍</div>
            <p className="board-empty-title">No sessions running</p>
            <p className="muted small">
              {status === 'authed'
                ? 'Open a terminal on your Mac and it will appear here.'
                : 'Waiting for the connection to your Mac…'}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.projectPath} className="board-group">
              <div className="board-group-head">{g.projectName}</div>
              {g.terms.map((t) => (
                <SessionCard key={t.id} term={t} onOpen={onOpen} />
              ))}
            </section>
          ))
        )}

        {recentExits.length > 0 && (
          <section className="board-group board-exits">
            <div className="board-group-head">Recently finished</div>
            {recentExits.slice(-5).reverse().map((e) => (
              <div key={`${e.id}-${e.at}`} className="exit-row">
                <span className={`exit-dot ${e.exitCode === 0 ? 'ok' : 'bad'}`} aria-hidden="true" />
                <span className="exit-main">
                  <span className="card-title">{e.projectName || 'terminal'}</span>
                  <span className="card-sub">
                    {e.exitCode === 0 ? 'finished' : `exited ${e.exitCode ?? ''}`}
                    {e.at ? ` · ${timeAgo(e.at)}` : ''}
                  </span>
                </span>
              </div>
            ))}
          </section>
        )}
      </main>

      <VoiceButton />

      {pickerOpen && (
        <div className="sheet-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-title">New session in…</div>
            <div className="sheet-list">
              {projects.length === 0 && <div className="sheet-empty">Loading projects…</div>}
              {projects.map((p) => (
                <button
                  key={p.path}
                  className="sheet-item"
                  onClick={() => connection.send({ type: 'createTerminal', cwd: p.path })}
                >
                  <span className="card-title">{p.name}</span>
                  <span className="card-sub">{p.path}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
