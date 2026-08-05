import { useState, useEffect, useMemo, useRef } from 'react';
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
// Device-local board preferences (v1.0.53): pinned tab ids + collapsed project
// paths. localStorage so they survive PWA restarts without a server round-trip.
const PINS_KEY = 'dobius-mobile-pins';
const COLLAPSED_KEY = 'dobius-mobile-collapsed';
const loadList = (key) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
};
const saveList = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private mode */ } };

export default function Board({ connection, status, onOpen, onShowHistory }) {
  const [terminals, setTerminals] = useState([]);
  const [recentExits, setRecentExits] = useState([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projects, setProjects] = useState([]);
  const [pins, setPins] = useState(() => loadList(PINS_KEY));
  const [collapsed, setCollapsed] = useState(() => loadList(COLLAPSED_KEY));

  const togglePin = (id) => {
    setPins((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      saveList(PINS_KEY, next);
      return next;
    });
  };
  const toggleCollapsed = (projectPath) => {
    setCollapsed((cur) => {
      const next = cur.includes(projectPath) ? cur.filter((x) => x !== projectPath) : [...cur, projectPath];
      saveList(COLLAPSED_KEY, next);
      return next;
    });
  };
  const [alerts, setAlerts] = useState('off'); // off | on | error
  const [alertMsg, setAlertMsg] = useState('');
  // Guards a createTerminal round-trip so a double-tap in the picker (Tailscale
  // latency) can't spawn two orphan PTYs. Reset on the reply. Audit MED-10.
  const creatingRef = useRef(false);

  // Reflect an ACTUAL subscription, not just permission (Codex Phase 5b P2), so
  // the bell keeps showing if the subscription was cleared/pruned server-side.
  // When one exists, re-register in the background so the server entry is bound
  // to the current device token (migrates any pre-token subscription so device
  // removal can revoke it). enablePush is idempotent and won't re-prompt.
  useEffect(() => {
    let cancelled = false;
    pushActive().then((active) => {
      if (cancelled || !active) return;
      setAlerts('on');
      enablePush().catch(() => { /* best-effort token rebind */ });
    });
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
        creatingRef.current = false;
        setPickerOpen(false);
        onOpen(msg.id); // jump straight into the new session
      } else if (msg.type === 'error') {
        // A rejected create (e.g. Unknown project) must release the guard and
        // surface, else the picker looks frozen. Audit MED-10.
        creatingRef.current = false;
        setAlertMsg(msg.message || 'Could not create session');
        setTimeout(() => setAlertMsg(''), 5000);
      }
    });
    if (connection.status === 'authed') connection.send({ type: 'listTerminals' });
    return off;
  }, [connection]);

  const groups = useMemo(() => {
    const g = groupByProject(terminals);
    return g.map((grp, i) => ({ ...grp, _i: i })).sort((a, b) => rank(a) - rank(b) || a._i - b._i);
  }, [terminals]);

  // Pinned rows in PIN order (the order Sam pinned them), only for tabs that
  // are currently alive; a dead pin silently waits (same tab id comes back on
  // app restart, since tab ids persist in the desktop config).
  const pinnedTerms = useMemo(() => {
    const byId = new Map(terminals.map((t) => [t.id, t]));
    return pins.map((id) => byId.get(id)).filter(Boolean);
  }, [terminals, pins]);

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
          <>
            {pinnedTerms.length > 0 && (
              <section className="board-group board-pinned">
                <div className="board-group-head">
                  <span className="board-group-name">★ Pinned</span>
                </div>
                {pinnedTerms.map((t) => (
                  <SessionCard
                    key={`pin-${t.id}`}
                    term={t}
                    onOpen={onOpen}
                    pinned
                    onTogglePin={togglePin}
                    titlePrefix={t.projectName || ''}
                  />
                ))}
              </section>
            )}
            {groups.map((g) => {
              const isCollapsed = collapsed.includes(g.projectPath);
              const needs = g.terms.filter((t) => t.status === 'needs').length;
              return (
                <section key={g.projectPath} className="board-group">
                  {/* Tap the project name to collapse/expand its tabs (v1.0.53). */}
                  <button className="board-group-head board-group-toggle" onClick={() => toggleCollapsed(g.projectPath)}>
                    <span className="board-group-caret">{isCollapsed ? '▸' : '▾'}</span>
                    <span className="board-group-name">{g.projectName}</span>
                    {isCollapsed && (
                      <span className="board-group-count">
                        {g.terms.length} tab{g.terms.length !== 1 ? 's' : ''}{needs > 0 ? ` · ${needs} needs you` : ''}
                      </span>
                    )}
                  </button>
                  {!isCollapsed && g.terms.map((t) => (
                    <SessionCard
                      key={t.id}
                      term={t}
                      onOpen={onOpen}
                      pinned={pins.includes(t.id)}
                      onTogglePin={togglePin}
                    />
                  ))}
                </section>
              );
            })}
          </>
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
                  onClick={() => {
                    if (creatingRef.current) return; // guard double-tap (MED-10)
                    creatingRef.current = true;
                    setPickerOpen(false); // close optimistically so a second tap can't fire
                    connection.send({ type: 'createTerminal', cwd: p.path });
                  }}
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
