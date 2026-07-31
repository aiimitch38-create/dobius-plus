import { useState, useEffect, useMemo, useCallback } from 'react';
import { useStore } from '../../store/store';
import { STATUS_COLORS, STATUS_LABELS } from '../../lib/status-colors';

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/**
 * "Tabs by project" sidebar view (Brett task 1217038024225884). Purely additive:
 * lists every project's tabs across ALL open Dobius windows, grouped by project,
 * each tab with its most recent message + time. Reads the read-only
 * data:getAllProjectTabs aggregate; never mutates history/restore/naming.
 *
 * Click behavior is deliberately safe across windows (no duplicate live
 * sessions):
 *   - a tab live in THIS window          -> switch to it
 *   - a tab in ANOTHER project           -> open/focus that project's window
 *   - a tab in THIS project, not live    -> resume its session here (if linked)
 */
export default function ProjectTabsView({ search = '', onResumeSession }) {
  const [groups, setGroups] = useState(null); // null = loading
  const currentProjectPath = useStore((s) => s.currentProjectPath);
  const terminalTabs = useStore((s) => s.terminalTabs);
  const tabStatus = useStore((s) => s.tabStatus);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const setActiveView = useStore((s) => s.setActiveView);
  const [collapsed, setCollapsed] = useState({}); // path -> true when collapsed

  const refresh = useCallback(() => {
    if (!window.electronAPI?.dataGetAllProjectTabs) { setGroups([]); return; }
    window.electronAPI.dataGetAllProjectTabs()
      .then((g) => setGroups(Array.isArray(g) ? g : []))
      .catch(() => setGroups([]));
  }, []);

  // Refresh on open, then poll: the aggregate spans other windows, so there's no
  // in-window event for their changes. 5s is cheap (one read-only IPC).
  useEffect(() => {
    refresh();
    const i = setInterval(refresh, 5000);
    return () => clearInterval(i);
  }, [refresh]);

  const liveHere = useCallback(
    (projectPath, tabId) => projectPath === currentProjectPath && terminalTabs.some((t) => t.id === tabId),
    [currentProjectPath, terminalTabs],
  );

  const handleClick = useCallback((projectPath, tab) => {
    if (liveHere(projectPath, tab.id)) {
      setActiveTab(tab.id);
      setActiveView('terminal');
      return;
    }
    if (projectPath !== currentProjectPath) {
      window.electronAPI?.windowOpenProject?.(projectPath);
      return;
    }
    // This project, tab not live: resume its linked session in this window.
    if (tab.sessionId) onResumeSession?.({ sessionId: tab.sessionId, project: projectPath });
  }, [liveHere, currentProjectPath, setActiveTab, setActiveView, onResumeSession]);

  // Filter by search across tab label + preview + project name. Keep a project
  // only if it still has matching tabs.
  const filtered = useMemo(() => {
    if (!groups) return null;
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const nameHit = (g.name || '').toLowerCase().includes(q);
        const tabs = g.tabs.filter((t) => nameHit
          || (t.label || '').toLowerCase().includes(q)
          || (t.preview || '').toLowerCase().includes(q));
        return { ...g, tabs };
      })
      .filter((g) => g.tabs.length > 0);
  }, [groups, search]);

  if (filtered === null) {
    return (
      <div className="p-2 space-y-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="px-3 py-2 animate-pulse">
            <div className="h-3 w-2/3 rounded" style={{ backgroundColor: 'var(--border)' }} />
            <div className="h-2.5 w-1/2 mt-1.5 rounded" style={{ backgroundColor: 'var(--border)' }} />
          </div>
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="p-3 text-xs" style={{ color: 'var(--dim)' }}>
        {search ? 'No matching tabs' : 'No open tabs yet'}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {filtered.map((g) => {
        const isCurrent = g.path === currentProjectPath;
        const isCollapsed = collapsed[g.path];
        return (
          <div key={g.path} style={{ borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [g.path]: !c[g.path] }))}
              className="w-full flex items-center justify-between px-3 py-1.5"
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: isCurrent ? 'var(--fg)' : 'var(--dim)',
                fontSize: 11, fontFamily: "'SF Mono', monospace",
                textTransform: 'uppercase', letterSpacing: '0.08em',
              }}
              title={g.path}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span className="truncate" style={{ fontWeight: isCurrent ? 700 : 500 }}>
                {g.name}{isCurrent ? ' • here' : ''}
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <span style={{ color: 'var(--dim)', fontSize: 9 }}>{g.tabs.length}</span>
                <span style={{ fontSize: 8 }}>{isCollapsed ? '▶' : '▼'}</span>
              </span>
            </button>
            {!isCollapsed && (
              <div className="pb-1">
                {g.tabs.map((t) => {
                  const live = liveHere(g.path, t.id);
                  const status = (live ? tabStatus[t.id] : t.status) || 'idle';
                  const dot = STATUS_COLORS[status] || 'var(--dim)';
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleClick(g.path, t)}
                      className="w-full flex items-start gap-2 px-3 py-1.5 rounded"
                      style={{
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        textAlign: 'left', color: 'var(--fg)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface-hover, var(--border))'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title={live ? 'Switch to this tab' : (g.path === currentProjectPath ? 'Resume this session' : 'Open this project window')}
                    >
                      <span
                        title={STATUS_LABELS[status] || status}
                        style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: dot, flexShrink: 0, marginTop: 5 }}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span className="truncate" style={{ fontSize: 12, fontWeight: 600 }}>
                            {t.label}{t.kind === 'browser' ? ' ○' : ''}
                          </span>
                          {live && <span style={{ fontSize: 9, color: 'var(--accent)', flexShrink: 0 }}>live</span>}
                          <span style={{ fontSize: 9, color: 'var(--dim)', marginLeft: 'auto', flexShrink: 0 }}>
                            {timeAgo(t.lastActiveAt)}
                          </span>
                        </span>
                        {t.preview && (
                          <span
                            className="truncate"
                            style={{ display: 'block', fontSize: 11, color: 'var(--dim)', marginTop: 1 }}
                          >
                            {t.preview}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
