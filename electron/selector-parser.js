// Parse a Claude Code interactive selection prompt out of a terminal's recent
// RAW output (ANSI included) so the mobile Chat view can surface the options as
// tappable buttons. Pure (no I/O), mirroring terminal-status.js.
//
// Claude renders selection prompts as a numbered list with a cursor marker (❯)
// on the highlighted row, e.g.:
//   Do you want to proceed?
//   ❯ 1. Yes
//     2. Yes, and don't ask again this session
//     3. No, and tell Claude what to do differently
//
// Safety: the mobile client sends the ABSOLUTE option number the user tapped
// (matching the visible label), never relative arrow navigation, so a parse
// error in the cursor position can never select a DIFFERENT option than the
// label. selectedIndex is returned for display only.

const ANSI_PATTERNS = [
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, // OSC ... (BEL or ST terminated)
  /\x1b[PX^_][^\x1b]*\x1b\\/g,          // DCS/PM/APC/SOS ... ST
  /\x1b\[[0-9;?]*[ -/]*[@-~]/g,         // CSI (colors, cursor moves, etc.)
  /\x1b[@-Z\\-_]/g,                     // 2-char escapes
];

export function stripAnsi(s) {
  let out = String(s == null ? '' : s);
  for (const re of ANSI_PATTERNS) out = out.replace(re, '');
  return out;
}

// optional cursor marker, a number, `.`/`)`, then a non-empty label.
const OPT_RE = /^\s*([❯›»▶>*]?)\s*(\d+)[.)]\s+(\S.*?)\s*$/u;
const CURSOR_CHARS = new Set(['❯', '›', '»', '▶', '>']);
// Trailing lines allowed after the options (selector navigation chrome, not
// prose): arrow glyphs or common hint words.
const HINT_RE = /[↑↓←→]|\b(enter|esc|escape|select|selection|confirm|cancel|navigate|arrows?|space|tab|toggle|use|choose|press|return|move)\b/i;

/**
 * @param {string} rawBuf recent raw terminal output (a screenful+ is enough)
 * @returns {{prompt:string, options:{num:number,label:string}[], selectedIndex:number}|null}
 */
export function parseSelector(rawBuf) {
  if (!rawBuf || typeof rawBuf !== 'string') return null;
  const lines = stripAnsi(rawBuf).replace(/\r/g, '').split('\n');

  // Find the LAST contiguous block of option lines (scan from the bottom). One
  // blank line inside the block is tolerated; anything else ends the block.
  let end = -1;
  let start = -1;
  let sawBlank = false;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (OPT_RE.test(lines[i])) {
      if (end === -1) end = i;
      start = i;
      sawBlank = false;
    } else if (end !== -1) {
      if (lines[i].trim() === '' && !sawBlank) { sawBlank = true; continue; }
      break;
    }
  }
  if (end === -1) return null;

  const options = [];
  let selectedIndex = -1;
  const seenNums = new Set();
  for (let i = start; i <= end; i += 1) {
    const m = lines[i].match(OPT_RE);
    if (!m) continue;
    const cursor = m[1];
    const num = parseInt(m[2], 10);
    const label = m[3].trim();
    if (seenNums.has(num)) continue; // ignore accidental duplicate numbers
    seenNums.add(num);
    if (cursor && CURSOR_CHARS.has(cursor)) selectedIndex = options.length;
    options.push({ num, label });
  }
  if (options.length < 2) return null; // need at least two choices to be a selector

  // REQUIRE a cursor marker on one option. A real Claude TUI selector always
  // draws the ❯ pointer on the active row; a numbered list in Claude's PROSE
  // ("here are the options: 1. ... 2. ...") never does. Without this, prose
  // lists would render fake tappable buttons that inject a stray digit. A
  // selector rendered with inverse-video instead of ❯ would be missed, but a
  // false negative is safe (the user just uses the Term fallback). Codex.
  if (selectedIndex === -1) return null;

  // A LIVE selector is the last interactive element on screen. After the options
  // there may be short navigation-hint chrome ("↑/↓ select, enter to confirm")
  // or a bare prompt caret, but NOT prose: the PTY buffer is append-only, so
  // once a selector is ANSWERED Claude's response text lands after it. Reject if
  // any trailing line looks like prose rather than hint chrome, so an
  // already-answered selector isn't shown as live. Codex.
  for (const l of lines.slice(end + 1)) {
    const t = l.trim();
    if (t === '') continue;                        // blank
    if (/^[>❯›»▶$#%*.·:\s]+$/.test(t)) continue;   // a bare prompt caret / punctuation
    // Otherwise allow only SHORT navigation-hint chrome (arrows or hint words).
    // A longer line, or any line without a hint token (e.g. "OK", a response),
    // means the selector was answered and is stale, so return null. Codex.
    if (t.length <= 40 && HINT_RE.test(t)) continue;
    return null;
  }

  // The prompt/question is the nearest non-empty line above the block.
  let prompt = '';
  for (let i = start - 1; i >= 0; i -= 1) {
    const t = lines[i].trim();
    if (t) { prompt = t; break; }
  }
  return { prompt, options, selectedIndex };
}
