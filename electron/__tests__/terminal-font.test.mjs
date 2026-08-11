// Terminal font stack building. The fail-safe contract: whatever the user
// types into the custom field, the terminal keeps working, because the stack
// always ends in `monospace` and hostile characters never reach canvas/CSS.
// Run: node ./electron/__tests__/terminal-font.test.mjs
import assert from 'node:assert/strict';
import {
  sanitizeFontFamily, buildTerminalFontFamily, DEFAULT_TERMINAL_STACK, CURATED_TERMINAL_FONTS,
} from '../../src/lib/terminal-font.js';

let pass = 0;
const ok = (n) => { console.log(`PASS  ${n}`); pass += 1; };

// 1. The default: empty/absent setting keeps the exact stack the app has
// always shipped, so upgrading changes nothing for anyone who never touches
// the picker.
assert.equal(buildTerminalFontFamily(''), DEFAULT_TERMINAL_STACK);
assert.equal(buildTerminalFontFamily(undefined), DEFAULT_TERMINAL_STACK);
assert.equal(buildTerminalFontFamily(null), DEFAULT_TERMINAL_STACK);
assert.ok(DEFAULT_TERMINAL_STACK.endsWith('monospace'));
ok('no setting means the unchanged default stack');

// 2. A chosen face is prepended, quoted, with the WHOLE default stack behind
// it: a font missing on this machine falls through to exactly the old look.
assert.equal(buildTerminalFontFamily('Monaco'), `'Monaco', ${DEFAULT_TERMINAL_STACK}`);
assert.equal(buildTerminalFontFamily('PT Mono'), `'PT Mono', ${DEFAULT_TERMINAL_STACK}`);
ok('a chosen font sits in front of the full fallback chain');

// 3. Hostile input never reaches font-family syntax. Quotes, braces,
// semicolons, escapes: all stripped, and what remains still ends in
// monospace.
for (const evil of [
  "Menlo'; background: url(x)", 'a"b', 'x;{}\\', "'; } * { color: red",
  '<script>', 'font\u0000null',
]) {
  const built = buildTerminalFontFamily(evil);
  assert.ok(!/[;{}"\\<>\u0000]/.test(built), `unsafe char survived: ${built}`);
  assert.ok(built.endsWith('monospace'));
}
// Input that sanitizes to NOTHING is the default, not an empty quoted name.
assert.equal(buildTerminalFontFamily('!!!;;;'), DEFAULT_TERMINAL_STACK);
ok('hostile custom input degrades to a working terminal');

// 4. Sanitizer shape: keeps real font names intact, collapses junk spacing,
// caps runaway length.
assert.equal(sanitizeFontFamily('  JetBrains   Mono  '), 'JetBrains Mono');
assert.equal(sanitizeFontFamily('Andale Mono'), 'Andale Mono');
assert.equal(sanitizeFontFamily('Comic Sans MS'), 'Comic Sans MS');
assert.equal(sanitizeFontFamily('A'.repeat(200)).length, 60);
assert.equal(sanitizeFontFamily(42), '');
ok('sanitizer keeps real names and bounds everything else');

// 5. The curated list: every entry must round-trip the builder unchanged
// (ids ARE font names), and the default entry is the empty id.
for (const f of CURATED_TERMINAL_FONTS) {
  assert.equal(sanitizeFontFamily(f.id), f.id, `curated id not clean: ${f.id}`);
}
assert.equal(CURATED_TERMINAL_FONTS[0].id, '');
ok('curated entries are themselves valid font names');

console.log(`terminal-font: ${pass} groups pass`);
