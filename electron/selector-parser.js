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

const CSI_RE = /^\x1b\[([0-9;?]*)([ -/]*)([@-~])/;

// Linear scanner, not regex passes: Ink lays text out with CURSOR MOTION, not
// spaces. Real AskUserQuestion frames position every word with CHA (CSI n G)
// and rows with CUD (CSI n B), so deleting escapes glued words ("2.Blue",
// "Thecolorblue") and option matching never fired: interactive prompts simply
// never appeared on the phone (Sam's report). The scanner tracks an
// approximate column (escapes don't count) and renders cursor motion as the
// whitespace it visually produces:
//   CSI n C (forward)        -> n spaces
//   CSI n G (column, ahead)  -> pad spaces up to that column
//   CSI n G (column 1)       -> line restart (\r)
//   CSI n G (column, behind) -> single space (word boundary, approx col)
//   CSI n B / E (down)       -> newline, indented back to the current column
// Everything else (SGR colors, erases, OSC/DCS, 2-char escapes) is dropped.
export function stripAnsi(s) {
  const src = String(s == null ? '' : s);
  let out = '';
  let col = 0;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\x1b') {
      const next = src[i + 1];
      if (next === ']') { // OSC ... (BEL or ST terminated)
        const bel = src.indexOf('\x07', i + 2);
        const st = src.indexOf('\x1b\\', i + 2);
        const end = Math.min(bel === -1 ? Infinity : bel + 1, st === -1 ? Infinity : st + 2);
        i = end === Infinity ? src.length : end;
        continue;
      }
      if (next === 'P' || next === 'X' || next === '^' || next === '_') { // DCS/SOS/PM/APC ... ST
        const st = src.indexOf('\x1b\\', i + 2);
        i = st === -1 ? src.length : st + 2;
        continue;
      }
      if (next === '[') {
        const m = CSI_RE.exec(src.slice(i, i + 32));
        if (m) {
          const n = parseInt(m[1].split(';')[0] || '', 10);
          const fin = m[3];
          if (fin === 'C') {
            const k = Math.min(n || 1, 400);
            out += ' '.repeat(k); col += k;
          } else if (fin === 'G') {
            const target = Math.max(1, n || 1) - 1;
            if (target > col) { out += ' '.repeat(Math.min(target - col, 400)); col = target; }
            else if (target === 0 && col > 0) { out += '\r'; col = 0; }
            else if (target < col) { out += ' '; col = target; }
          } else if (fin === 'B' || fin === 'E') {
            out += `\n${' '.repeat(Math.min(fin === 'B' ? col : 0, 400))}`;
            if (fin === 'E') col = 0;
          }
          i += m[0].length;
          continue;
        }
        i += 2; // malformed CSI: drop the ESC[ and continue
        continue;
      }
      i += 2; // 2-char escape
      continue;
    }
    if (ch === '\n' || ch === '\r') { out += ch; col = 0; i += 1; continue; }
    out += ch;
    col += 1;
    i += 1;
  }
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
// A horizontal-rule row (box-drawing dashes). Claude Code 2.1.x draws one
// INSIDE AskUserQuestion blocks (between the answers and "Chat about this")
// and as frame borders, so a rule is layout chrome, never prose.
const RULE_RE = /^\s*[─-╿]{3,}\s*$/;

/**
 * @param {string} rawBuf recent raw terminal output (a screenful+ is enough)
 * @returns {{prompt:string, options:{num:number,label:string}[], selectedIndex:number}|null}
 */
export function parseSelector(rawBuf) {
  if (!rawBuf || typeof rawBuf !== 'string') return null;
  // Treat a bare \r as a line break too: Ink positions rows with lone
  // carriage returns (no \n), so deleting \r used to fuse an option line with
  // its description line ("❯ 1. Red   The color red") and hide the block.
  // A \r RUN and \r+\n collapse to ONE break: Ink ends rows with "\r\r\n",
  // and splitting that into phantom blank lines broke the block scan.
  const lines = stripAnsi(rawBuf).split(/\r*\n|\r+/);

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
      if (RULE_RE.test(lines[i])) continue; // in-block divider (AskUserQuestion 2.1.x)
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
    // Frame border / divider. Accepted residual (Codex, Low): an ANSWERED
    // selector followed by a rule row reads live until the next output line,
    // because a LIVE boxed prompt's bottom border after its footer is the
    // same shape; nulling rules here would break boxed prompts entirely.
    if (RULE_RE.test(l)) { descPhase = false; continue; }
    if (/^[>❯›»▶$#%*.·:\s]+$/.test(t)) { descPhase = false; continue; } // bare caret / punctuation
    if (descPhase && trailCont < MAX_CONT && endCol >= 0 && leadingWs(l) > endCol) { trailCont += 1; continue; }
    // Otherwise allow only SHORT navigation-hint chrome (arrows or hint words).
    // A longer line, or any line without a hint token (e.g. "OK", a response),
    // means the selector was answered and is stale, so return null. Codex.
    // 60, not 40: the real AskUserQuestion footer "Enter to select · ↑/↓ to
    // navigate · Esc to cancel" is 50 chars once cursor-forward spacing is
    // restored, and the old cap read it as prose (popup never appeared).
    if (t.length <= 60 && HINT_RE.test(t)) { descPhase = false; continue; }
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

/**
 * The whimsical gerund Claude Code's spinner shows while working: the
 * "Flibbertigibbeting…" / "Discombobulating…" / "Frolicking…" line. Sam asked
 * for these on the phone board because they are half the fun of watching a
 * session think.
 *
 * No word list: the CLI ships hundreds (its 2.1.227 binary carries a
 * length-prefixed table: "Flambéing", "Fiddle-faddling", "Gallivanting", ...)
 * and it grows per release. Match the LINE SHAPE instead, taken from a REAL
 * captured frame on this machine (do not trust the docs or memory; the first
 * version anchored on "esc to interrupt" being on the same line, and on
 * 2.1.227 it is not, it lives on a separate footer row):
 *
 *     ✳ Proofing… (3s · ↓ 95 tokens)
 *     · Burrowing…
 *
 * So the anchor is the SPINNER GLYPH opening the line (the CLI animates
 * through · ✢ ✳ ✶ ✻ ✽, older builds used *), then the capitalized gerund,
 * then the ellipsis. The glyph is what keeps ordinary prose ending in "ing…"
 * from counting.
 *
 * Verb charset covers the real table: letters (accented: Flambéing),
 * hyphens (Fiddle-faddling), apostrophes, spaces (multi-word entries). The
 * LAST match in the tail wins, because the buffer is a rolling scrollback
 * where earlier repaints (and earlier turns) linger above.
 *
 * @param raw ANSI terminal buffer (tail is enough; caller slices)
 * @returns the gerund ("Flibbertigibbeting") or '' when no spinner is on screen
 */
const SPINNER_LINE_RE = /^\s*[·✢✳✶✻✽*]\s+([A-Z][A-Za-zÀ-ɏ' -]{1,40}ing)(?:…|\.\.\.)/gm;
export function spinnerVerb(raw) {
  if (!raw) return '';
  // Strip first, then window: a repainting TUI is mostly escape bytes, so a
  // raw slice holds almost no text (the claudeTuiPresent lesson, v1.0.56).
  const tail = stripAnsi(String(raw).slice(-65536)).slice(-4096);
  let verb = '';
  SPINNER_LINE_RE.lastIndex = 0;
  for (const m of tail.matchAll(SPINNER_LINE_RE)) verb = m[1];
  return verb.trim();
}
