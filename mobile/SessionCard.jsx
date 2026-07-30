import { timeAgo } from './format';

// Status -> label + which CSS var drives the LED. Colors live in styles.css so
// the whole app stays on one palette.
const STATUS = {
  working: { label: 'working', cls: 'working' },
  needs: { label: 'needs you', cls: 'needs' },
  done: { label: 'done', cls: 'done' },
  idle: { label: 'idle', cls: 'idle' },
};

// One session on the board: a status LED, the tab label, a status + last-active
// subline, and a chevron. The whole card is the tap target.
export default function SessionCard({ term, onOpen }) {
  const s = STATUS[term.status] || STATUS.idle;
  return (
    <button className={`session-card led-${s.cls}`} onClick={() => onOpen(term.id)}>
      <span className="card-led" aria-hidden="true" />
      <span className="card-main">
        <span className="card-title">{term.label || 'terminal'}</span>
        <span className="card-sub">
          <span className="card-status">{s.label}</span>
          {term.lastActivityAt ? <span className="card-time"> · {timeAgo(term.lastActivityAt)}</span> : null}
        </span>
      </span>
      <span className="card-chevron" aria-hidden="true">›</span>
    </button>
  );
}
