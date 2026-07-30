import { useState, useEffect, useMemo } from 'react';
import SessionCard from './SessionCard';
import { timeAgo } from './format';

// Group terminals by project, preserving first-seen order (mirrors Terminal.jsx).
function groupByProject(list) {
  const groups = [];
  const byName = new Map();
  for (const t of list) {
    const key = t.projectName || 'other';
    let g = byName.get(key);
    if (!g) { g = { projectName: key, terms: [] }; byName.set(key, g); groups.push(g); }
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

  useEffect(() => {
    const off = connection.onMessage((msg) => {
      if (msg.type === 'authed') {
        connection.send({ type: 'listTerminals' });
      } else if (msg.type === 'terminals') {
        setTerminals(msg.list || []);
        setRecentExits(msg.recentExits || []);
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
          <button className="icon-btn" onClick={onShowHistory} aria-label="Chat history">☷</button>
        </div>
        <div className="board-summary">
          <span className="conn-pill">
            <span className="status-dot" style={{ backgroundColor: dotColor }} />
            {status === 'authed' ? 'connected' : status === 'connecting' ? 'connecting' : 'offline'}
          </span>
          {needsCount > 0 && <span className="summary-chip chip-needs">{needsCount} needs you</span>}
          {workingCount > 0 && <span className="summary-chip chip-working">{workingCount} working</span>}
        </div>
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
            <section key={g.projectName} className="board-group">
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
    </div>
  );
}
