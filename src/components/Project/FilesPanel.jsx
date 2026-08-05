import { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '../../store/store';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Files side panel (v1.0.52): browse / preview / manage the project folder.
 * Opened from the TopBar Terminal dropdown. Drill-down navigation in a single
 * column (like the mobile pattern): directory list, tap a file for an inline
 * preview with a back button. All fs access is IPC to file-manager-service,
 * which enforces realpath containment under the project root.
 */
export default function FilesPanel({ projectDir }) {
  const visible = useStore((s) => s.toolPanel === 'files');
  const toggleToolPanel = useStore((s) => s.toggleToolPanel);

  const [relPath, setRelPath] = useState('');
  const [listing, setListing] = useState(null);   // { relPath, entries, error?, truncated? }
  const [preview, setPreview] = useState(null);   // { relPath, data } | null
  const [busyMsg, setBusyMsg] = useState('');
  const [contextMenu, setContextMenu] = useState(null); // { x, y, entry }
  const [renaming, setRenaming] = useState(null); // { entry, value }
  const [creating, setCreating] = useState(null); // { kind, value }
  const seqRef = useRef(0); // drop out-of-order listing replies

  const load = useCallback(async (rel) => {
    if (!window.electronAPI?.filesList || !projectDir) return;
    const seq = ++seqRef.current;
    const res = await window.electronAPI.filesList(projectDir, rel);
    if (seq !== seqRef.current) return;
    setListing(res || { relPath: rel, entries: [], error: 'unavailable' });
    setRelPath(res?.relPath ?? rel);
  }, [projectDir]);

  useEffect(() => {
    if (!visible) return;
    setPreview(null);
    load(relPath);
    // relPath deliberately not a dep: navigation calls load() directly; this
    // effect is the open-the-panel refresh.
  }, [visible, projectDir, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss context menu on outside click / Escape (GitSidePanel idiom).
  useEffect(() => {
    if (!contextMenu) return;
    const onDown = () => setContextMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setContextMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const joinRel = (name) => (relPath ? `${relPath}/${name}` : name);

  const openEntry = useCallback(async (entry) => {
    if (entry.type === 'dir') {
      const next = joinRel(entry.name);
      setPreview(null);
      load(next);
    } else {
      const data = await window.electronAPI.filesPreview(projectDir, joinRel(entry.name));
      setPreview({ relPath: joinRel(entry.name), name: entry.name, data });
    }
  }, [projectDir, relPath, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const goUp = useCallback(() => {
    if (!relPath) return;
    const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
    setPreview(null);
    load(parent);
  }, [relPath, load]);

  const doRename = useCallback(async () => {
    const r = renaming;
    setRenaming(null);
    if (!r || !r.value.trim() || r.value === r.entry.name) return;
    const res = await window.electronAPI.filesRename(projectDir, joinRel(r.entry.name), r.value.trim());
    if (!res?.ok) setBusyMsg(res?.error || 'Rename failed');
    load(relPath);
  }, [renaming, projectDir, relPath, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const doCreate = useCallback(async () => {
    const c = creating;
    setCreating(null);
    if (!c || !c.value.trim()) return;
    const res = await window.electronAPI.filesCreate(projectDir, relPath, c.value.trim(), c.kind);
    if (!res?.ok) setBusyMsg(res?.error || 'Create failed');
    load(relPath);
  }, [creating, projectDir, relPath, load]);

  const doTrash = useCallback(async (entry) => {
    setContextMenu(null);
    const res = await window.electronAPI.filesTrash(projectDir, joinRel(entry.name));
    if (!res?.ok) setBusyMsg(res?.error || 'Trash failed');
    load(relPath);
  }, [projectDir, relPath, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Transient error toast auto-clears.
  useEffect(() => {
    if (!busyMsg) return;
    const t = setTimeout(() => setBusyMsg(''), 4000);
    return () => clearTimeout(t);
  }, [busyMsg]);

  const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(0)}KB` : `${n}B`);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 300, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="shrink-0 overflow-hidden flex flex-col"
          style={{ borderLeft: '1px solid var(--border)', backgroundColor: 'var(--bg)' }}
        >
          <div style={{ width: 300 }} className="flex flex-col h-full min-h-0">
            {/* Header */}
            <div className="flex items-center gap-1.5 px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--fg)' }}>Files</span>
              <span className="text-xs truncate flex-1" style={{ color: 'var(--dim)', fontFamily: "'SF Mono', monospace", fontSize: 10 }} title={relPath || '/'}>
                /{relPath}
              </span>
              <button onClick={() => setCreating({ kind: 'file', value: '' })} title="New file" className="text-xs px-1.5" style={{ color: 'var(--dim)', cursor: 'pointer' }}>+f</button>
              <button onClick={() => setCreating({ kind: 'dir', value: '' })} title="New folder" className="text-xs px-1.5" style={{ color: 'var(--dim)', cursor: 'pointer' }}>+d</button>
              <button onClick={() => toggleToolPanel('files')} aria-label="Close Files panel" className="text-xs px-1" style={{ color: 'var(--dim)', cursor: 'pointer' }}>✕</button>
            </div>

            {busyMsg && (
              <div className="px-3 py-1.5 text-xs shrink-0" style={{ color: '#F85149', backgroundColor: 'var(--surface)' }}>{busyMsg}</div>
            )}

            {creating && (
              <div className="px-3 py-2 shrink-0 flex items-center gap-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <span className="text-xs" style={{ color: 'var(--dim)' }}>{creating.kind === 'dir' ? 'folder:' : 'file:'}</span>
                <input
                  autoFocus
                  value={creating.value}
                  onChange={(e) => setCreating({ ...creating, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') doCreate(); if (e.key === 'Escape') setCreating(null); }}
                  onBlur={() => setCreating(null)}
                  spellCheck={false}
                  className="flex-1 text-xs px-1.5 py-0.5 rounded outline-none"
                  style={{ backgroundColor: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--accent)', fontFamily: "'SF Mono', monospace" }}
                />
              </div>
            )}

            {/* Preview mode */}
            {preview ? (
              <div className="flex-1 min-h-0 flex flex-col">
                <div className="flex items-center gap-1.5 px-3 py-1.5 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                  <button onClick={() => setPreview(null)} className="text-xs" style={{ color: 'var(--accent)', cursor: 'pointer' }}>‹ back</button>
                  <span className="text-xs truncate flex-1" style={{ color: 'var(--fg)', fontFamily: "'SF Mono', monospace", fontSize: 10 }} title={preview.relPath}>{preview.name}</span>
                  <button onClick={() => window.electronAPI.filesOpen(projectDir, preview.relPath)} className="text-xs px-1" title="Open with default app" style={{ color: 'var(--dim)', cursor: 'pointer' }}>open</button>
                  <button onClick={() => window.electronAPI.filesReveal(projectDir, preview.relPath)} className="text-xs px-1" title="Reveal in Finder" style={{ color: 'var(--dim)', cursor: 'pointer' }}>finder</button>
                </div>
                <div className="flex-1 overflow-auto min-h-0 p-2">
                  {preview.data?.kind === 'text' && (
                    <pre className="text-xs whitespace-pre-wrap break-words" style={{ color: 'var(--fg)', fontFamily: "'SF Mono', monospace", fontSize: 11, lineHeight: 1.5 }}>
                      {preview.data.content}
                      {preview.data.truncated && <span style={{ color: 'var(--dim)' }}>{'\n'}… truncated (512KB shown of {fmtSize(preview.data.size)})</span>}
                    </pre>
                  )}
                  {preview.data?.kind === 'image' && (
                    <img src={preview.data.dataUrl} alt={preview.name} style={{ maxWidth: '100%', borderRadius: 6 }} />
                  )}
                  {preview.data?.kind === 'binary' && <p className="text-xs" style={{ color: 'var(--dim)' }}>Binary file ({fmtSize(preview.data.size)}). Use “open”.</p>}
                  {preview.data?.kind === 'toolarge' && <p className="text-xs" style={{ color: 'var(--dim)' }}>Too large to preview ({fmtSize(preview.data.size)}). Use “open”.</p>}
                  {preview.data?.kind === 'error' && <p className="text-xs" style={{ color: '#F85149' }}>{preview.data.error}</p>}
                </div>
              </div>
            ) : (
              /* Listing mode */
              <div className="flex-1 overflow-y-auto min-h-0">
                {relPath && (
                  <button onClick={goUp} className="w-full text-left px-3 py-1.5 text-xs" style={{ color: 'var(--accent)', cursor: 'pointer' }}>‹ ..</button>
                )}
                {listing?.error && <p className="px-3 py-2 text-xs" style={{ color: '#F85149' }}>{listing.error}</p>}
                {listing?.entries?.map((entry) => (
                  renaming?.entry?.name === entry.name ? (
                    <input
                      key={entry.name}
                      autoFocus
                      value={renaming.value}
                      onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Enter') doRename(); if (e.key === 'Escape') setRenaming(null); }}
                      onBlur={doRename}
                      spellCheck={false}
                      className="w-full text-xs px-3 py-1 outline-none"
                      style={{ backgroundColor: 'var(--surface)', color: 'var(--fg)', border: '1px solid var(--accent)', fontFamily: "'SF Mono', monospace" }}
                    />
                  ) : (
                    <button
                      key={entry.name}
                      onClick={() => openEntry(entry)}
                      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
                      className="w-full flex items-center gap-2 px-3 py-1 text-left"
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--surface)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <span className="shrink-0 text-xs" style={{ opacity: 0.7 }}>{entry.type === 'dir' ? '▸' : '·'}</span>
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--fg)', fontFamily: "'SF Mono', monospace", fontSize: 11 }}>{entry.name}</span>
                      {entry.type === 'file' && <span className="text-xs shrink-0" style={{ color: 'var(--dim)', fontSize: 9 }}>{fmtSize(entry.size)}</span>}
                    </button>
                  )
                ))}
                {listing?.truncated && <p className="px-3 py-1 text-xs" style={{ color: 'var(--dim)', fontSize: 10 }}>listing truncated at 2000 entries</p>}
              </div>
            )}

            {/* Context menu */}
            {contextMenu && (
              <div
                className="fixed z-50 rounded shadow-lg py-1"
                style={{ left: contextMenu.x, top: contextMenu.y, backgroundColor: 'var(--surface)', border: '1px solid var(--border)', minWidth: 160 }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {[
                  ['Open', () => { setContextMenu(null); window.electronAPI.filesOpen(projectDir, joinRel(contextMenu.entry.name)); }],
                  ['Reveal in Finder', () => { setContextMenu(null); window.electronAPI.filesReveal(projectDir, joinRel(contextMenu.entry.name)); }],
                  ['Copy path', async () => {
                    setContextMenu(null);
                    const abs = `${projectDir}/${joinRel(contextMenu.entry.name)}`;
                    try { await navigator.clipboard.writeText(abs); } catch { window.prompt('Copy path:', abs); }
                  }],
                  ['Rename', () => { setContextMenu(null); setRenaming({ entry: contextMenu.entry, value: contextMenu.entry.name }); }],
                  ['Move to Trash', () => doTrash(contextMenu.entry)],
                ].map(([label, fn]) => (
                  <button
                    key={label}
                    onClick={fn}
                    className="w-full text-left px-3 py-1 text-xs"
                    style={{ color: label === 'Move to Trash' ? '#F85149' : 'var(--fg)', cursor: 'pointer' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--border)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
