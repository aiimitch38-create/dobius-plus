import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../../store/store';
import { STAGES, STAGE_META, LANE_COLORS, groupByStage } from '../../../lib/stages';

/**
 * KanbanView — the "Pipeline" board. Renders the 7 pipeline stages as columns
 * (intake..done) plus a distinct Blocked rail, with each task as a draggable
 * card that physically slides between columns (Framer layoutId) when its stage
 * changes — whether moved by a human (drag) or by the system (dobius-stage CLI,
 * arriving via the tasks:updated broadcast).
 *
 * Source of truth is the Zustand store.
 */

// Columns are the 7 flow stages in order; Blocked is rendered separately.
const FLOW_STAGES = STAGES.filter((s) => s !== 'blocked');

function relativeTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function KanbanView() {
  const currentProjectPath = useStore((s) => s.currentProjectPath);
  const liveTasks          = useStore((s) => s.tasks);
  const loadTasks          = useStore((s) => s.loadTasks);
  const storeSetStage      = useStore((s) => s.setTaskStage);
  const storeBlock         = useStore((s) => s.blockTask);
  const storeUnblock       = useStore((s) => s.unblockTask);
  const setActiveView      = useStore((s) => s.setActiveView);
  const setActiveTab       = useStore((s) => s.setActiveTab);

  const [error, setError] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const draggedTask = useRef(null);
  const errorTimer = useRef(null);

  const tasks = liveTasks || [];

  // Load + subscribe to live updates so system-driven stage changes animate in.
  useEffect(() => {
    if (!currentProjectPath) return;
    loadTasks(currentProjectPath);
    const off = window.electronAPI?.onTasksUpdated?.(() => loadTasks(currentProjectPath));
    return () => { if (typeof off === 'function') off(); };
  }, [currentProjectPath, loadTasks]);

  // A card dragged off the window and released outside any column never
  // fires that column's dragleave/drop, leaving its highlight stuck lit.
  useEffect(() => {
    const clear = () => setDragOver(null);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, []);

  useEffect(() => () => clearTimeout(errorTimer.current), []);

  const flash = useCallback((msg) => {
    setError(msg);
    clearTimeout(errorTimer.current);
    errorTimer.current = setTimeout(() => setError(''), 3500);
  }, []);

  const grouped = useMemo(() => groupByStage(tasks), [tasks]);

  // Apply a stage change. Returns nothing; failures flash an inline error and
  // the card stays put (the store never changed its stage), so it snaps back.
  const moveTask = useCallback(async (task, toStage) => {
    if (!task || toStage === task.stage) return;

    // Into Blocked: capture a reason.
    if (toStage === 'blocked') {
      const reason = window.prompt(`Block "${task.title}" — reason?`);
      if (reason == null) return; // cancelled
      const res = storeBlock ? await storeBlock(currentProjectPath, task.id, reason) : { ok: false, error: 'blockTask unavailable' };
      if (res && res.ok === false) flash(res.error || 'Could not block');
      return;
    }

    // Out of Blocked: unblock (store restores it to where it was blocked from).
    if (task.stage === 'blocked') {
      const res = storeUnblock ? await storeUnblock(currentProjectPath, task.id) : { ok: false, error: 'unblockTask unavailable' };
      if (res && res.ok === false) flash(res.error || 'Could not unblock');
      return;
    }

    // Normal flow move (human actor).
    const res = storeSetStage
      ? await storeSetStage(currentProjectPath, task.id, toStage, { actor: 'human' })
      : { ok: false, error: 'setTaskStage unavailable' };
    if (res && res.ok === false) flash(res.error || `Can't move to ${STAGE_META[toStage]?.label || toStage}`);
  }, [currentProjectPath, storeSetStage, storeBlock, storeUnblock, flash]);

  const onDrop = useCallback((toStage) => {
    setDragOver(null);
    const task = draggedTask.current;
    draggedTask.current = null;
    setDragId(null);
    if (task) moveTask(task, toStage);
  }, [moveTask]);

  const focusTask = useCallback((task) => {
    if (!task?.tabId) return; // no linked terminal — no-op
    setActiveView?.('terminal');
    setActiveTab?.(task.tabId);
  }, [setActiveView, setActiveTab]);

  return (
    <div className="h-full flex flex-col">
      {/* Inline error banner (illegal move, etc.) */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="mx-4 mt-3 px-3 py-1.5 rounded text-xs shrink-0"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--danger)', color: 'var(--danger)', fontFamily: "'SF Mono', monospace" }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <LayoutGroupBoard>
          <div className="flex gap-3 h-full items-start" style={{ minWidth: 'min-content' }}>
            {FLOW_STAGES.map((stage) => (
              <Column
                key={stage} stage={stage} tasks={grouped[stage] || []}
                dragOver={dragOver === stage} onDragOverCol={() => setDragOver(stage)} onDragLeaveCol={() => setDragOver((d) => d === stage ? null : d)}
                onDrop={() => onDrop(stage)} dragId={dragId} setDragId={setDragId} draggedTask={draggedTask} onCardClick={focusTask}
              />
            ))}
            {/* Blocked rail — rendered distinctly */}
            <Column
              key="blocked" stage="blocked" tasks={grouped.blocked || []} blockedRail
              dragOver={dragOver === 'blocked'} onDragOverCol={() => setDragOver('blocked')} onDragLeaveCol={() => setDragOver((d) => d === 'blocked' ? null : d)}
              onDrop={() => onDrop('blocked')} dragId={dragId} setDragId={setDragId} draggedTask={draggedTask} onCardClick={focusTask}
            />
          </div>
        </LayoutGroupBoard>
      </div>
    </div>
  );
}

// Shared layout context so cards animate position when they change column.
function LayoutGroupBoard({ children }) {
  return <AnimatePresence>{children}</AnimatePresence>;
}

function Column({ stage, tasks, blockedRail, dragOver, onDragOverCol, onDragLeaveCol, onDrop, dragId, setDragId, draggedTask, onCardClick }) {
  const accent = blockedRail ? 'var(--danger)' : 'var(--border)';
  return (
    <div
      className="flex flex-col rounded-lg shrink-0"
      style={{
        width: 248, maxHeight: '100%',
        backgroundColor: blockedRail ? 'color-mix(in srgb, var(--danger) 8%, var(--surface))' : 'var(--surface)',
        border: `1px solid ${dragOver ? 'var(--accent)' : accent}`,
        transition: 'border-color 120ms',
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOverCol(); }}
      onDragLeave={onDragLeaveCol}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: `1px solid ${accent}` }}
      >
        <span className="text-xs font-medium" style={{ color: blockedRail ? 'var(--danger)' : 'var(--fg)' }}>
          {STAGE_META[stage]?.label || stage}
        </span>
        <span className="text-xs" style={{ color: 'var(--dim)', fontFamily: "'SF Mono', monospace", fontSize: 10 }}>
          {tasks.length}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        <AnimatePresence mode="popLayout">
          {tasks.map((task) => (
            <Card
              key={task.id} task={task} dragging={dragId === task.id}
              onDragStart={() => { draggedTask.current = task; setDragId(task.id); }}
              onDragEnd={() => { draggedTask.current = null; setDragId(null); }}
              onClick={() => onCardClick(task)}
            />
          ))}
        </AnimatePresence>
        {tasks.length === 0 && (
          <div className="text-xs text-center py-6" style={{ color: 'var(--dim)', opacity: 0.5 }}>—</div>
        )}
      </div>
    </div>
  );
}

function Card({ task, dragging, onDragStart, onDragEnd, onClick }) {
  const laneColor = LANE_COLORS[task.lane] || 'var(--border)';
  const lastEvent = task.events?.[task.events.length - 1];
  const lastRun = task.runs?.[task.runs.length - 1];
  const runPassed = lastRun ? (lastRun.pass ?? lastRun.ok ?? lastRun.status === 'pass') : null;

  return (
    <motion.div
      layout
      layoutId={task.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: dragging ? 0.4 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className="relative rounded-md cursor-pointer select-none"
      style={{
        backgroundColor: 'var(--bg)',
        border: '1px solid var(--border)',
        padding: '8px 10px 8px 12px',
        overflow: 'hidden',
      }}
    >
      {/* Lane stripe */}
      <span className="absolute left-0 top-0 bottom-0" style={{ width: 3, backgroundColor: laneColor }} />

      <div className="text-xs leading-snug mb-1.5" style={{ color: 'var(--fg)' }}>{task.title}</div>

      <div className="flex items-center gap-1.5 flex-wrap" style={{ fontSize: 9, fontFamily: "'SF Mono', monospace" }}>
        {task.source && (
          <span className="px-1 rounded" style={{ color: 'var(--dim)', border: '1px solid var(--border)' }}>{task.source}</span>
        )}
        {task.assignee && (
          <span style={{ color: 'var(--dim)' }}>@{task.assignee}</span>
        )}
        {task.dueOn && (
          <span style={{ color: 'var(--warning)' }}>due {task.dueOn}</span>
        )}
        {runPassed != null && (
          <span className="inline-flex items-center gap-1" title={runPassed ? 'last run passed' : 'last run failed'}>
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: runPassed ? 'var(--success, #3fb950)' : 'var(--danger)' }} />
          </span>
        )}
      </div>

      {lastEvent && (
        <div className="mt-1.5 truncate" style={{ fontSize: 9, color: 'var(--dim)', fontFamily: "'SF Mono', monospace" }}>
          {lastEvent.kind}{lastEvent.at ? ` · ${relativeTime(lastEvent.at)}` : ''}
        </div>
      )}
    </motion.div>
  );
}
