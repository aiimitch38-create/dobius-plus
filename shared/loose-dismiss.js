// "Not important" for a loose end, shared by the desktop tab and the phone.
//
// RENDERER-ONLY. Both vite builds inline this, so it ships inside dist/ and
// dist-mobile/. `shared/` is NOT in electron-builder's files globs, so a main
// process module (anything under electron/) must not import it: that resolves
// in dev and vanishes in the packaged app.
//
// Pure and framework-free so both bundles import the SAME rule. The first
// version of this lived twice, keyed on sessionId alone, and was wrong in both
// places the same way (Codex, High): dismissing session S hid it forever, so
// if you later resumed S, did an hour of work, and abandoned it again, the
// genuinely NEW abandoned work stayed invisible on that device. A transcript
// is long-lived and gets picked up and dropped repeatedly, so the session id
// is not the thing being dismissed.
//
// What you actually dismiss is a session AS IT STOOD. So a dismissal records
// the activity time it was made at, and any later activity brings the item
// back. The bias is deliberate: showing something twice costs a glance,
// hiding real work costs the work.

// Dismissals are per device (localStorage) and the phone could not share the
// desktop's anyway: the PWA is served from the Tailscale host, a different
// origin. Bounded so the list cannot grow without limit across years.
const MAX_DISMISSALS = 200;

/**
 * Parse the stored value into { [sessionId]: dismissedAtActivityMs }.
 * Anything unrecognised yields {}: an unreadable dismissal list must fail
 * toward SHOWING loose ends, never toward hiding them.
 *
 * A bare array is the pre-stamp format. It is dropped rather than migrated,
 * which surfaces those items once more. Migrating would mean inventing a
 * stamp, and every plausible invented value risks hiding real work forever,
 * which is the exact bug this replaced.
 */
export function parseDismissed(raw) {
  let v;
  try { v = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return {}; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [id, ts] of Object.entries(v)) {
    if (typeof id === 'string' && typeof ts === 'number' && Number.isFinite(ts)) out[id] = ts;
  }
  return out;
}

/**
 * Hidden only while the session has not moved since you dismissed it.
 *
 * ACCEPTED (Codex, Medium): if a transcript's mtime ever went BACKWARDS past
 * the stamp while gaining new content, the item would stay hidden. That needs
 * the file to be rewritten with an older mtime (a restore, an rsync -t from an
 * older copy) or the system clock to jump back mid-write. Any ordinary append
 * moves mtime forward, so the realistic version of a backwards mtime carries
 * no new content and hiding is correct. Not worth a second signal.
 */
export function isDismissed(item, dismissed) {
  const at = (dismissed || {})[item?.sessionId];
  if (!Number.isFinite(at)) return false;
  // Missing lastActivityAt means we cannot prove the session moved, so honour
  // the dismissal rather than nagging.
  const last = Number.isFinite(item?.lastActivityAt) ? item.lastActivityAt : -Infinity;
  return last <= at;
}

/** The loose ends worth showing right now. */
export function visibleLooseEnds(items, dismissed) {
  return (items || []).filter((i) => i && !isDismissed(i, dismissed));
}

/**
 * Record a dismissal, returning a NEW object (callers hold it in React state).
 * Stamped with the item's own activity time, not the wall clock: the stamp has
 * to be comparable to the lastActivityAt of a future scan.
 */
export function withDismissal(dismissed, item) {
  if (!item?.sessionId) return dismissed || {};
  const next = { ...(dismissed || {}) };
  // Number.isFinite, not typeof: NaN is a number, and a NaN stamp compares
  // false against everything, so the row would refuse to hide at all.
  next[item.sessionId] = Number.isFinite(item.lastActivityAt) ? item.lastActivityAt : Date.now();
  const ids = Object.keys(next);
  if (ids.length > MAX_DISMISSALS) {
    // Drop the least-recently-active dismissals: those sessions have long since
    // aged out of the 30-day scan window and will never be offered again.
    ids.sort((a, b) => next[a] - next[b]);
    for (const id of ids.slice(0, ids.length - MAX_DISMISSALS)) delete next[id];
  }
  return next;
}
