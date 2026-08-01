// modelLabel(): friendly Claude model name from a raw id, both naming orders.
import { modelLabel } from '../../src/lib/model-label.js';

let pass = 0, fail = 0;
const check = (label, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`        got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
};

// New naming (family then version)
check('opus 4.8', modelLabel('claude-opus-4-8'), 'Opus 4.8');
check('fable 5', modelLabel('claude-fable-5'), 'Fable 5');
check('opus 5', modelLabel('claude-opus-5'), 'Opus 5');
check('sonnet 5', modelLabel('claude-sonnet-5'), 'Sonnet 5');
check('haiku 4.5 w/ date', modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
check('sonnet 4.5 w/ date', modelLabel('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
// Old naming (version then family) - Codex caught this class
check('old sonnet 3.5', modelLabel('claude-3-5-sonnet-20241022'), 'Sonnet 3.5');
check('old opus 3', modelLabel('claude-3-opus-20240229'), 'Opus 3');
check('old haiku 3', modelLabel('claude-3-haiku-20240307'), 'Haiku 3');
// Fallbacks: non-Claude / unknown -> raw id, so nothing is ever mislabeled
check('non-claude proxy -> raw', modelLabel('my-sonnet-proxy'), 'my-sonnet-proxy');
check('gpt -> raw', modelLabel('gpt-4'), 'gpt-4');
check('claude unknown family -> raw', modelLabel('claude-newfam-1'), 'claude-newfam-1');
check('empty -> empty', modelLabel(''), '');
check('null -> empty', modelLabel(null), '');
check('number -> empty', modelLabel(42), '');

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
