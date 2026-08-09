import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useStore } from '../../store/store';
import { assignLanes } from '../../lib/git-graph';
import { timeAgo } from '../../lib/time-ago';
import { motion, AnimatePresence } from 'framer-motion';

const ROW_H = 30;
const LANE_W = 13;
const GRAPH_PAD = 8;
// Lane colors: index 0 uses the theme accent; the rest are fixed hues that
// read on every theme's dark/light surface.
const LANE_COLORS = ['var(--accent)', '#4C8DFF', '#3FB950', '#D29922', '#DB61A2', '#8957E5', '#F85149', '#39C5CF'];

/**
 * Git tree side panel (v1.0.52): IDE-style commit graph across ALL refs, with
 * branch/tag badges, checkout / new-branch / fetch, and deep links into the
 * repo's own GitHub remote (parsed from `git remote get-url origin`, so links
 * always target the correct repository for THIS project folder).
 */
export default function GitTreePanel({ projectDir }) {
  const visible = useStore((s) => s.toolPanel === 'gittree');
  const toggleToolPanel = useStore((s) => s.toggleToolPanel);

  const [graph, setGraph] = useState({ commits: [], head: '' });
  const [remote, setRemote] = useState({ remoteUrl: '', github: null });
  const [branches, setBranches] = useState({ current: '', local: [], remote: [] });
  const [errMsg, setErrMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [newBranch, setNewBranch] = useState(null); // { value } | null
  // Full commit message popover. Rows are fixed-height with an SVG graph
  // aligned to them, so expanding a row inline would desync the graph lines.
  // A popover reads the whole description without touching row layout.
  const [detail, setDetail] = useState(null); // { x, y, commit } | null

  // Dismiss on outside mousedown / Escape, the same pattern the GitSidePanel
  // context menu uses. A full-screen click-away DIV was the first attempt and
  // it SWALLOWED the click (closing the popover consumed the press meant for
  // the panel's own close button, Codex).
  useEffect(() => {
    if (!detail) return undefined;
    const onDown = () => setDetail(null);
    const onKey = (e) => { if (e.key === 'Escape') setDetail(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [detail]);
  const seqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.gitGraph || !projectDir) return;
    const seq = ++seqRef.current;
    const [g, r, b] = await Promise.all([
      window.electronAPI.gitGraph(projectDir, 150),
      window.electronAPI.gitRemoteInfo(projectDir),
      window.electronAPI.gitBranches(projectDir),
    ]);
    if (seq !== seqRef.current) return;
    setGraph(g || { commits: [], head: '' });
    setRemote(r || { remoteUrl: '', github: null });
    setBranches(b && !Array.isArray(b) ? b : { current: '', local: [], remote: [] });
  }, [projectDir]);

  useEffect(() => {
    if (visible) refresh();
  }, [visible, refresh]);

  // Transient error auto-clear.
  useEffect(() => {
    if (!errMsg) return;
    const t = setTimeout(() => setErrMsg(''), 6000);
    return () => clearTimeout(t);
  }, [errMsg]);

  const lanes = useMemo(() => assignLanes(graph.commits), [graph.commits]);
  const graphWidth = GRAPH_PAD * 2 + Math.min(lanes.laneCount, 8) * LANE_W;

  const openGh = useCallback((suffix) => {
    if (remote.github) window.electronAPI.openExternal(`${remote.github.githubUrl}${suffix}`);
  }, [remote.github]);

  // GitHub branch/tag paths keep their LITERAL slashes (encodeURIComponent's
  // %2F breaks /tree/ links for names like feat/x); encode each segment only.
  const ghPath = (name) => name.split('/').map(encodeURIComponent).join('/');

  const doCheckout = useCallback(async (branch) => {
    if (!branch || branch === branches.current || busy) return;
    setBusy(true);
    const res = await window.electronAPI.gitCheckout(projectDir, branch);
    setBusy(false);
    if (!res?.ok) setErrMsg(res?.error || 'Checkout failed');
    refresh();
  }, [projectDir, branches, busy, refresh]);

  const doCreateBranch = useCallback(async () => {
    const nb = newBranch;
    setNewBranch(null);
    if (!nb || !nb.value.trim() || busy) return;
    setBusy(true);
    const res = await window.electronAPI.gitCreateBranch(projectDir, nb.value.trim());
    setBusy(false);
    if (!res?.ok) setErrMsg(res?.error || 'Create failed');
    refresh();
  }, [newBranch, projectDir, busy, refresh]);

  const doFetch = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const res = await window.electronAPI.gitFetch(projectDir);
    setBusy(false);
    if (!res?.ok) setErrMsg(res?.error || 'Fetch failed');
    refresh();
  }, [projectDir, busy, refresh]);

  // Badge parsing: "HEAD -> main" / "origin/main" / "tag: v1.0.51".
  const badgeOf = (ref) => {
    if (ref.startsWith('HEAD ->')) return { label: ref.slice(8).trim(), kind: 'head' };
    if (ref === 'HEAD') return { label: 'HEAD', kind: 'head' };
    if (ref.startsWith('tag:')) return { label: ref.slice(4).trim(), kind: 'tag' };
    if (ref.includes('/')) return { label: ref, kind: 'remote' };
    return { label: ref, kind: 'local' };
  };
  const badgeColor = { head: 'var(--accent)', local: '#3FB950', remote: '#4C8DFF', tag: '#D29922' };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 380, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="shrink-0 overflow-hidden flex flex-col"
          style={{ borderLeft: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}
        >
          <div style={{ width: 380 }} className="flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="flex items-center gap-1.5 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--fg)' }}>Git Tree</span>
              {remote.github ? (
                <button
                  onClick={() => openGh('')}
                  title={`Open ${remote.github.githubUrl}`}
                  className="text-xs truncate"
                  style={{ color: 'var(--accent)', cursor: 'pointer', fontFamily: "'SF Mono', monospace", fontSize: 10 }}
                >
                  {remote.github.owner}/{remote.github.repo} ↗
                </button>
              ) : (
                <span className="text-xs truncate" style={{ color: 'var(--dim)', fontSize: 10 }} title={remote.remoteUrl || 'no remote'}>
                  {remote.remoteUrl ? 'non-GitHub remote' : 'no remote'}
                </span>
              )}
              <span className="flex-1" />
              <button onClick={doFetch} disabled={busy} title="git fetch --all --prune" className="text-xs px-1.5" style={{ color: busy ? 'var(--dim)' : 'var(--fg)', cursor: 'pointer' }}>
                {busy ? '…' : 'fetch'}
              </button>
              <button onClick={() => toggleToolPanel('gittree')} aria-label="Close Git Tree panel" className="text-xs px-1" style={{ color: 'var(--dim)', cursor: 'pointer' }}>✕</button>
            </div>

            {/* Branch row */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <select
                value={branches.current || ''}
                onChange={(e) => doCheckout(e.target.value)}
                disabled={busy}
                className="text-xs rounded outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--border)', padding: '2px 6px', fontFamily: "'SF Mono', monospace", maxWidth: 220 }}
                title="Checkout a local branch"
              >
                {branches.current && !branches.local.includes(branches.current) && (
                  <option value={branches.current}>{branches.current}</option>
                )}
                {branches.local.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              {newBranch ? (
                <input
                  autoFocus
                  value={newBranch.value}
                  onChange={(e) => setNewBranch({ value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') doCreateBranch(); if (e.key === 'Escape') setNewBranch(null); }}
                  onBlur={() => setNewBranch(null)}
                  placeholder="new-branch-name"
                  spellCheck={false}
                  className="flex-1 text-xs px-1.5 py-0.5 rounded outline-none"
                  style={{ backgroundColor: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--accent)', fontFamily: "'SF Mono', monospace" }}
                />
              ) : (
                <button onClick={() => setNewBranch({ value: '' })} title="Create a branch from HEAD" className="text-xs px-1.5" style={{ color: 'var(--dim)', cursor: 'pointer' }}>+ branch</button>
              )}
            </div>

            {errMsg && (
              <div className="px-3 py-1.5 text-xs shrink-0" style={{ color: '#F85149', backgroundColor: 'var(--surface)', whiteSpace: 'pre-wrap' }}>{errMsg}</div>
            )}

            {/* Graph */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {graph.commits.length === 0 && <p className="px-3 py-3 text-xs" style={{ color: 'var(--dim)' }}>No commits (not a git repo?)</p>}
              <div className="relative">
                {/* Lane SVG behind the rows */}
                <svg
                  width={graphWidth}
                  height={graph.commits.length * ROW_H}
                  className="absolute top-0 left-0"
                  style={{ pointerEvents: 'none' }}
                >
                  {lanes.rows.map((row, i) => (
                    row.edges.map((e, j) => {
                      const x1 = GRAPH_PAD + Math.min(e.from, 7) * LANE_W + LANE_W / 2;
                      const x2 = GRAPH_PAD + Math.min(e.to, 7) * LANE_W + LANE_W / 2;
                      const y1 = i * ROW_H + ROW_H / 2;
                      const y2 = (i + 1) * ROW_H + ROW_H / 2;
                      const color = LANE_COLORS[Math.min(e.kind === 'branch' ? e.to : e.from, 7) % LANE_COLORS.length];
                      return x1 === x2 ? (
                        <line key={`${i}-${j}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={1.5} opacity={0.75} />
                      ) : (
                        <path key={`${i}-${j}`} d={`M ${x1} ${y1} C ${x1} ${y1 + ROW_H / 2}, ${x2} ${y2 - ROW_H / 2}, ${x2} ${y2}`} stroke={color} strokeWidth={1.5} fill="none" opacity={0.75} />
                      );
                    })
                  ))}
                  {lanes.rows.map((row, i) => {
                    const cx = GRAPH_PAD + Math.min(row.lane, 7) * LANE_W + LANE_W / 2;
                    const cy = i * ROW_H + ROW_H / 2;
                    const isHead = graph.commits[i]?.hash === graph.head;
                    return (
                      <circle
                        key={`c-${i}`}
                        cx={cx} cy={cy} r={isHead ? 4.5 : 3.5}
                        fill={LANE_COLORS[Math.min(row.lane, 7) % LANE_COLORS.length]}
                        stroke={isHead ? 'var(--fg)' : 'none'}
                        strokeWidth={isHead ? 1.5 : 0}
                      />
                    );
                  })}
                </svg>

                {/* Commit rows */}
                {graph.commits.map((c) => (
                  <div
                    key={c.hash}
                    className="flex items-center gap-1.5 pr-2"
                    style={{ height: ROW_H, paddingLeft: graphWidth + 4 }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {c.refs.map(badgeOf).map((b, k) => (
                      <button
                        key={k}
                        onClick={() => {
                          if (b.kind === 'tag') openGh(`/releases/tag/${ghPath(b.label)}`);
                          else if (b.kind === 'remote') openGh(`/tree/${ghPath(b.label.split('/').slice(1).join('/'))}`);
                          else openGh(`/tree/${ghPath(b.label)}`);
                        }}
                        disabled={!remote.github}
                        title={remote.github ? `Open ${b.label} on GitHub` : b.label}
                        className="shrink-0 text-xs rounded px-1"
                        style={{
                          color: badgeColor[b.kind],
                          border: `1px solid ${badgeColor[b.kind]}`,
                          fontSize: 9,
                          fontFamily: "'SF Mono', monospace",
                          maxWidth: 110,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          cursor: remote.github ? 'pointer' : 'default',
                          opacity: b.kind === 'remote' ? 0.8 : 1,
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                    <button
                      className="text-xs truncate flex-1"
                      style={{
                        color: 'var(--fg)', fontSize: 11, textAlign: 'left',
                        background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                      }}
                      onClick={(e) => setDetail({ x: e.clientX, y: e.clientY, commit: c })}
                      title={`${c.subject}${c.body ? `\n\n${c.body}` : ''}\n\n${c.author}\nClick for the full message`}
                    >
                      {c.subject}
                    </button>
                    <button
                      onClick={() => {
                        if (remote.github) openGh(`/commit/${c.hash}`);
                        else navigator.clipboard?.writeText(c.hash).catch(() => {});
                      }}
                      title={remote.github ? 'Open commit on GitHub' : 'Copy hash'}
                      className="shrink-0 text-xs"
                      style={{ color: 'var(--dim)', fontFamily: "'SF Mono', monospace", fontSize: 9, cursor: 'pointer' }}
                    >
                      {c.hash.slice(0, 7)}
                    </button>
                    <span className="shrink-0 text-xs" style={{ color: 'var(--dim)', fontSize: 9 }}>{timeAgo(c.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Full commit message popover. Clamped to the viewport like the
              GitSidePanel context menu so it never renders off-screen. */}
          {detail && (() => {
            // Fit the viewport before clamping: a fixed 420 ran off-screen on
            // a narrow window (Codex, 320px wide left 108px unreachable).
            const W = Math.min(420, Math.max(200, window.innerWidth - 16));
            const H = Math.min(320, Math.max(160, window.innerHeight - 16));
            const x = Math.max(8, Math.min(detail.x, window.innerWidth - W - 8));
            const y = Math.max(8, Math.min(detail.y, window.innerHeight - H - 8));
            const c = detail.commit;
            return (
              <>
                <div
                  style={{
                    position: 'fixed', top: y, left: x, width: W, maxHeight: H,
                    overflowY: 'auto', zIndex: 1001, padding: 10,
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)', borderRadius: 6,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <p className="text-xs" style={{ color: 'var(--fg)', fontWeight: 600, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {c.subject}
                  </p>
                  {c.body && (
                    <p
                      className="text-xs"
                      style={{
                        color: 'var(--fg)', marginTop: 8, lineHeight: 1.45,
                        whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
                      }}
                    >
                      {c.body}
                    </p>
                  )}
                  <p className="text-xs" style={{ color: 'var(--dim)', marginTop: 8, fontSize: 10, fontFamily: "'SF Mono', monospace" }}>
                    {c.hash.slice(0, 7)} by {c.author}, {new Date(c.time).toLocaleString()}
                  </p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => { navigator.clipboard?.writeText(`${c.subject}${c.body ? `\n\n${c.body}` : ''}`).catch(() => {}); setDetail(null); }}
                      className="text-xs"
                      style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      Copy message
                    </button>
                    {remote.github && (
                      <button
                        onClick={() => { openGh(`/commit/${c.hash}`); setDetail(null); }}
                        className="text-xs"
                        style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                      >
                        Open on GitHub
                      </button>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
