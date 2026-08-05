// Selector parser (mobile Chat selector buttons). Verifies it extracts the
// trailing numbered-option block + cursor from raw ANSI terminal output.
import { parseSelector, stripAnsi } from '../selector-parser.js';

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// 1. Classic permission prompt with ANSI color + cursor on option 1.
const perm =
  'Some context above\n' +
  '\x1b[1mDo you want to proceed?\x1b[0m\n' +
  '\x1b[36m❯ 1. Yes\x1b[0m\n' +
  "  2. Yes, and don't ask again this session\n" +
  '  3. No, and tell Claude what to do differently\n';
check('permission prompt parses 3 opts', parseSelector(perm), {
  prompt: 'Do you want to proceed?',
  options: [
    { num: 1, label: 'Yes' },
    { num: 2, label: "Yes, and don't ask again this session" },
    { num: 3, label: 'No, and tell Claude what to do differently' },
  ],
  selectedIndex: 0,
});

// 2. Cursor on option 2 -> selectedIndex 1.
const sel2 = 'Pick one\n  1. Alpha\n❯ 2. Beta\n  3. Gamma\n';
check('cursor on 2', parseSelector(sel2)?.selectedIndex, 1);

// 3. No selector present -> null.
check('plain text -> null', parseSelector('just some\noutput here\nno options\n'), null);

// 4. Single option is not a selector.
check('single option -> null', parseSelector('Q\n❯ 1. Only\n'), null);

// 5. Trailing blank line after the block is tolerated.
const withTrailer = 'Choose a plan\n❯ 1. MVP first\n  2. Risk first\n\n';
check('trailing blank tolerated', parseSelector(withTrailer)?.options?.length, 2);

// 6. `)` numbering + `>` cursor.
const paren = 'Which?\n> 1) Keep\n  2) Discard\n';
check('paren style + > cursor', parseSelector(paren), {
  prompt: 'Which?',
  options: [{ num: 1, label: 'Keep' }, { num: 2, label: 'Discard' }],
  selectedIndex: 0,
});

// 7. The LAST block wins (ignore an earlier stray numbered line).
const twoBlocks =
  '1. old list item that is prose\n' +
  'some unrelated line\n' +
  'Real question?\n' +
  '❯ 1. First\n' +
  '  2. Second\n';
check('last block wins', parseSelector(twoBlocks)?.prompt, 'Real question?');

// 8. stripAnsi removes CSI + OSC without eating text.
check('stripAnsi keeps text', stripAnsi('\x1b[31mred\x1b[0m \x1b]0;title\x07plain'), 'red plain');

// 9. Non-string input -> null (defensive).
check('null input -> null', parseSelector(null), null);

// 10. No cursor marker at all -> NOT a real selector (prose list) -> null.
check('no cursor -> null', parseSelector('Q\n  1. A\n  2. B\n'), null);

// 11. A short footer hint after the block is tolerated (still a live selector).
const withFooter =
  'Proceed?\n❯ 1. Yes\n  2. No\n\n  Use up/down to select, enter to confirm\n';
check('footer hint tolerated', parseSelector(withFooter)?.options?.length, 2);

// 12. STALE selector: even a SHORT response after the block -> null (Codex).
const staleShort =
  'Proceed?\n❯ 1. Yes\n  2. No\nGreat, proceeding now.\n> \n';
check('stale w/ short response -> null', parseSelector(staleShort), null);

// 13. STALE selector: long response after the block -> null.
const staleLong =
  'Proceed?\n❯ 1. Yes\n  2. No\n' +
  'Great, proceeding now.\nReading files.\nRan the build.\nRunning tests.\n';
check('stale w/ long response -> null', parseSelector(staleLong), null);

// 14. PROSE numbered list in Claude's output (no cursor, then a caret) -> null (Codex).
const prose =
  'Claude says:\nHere are the options:\n  1. Refactor parser\n  2. Add tests\n> \n';
check('prose numbered list -> null', parseSelector(prose), null);

// 15. Real live selector with a trailing bare caret only -> still parses.
check('trailing caret tolerated', parseSelector('Proceed?\n❯ 1. Yes\n  2. No\n> \n')?.options?.length, 2);

// 16. Short non-hint response after the block ("OK") -> stale -> null (Codex).
check('short non-hint trailer -> null', parseSelector('Proceed?\n❯ 1. Yes\n  2. No\nOK\n'), null);

// 17. Long line containing a hint word is response prose, not chrome -> null.
const longHint =
  'Proceed?\n❯ 1. Yes\n  2. No\nLet me select the right approach and refactor everything now.\n';
check('long hint-word line -> null', parseSelector(longHint), null);

// 18. AskUserQuestion shape: description lines INDENTED under each option
// (including the last one). The old contiguous scan broke on these, so
// question popups never parsed on mobile (v1.0.51 bug 1).
const askUser =
  'Which polish items should I do?\n' +
  '❯ 1. Config diet + housekeeping\n' +
  '     The 11MB config.json shrink with migration.\n' +
  '  2. Release autopilot script\n' +
  '     One-command release.sh wrapping build and sign.\n' +
  '  3. Keep local for now\n' +
  '     Stays committed on the feature branch.\n';
check('AskUserQuestion w/ descriptions parses', parseSelector(askUser), {
  prompt: 'Which polish items should I do?',
  options: [
    { num: 1, label: 'Config diet + housekeeping' },
    { num: 2, label: 'Release autopilot script' },
    { num: 3, label: 'Keep local for now' },
  ],
  selectedIndex: 0,
});

// 19. Descriptions + nav hint chrome after the last option -> still parses.
const askUserHint = askUser + '  ↑/↓ to select · enter to confirm\n';
check('descriptions + hint chrome parses', parseSelector(askUserHint)?.options?.length, 3);

// 20. ANSWERED AskUserQuestion: flush-left response prose after the block -> null.
const askUserStale = askUser + 'Great choice, starting with the config diet.\n';
check('answered AskUserQuestion -> null', parseSelector(askUserStale), null);

// 21. Flush-left prose BETWEEN two numbered fragments does NOT glue them into
// one selector (indent rule): the lower fragment alone lacks a cursor -> null.
const glued =
  'Steps:\n  1. First do this\nThen a whole paragraph of explanation text.\n  2. Second thing\n> \n';
check('flush-left prose does not glue blocks', parseSelector(glued), null);

// 22. Deep-indented continuation cap: >4 description lines between options ends
// the block, leaving a single option below -> null (bounded, not greedy).
const tooManyCont =
  'Q?\n  1. Alpha\n     d1\n     d2\n     d3\n     d4\n     d5\n❯ 2. Beta\n';
check('continuation cap bounds the block', parseSelector(tooManyCont), null);

// 23. STALE plain selector answered from desktop, followed only by INDENTED
// response lines (code): must be null. Codex found the first continuation rule
// treated these as a trailing description; the sawInBlockDesc gate fixes it.
const staleIndented =
  'Proceed?\n❯ 1. Yes\n  2. No\n    const ok = true;\n    return ok;\n> \n';
check('stale selector + indented code -> null', parseSelector(staleIndented), null);

// 24. Indented lines AFTER hint chrome are response text, not description,
// even for an AskUserQuestion-style block (desc phase ends at chrome).
const descThenChromeThenCode =
  'Q?\n❯ 1. A\n     desc a\n  2. B\n     desc b\n  ↑/↓ select\n     indented response\n';
check('indented after chrome -> null', parseSelector(descThenChromeThenCode), null);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
