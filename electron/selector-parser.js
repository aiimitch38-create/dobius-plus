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
// Group 1 = leading whitespace (for the number-column indent), 2 = cursor,
// 3 = number, 4 = label.
const OPT_RE = /^(\s*)([❯›»▶>*]?)\s*(\d+)[.)]\s+(\S.*?)\s*$/u;
const CURSOR_CHARS = new Set(['❯', '›', '»', '▶', '>']);

// Column where an option line's NUMBER starts. Cursor rows ("❯ 1.") and plain
// rows ("  2.") have different leading whitespace but the digit column aligns,
// so this is the stable indent reference for description lines.
function numberCol(line) {
  const m = line.match(OPT_RE);
  if (!m) return -1;
  return line.indexOf(m[3], m[1].length + m[2].length);
}
function leadingWs(line) {
  const m = line.match(/^\s*/);
  return m ? m[0].length : 0;
}
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

  // Find the LAST block of option lines (scan from the bottom). One blank line
  // inside the block is tolerated, and so are short runs of DESCRIPTION lines
  // indented deeper than the option numbers: AskUserQuestion renders
  //   ❯ 1. Ship public now
  //        Publishes the release immediately...
  //     2. Keep local
  // and the old strictly-contiguous scan broke at the description line, so
  // question popups never parsed on mobile (Sam's v1.0.51 bug 1). The indent
  // requirement keeps unrelated prose (flush-left) from gluing two numbered
  // fragments into one fake selector.
  const MAX_CONT = 4; // max consecutive description lines between options
  let end = -1;
  let start = -1;
  let sawBlank = false;
  let contRun = 0;
  let sawInBlockDesc = false; // any description line BETWEEN options (AskUserQuestion style)
  let belowCol = -1; // number column of the nearest option line BELOW the cursor position
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (OPT_RE.test(lines[i])) {
      if (end === -1) end = i;
      start = i;
      sawBlank = false;
      contRun = 0;
      belowCol = numberCol(lines[i]);
    } else if (end !== -1) {
      const t = lines[i].trim();
      if (t === '' && !sawBlank) { sawBlank = true; continue; }
      if (t !== '' && contRun < MAX_CONT && belowCol >= 0 && leadingWs(lines[i]) > belowCol) {
        contRun += 1;
        sawInBlockDesc = true;
        continue;
      }
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
    const cursor = m[2];
    const num = parseInt(m[3], 10);
    const label = m[4].trim();
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
  // Trailing lines: a description under the LAST option is only legitimate for
  // AskUserQuestion-style blocks (which put one under EVERY option), so gate it
  // on sawInBlockDesc; a plain permission selector followed by indented output
  // (e.g. code in Claude's response) must still read as answered/stale. The
  // desc phase ends at the first blank/caret/hint line, so indented lines that
  // come after chrome are response text, not description. Codex v1.0.51.
  //
  // Accepted residual (Codex, Low): an ANSWERED AskUserQuestion followed by
  // <=3 indented response lines with NO blank/caret/chrome between still reads
  // live, until more output arrives or the rolling tail drops the frame. A
  // description line and an indented response line are textually identical, so
  // shrinking MAX_CONT would instead false-negative real WRAPPED descriptions
  // (bug 1 again); a stale tap merely puts a digit in the input box.
  const endCol = numberCol(lines[end]);
  let trailCont = 0;
  let descPhase = sawInBlockDesc;
  for (const l of lines.slice(end + 1)) {
    const t = l.trim();
    if (t === '') { descPhase = false; continue; }                      // blank
    if (/^[>❯›»▶$#%*.·:\s]+$/.test(t)) { descPhase = false; continue; } // bare caret / punctuation
    if (descPhase && trailCont < MAX_CONT && endCol >= 0 && leadingWs(l) > endCol) { trailCont += 1; continue; }
    // Otherwise allow only SHORT navigation-hint chrome (arrows or hint words).
    // A longer line, or any line without a hint token (e.g. "OK", a response),
    // means the selector was answered and is stale, so return null. Codex.
    if (t.length <= 40 && HINT_RE.test(t)) { descPhase = false; continue; }
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
