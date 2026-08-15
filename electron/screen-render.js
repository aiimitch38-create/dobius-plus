// Render a raw PTY byte stream into the SCREEN a real terminal would show,
// using xterm's own headless emulator (v1.0.62).
//
// Why this exists: the mobile selector popups were parsed by regexing an
// ANSI-stripped rolling buffer. That works for a frame drawn in one pass, but
// Ink repaints INCREMENTALLY: on a multi-question AskUserQuestion, question
// two arrives as cursor-positioned cell updates that never form a complete
// line in a linear strip, so the second question's popup simply never
// appeared on the phone (Sam, 8/14). An emulator replays the same bytes the
// way the terminal did: absolute positioning lands, erase sequences actually
// ERASE (so an answered prompt disappears instead of lingering as "stale"
// text), and reading the grid back gives the true current screen.
//
// Main-process only. One pooled Terminal, reset per call: construction is the
// expensive part, reset is cheap. Callers are the mobile selector paths,
// which run at most a few times per second for one tab.

// @xterm/headless ships CJS with no named ESM exports; default-import and
// destructure (same interop pattern Node and Electron main both honor).
import headless from '@xterm/headless';

const { Terminal } = headless;

// Wider and taller than any real pty this app spawns, so absolute column
// positioning from the CLI's believed width always lands inside the grid and
// a full frame always fits without scrolling rows off mid-frame.
const COLS = 220;
const ROWS = 120;

let pooled = null;

/**
 * @param raw string | Uint8Array of raw PTY output (a rolling-buffer tail)
 * @returns Promise<string[] | null> the ROWS screen lines (right-trimmed),
 *          or null when the emulator failed; callers fall back to the old
 *          strip-and-regex path so a headless bug can never LOSE a popup
 *          that path would have found.
 */
export function renderScreenLines(raw, { timeoutMs = 750 } = {}) {
  return new Promise((resolve) => {
    let term;
    try {
      if (!pooled) {
        pooled = new Terminal({ cols: COLS, rows: ROWS, scrollback: 0, allowProposedApi: true, logLevel: 'off' });
      }
      term = pooled;
      term.reset();
    } catch {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      if (!ok) { resolve(null); return; }
      try {
        const out = [];
        const buf = term.buffer.active;
        for (let i = 0; i < ROWS; i += 1) out.push(buf.getLine(i)?.translateToString(true) ?? '');
        resolve(out);
      } catch {
        resolve(null);
      }
    };
    // A hung write must not wedge the caller; the fallback path takes over.
    const t = setTimeout(() => finish(false), timeoutMs);
    try {
      term.write(raw, () => { clearTimeout(t); finish(true); });
    } catch {
      clearTimeout(t);
      finish(false);
    }
  });
}
