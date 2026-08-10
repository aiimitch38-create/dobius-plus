// Loose ends: work started and never finished.
// Built from a read-only analysis of this Mac's real ~/.claude history, which
// corrected the obvious guess: ZERO of 102 substantive sessions in 21 days
// ended with Claude asking an unanswered question, but 15 died mid-flight
// (explicit interrupt, or a turn cut off during tool use), some 12-20 days
// stale. So the detector targets abandonment, not "waiting on an answer".
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/loose-ends.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-letest-'));
process.env.DOBIUS_TEST_USERDATA = userData;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-lehome-'));
process.env.HOME = home;

// A real project path under HOME: the dir decoder only reconstructs paths it
// can verify on disk beneath the home directory, which is where every real
// project lives.
const PROJ = path.join(home, 'Projects (Code)', 'loose-end-project');
fs.mkdirSync(PROJ, { recursive: true });
const dir = path.join(home, '.claude', 'projects', PROJ.replace(/[^a-zA-Z0-9.-]/g, '-'));
fs.mkdirSync(dir, { recursive: true });

// A source the user hid (Sessions > Hide). 84% of the real transcript store on
// this Mac is headless noise from another app, so the filter has to work or
// every derived feature learns from garbage. Written BEFORE config-manager is
// imported, because it caches config at module load.
const HIDDEN = path.join(home, 'Projects (Code)', 'hidden-noise');
fs.mkdirSync(HIDDEN, { recursive: true });
const hiddenDir = path.join(home, '.claude', 'projects', HIDDEN.replace(/[^a-zA-Z0-9.-]/g, '-'));
fs.mkdirSync(hiddenDir, { recursive: true });
fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  settings: { hiddenSessionPaths: [HIDDEN] },
}));

const { classifySessionEnding, findLooseEnds } = await import('../data-service.js');
let pass = 0;
const ok = (n) => { console.log(`PASS  ${n}`); pass += 1; };

const user = (text) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } });
const asst = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'out' }] } });

// --- classifier ------------------------------------------------------------
assert.equal(classifySessionEnding([user('hi'), asst('done, shipped it.')]), 'delivered');
ok('a finished answer is NOT a loose end');

assert.equal(classifySessionEnding([user('go'), asst('working'), toolUse()]), 'mid-tool');
ok('cut off during a tool call is a loose end');

assert.equal(classifySessionEnding([user('go'), toolUse(), toolResult()]), 'mid-tool');
ok('tool answered but Claude never replied is a loose end');

assert.equal(classifySessionEnding([asst('starting'), user('[Request interrupted by user for tool use]')]), 'interrupted');
ok('explicit interrupt marker is a loose end');

// Meta rows (queue ops, summaries, hooks) must not decide the ending: the
// first version of this classified 104 of 121 sessions as "ends with
// last-prompt" because it read the final ENTRY rather than the final TURN.
assert.equal(classifySessionEnding([
  user('go'), asst('all set.'),
  { type: 'last-prompt', content: 'go' }, { type: 'system', subtype: 'hook' },
]), 'delivered');
ok('meta entries do not mask the real ending');

assert.equal(classifySessionEnding([]), 'unknown');
assert.equal(classifySessionEnding([{ type: 'system' }]), 'unknown');
ok('no conversation yields unknown');

// --- scanner ---------------------------------------------------------------
const write = (sid, entries, ageMinutes, padTo = 30_000) => {
  const f = path.join(dir, `${sid}.jsonl`);
  let body = entries.map((e) => JSON.stringify(e)).join('\n');
  // Pad so it clears minBytes, keeping the closing turns at the tail where the
  // scanner reads.
  if (body.length < padTo) {
    const filler = `${JSON.stringify({ type: 'system', pad: 'x'.repeat(400) })}\n`.repeat(Math.ceil(padTo / 420));
    body = filler + body;
  }
  fs.writeFileSync(f, body);
  const t = new Date(Date.now() - ageMinutes * 60_000);
  fs.utimesSync(f, t, t);
};

write('abandoned-old', [user('do the thing'), asst('on it, running the build:'), toolUse()], 60 * 24 * 3);
write('finished', [user('do it'), asst('done, all green.')], 60 * 24 * 2);
write('interrupted-one', [asst('let me check'), user('[Request interrupted by user]')], 60 * 5);
write('still-live', [user('go'), asst('working:'), toolUse()], 2); // 2 minutes ago
write('tiny', [user('hi'), asst('hey'), toolUse()], 60 * 24, 100); // under minBytes

const found = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
const ids = found.map((f) => f.sessionId).sort();
assert.deepEqual(ids, ['abandoned-old', 'interrupted-one'], `got ${JSON.stringify(ids)}`);
ok('finds only genuinely abandoned sessions');

// The live-work false positive: a session touched moments ago is IN PLAY, not
// abandoned. Without this the scanner reported the user's own active session.
assert.ok(!ids.includes('still-live'), 'a session touched 2 minutes ago is not a loose end');
ok('active work is excluded by the idle threshold');

// Callers that know which sessions are attached to a live Claude can exclude
// them outright, regardless of age.
const excluded = await findLooseEnds({ maxAgeDays: 30, excludeSessionIds: ['abandoned-old'] });
assert.deepEqual(excluded.map((f) => f.sessionId), ['interrupted-one']);
ok('caller-supplied live sessions are excluded');

// Newest first, with the fields the UI needs to make a thread recognisable.
const top = found[0];
assert.equal(top.sessionId, 'interrupted-one');
assert.equal(top.projectPath, PROJ);
assert.equal(top.projectName, 'loose-end-project');
assert.ok(top.ageHours >= 4 && top.ageHours <= 6, `ageHours ${top.ageHours}`);
assert.equal(top.snippet, 'let me check');
assert.ok(typeof top.sizeMB === 'number');
ok('newest first, with project, age and a recognisable snippet');

// The hidden source contributes an abandoned session that must NOT appear.
const hf = path.join(hiddenDir, 'noise-session.jsonl');
fs.writeFileSync(hf, `${JSON.stringify({ type: 'system', pad: 'x'.repeat(400) })}\n`.repeat(80)
  + [user('go'), asst('noise:'), toolUse()].map((e) => JSON.stringify(e)).join('\n'));
const ht = new Date(Date.now() - 60 * 60 * 24 * 1000);
fs.utimesSync(hf, ht, ht);
const afterHidden = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
assert.ok(!afterHidden.some((f) => f.sessionId === 'noise-session'), 'hidden source leaked in');
assert.deepEqual(afterHidden.map((f) => f.sessionId).sort(), ['abandoned-old', 'interrupted-one']);
ok('hidden sources are excluded');

fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log(`loose-ends: ${pass} groups pass`);
