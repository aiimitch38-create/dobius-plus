// Session-preview sanitizing: a pasted image is saved to a temp path that gets
// typed into the terminal, so the sidebar previewed the raw
// clipboard-<ts>.png path instead of a readable prompt (Sam-reported, v1.0.40).
// data-service.js imports electron (via config-manager), so point HOME at a
// throwaway dir before importing, same trick as fresh-session.test.mjs.
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const TMP_HOME = await fs.mkdtemp(path.join(os.tmpdir(), 'dobius-preview-home-'));
process.env.HOME = TMP_HOME;
const { sanitizePreviewText } = await import('../data-service.js');

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)}\n        want=${JSON.stringify(want)}`);
};

// The exact path from Sam's report.
const REAL = '/var/folders/m5/k9m4q6lj06d77q_k84x9hh5w0000gn/T/dobius-clipboard/clipboard-1785250968583.png';

check('path-only paste becomes [image]', sanitizePreviewText(REAL), '[image]');
check('path with text keeps the text',
  sanitizePreviewText(`look at this ${REAL} what is wrong`),
  'look at this [image] what is wrong');
check('leading text then path',
  sanitizePreviewText(`fix ${REAL}`), 'fix [image]');
check('two pasted images',
  sanitizePreviewText(`${REAL} and ${REAL}`), '[image] and [image]');
check('jpg extension', sanitizePreviewText(REAL.replace('.png', '.jpg')), '[image]');
check('normal prompt is untouched',
  sanitizePreviewText('refactor the auth guard and add a test'),
  'refactor the auth guard and add a test');
check('a real file path that is NOT a clipboard image is untouched',
  sanitizePreviewText('open src/components/clipboard-notes.png please'),
  'open src/components/clipboard-notes.png please');
check('empty stays empty', sanitizePreviewText(''), '');
check('collapses the whitespace a stripped path leaves behind',
  sanitizePreviewText(`here:   ${REAL}`), 'here: [image]');

await fs.rm(TMP_HOME, { recursive: true, force: true });
console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
