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

// --- v1.0.61 audit fixes ----------------------------------------------------
// The real 30-day history had 5 idle sessions ending on a bare user message,
// all classified 'unknown' and silently skipped. One was plainly lost work
// ("wait ask that again i didnt get to read it", 12 days old). That is now its
// own ending.
assert.equal(classifySessionEnding([asst('here is the plan'), user('wait ask that again i didnt get to read it')]), 'unanswered');
ok('a prompt Claude never answered is a loose end');

// Synthetic user text arriving AFTER the real ending must not mask it. A
// trailing task-notification made an interrupted session read 'unknown'.
assert.equal(classifySessionEnding([
  asst('let me check'), user('[Request interrupted by user]'),
  user('<task-notification>\n<task-id>b123</task-id>'),
]), 'interrupted');
// And a skill invocation (bare skill body, no XML marker) is synthetic too:
// it must neither read as 'unanswered' nor mask a finished answer.
assert.equal(classifySessionEnding([
  user('go'), asst('all done.'),
  user('Base directory for this skill: /Users/x/.claude/skills/machine\n\n# machine'),
]), 'delivered');
ok('trailing synthetic user text cannot mask or fake an ending');

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
// Unanswered prompt at the end of a REAL conversation: a loose end.
write('hanging-prompt', [user('start'), asst('first pass done'), user('wait ask that again')], 60 * 26);
// Unanswered prompt in a session with NO assistant turn at all (".login" typed
// into a fresh session): not work, not surfaced.
write('empty-unanswered', [user('.login')], 60 * 27);
write('finished', [user('do it'), asst('done, all green.')], 60 * 24 * 2);
write('interrupted-one', [asst('let me check'), user('[Request interrupted by user]')], 60 * 5);
write('still-live', [user('go'), asst('working:'), toolUse()], 2); // 2 minutes ago
write('tiny', [user('hi'), asst('hey'), toolUse()], 60 * 24, 100); // under minBytes

const found = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
const ids = found.map((f) => f.sessionId).sort();
assert.deepEqual(ids, ['abandoned-old', 'hanging-prompt', 'interrupted-one'], `got ${JSON.stringify(ids)}`);
const hanging = found.find((f) => f.sessionId === 'hanging-prompt');
assert.equal(hanging.ending, 'unanswered');
// The recognisable thing about an unanswered ending is what YOU typed.
assert.equal(hanging.snippet, 'wait ask that again');
ok('finds only genuinely abandoned sessions, including a hanging prompt');

// The live-work false positive: a session touched moments ago is IN PLAY, not
// abandoned. Without this the scanner reported the user's own active session.
assert.ok(!ids.includes('still-live'), 'a session touched 2 minutes ago is not a loose end');
ok('active work is excluded by the idle threshold');

// Callers that know which sessions are attached to a live Claude can exclude
// them outright, regardless of age.
const excluded = await findLooseEnds({ maxAgeDays: 30, excludeSessionIds: ['abandoned-old', 'hanging-prompt'] });
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
assert.deepEqual(afterHidden.map((f) => f.sessionId).sort(), ['abandoned-old', 'hanging-prompt', 'interrupted-one']);
ok('hidden sources are excluded');

// A session whose conversation CONTINUED in another file is not abandoned.
// Claude Code's fork flow writes a new file whose first user message is the
// continuation preamble carrying parentUuid = the parent's leaf message uuid
// (verified against the real store: 2 such forks, both resolving to exactly
// one parent). The parent here ends mid-tool, which without the exclusion
// reads as abandoned.
const leafUuid = 'leaf-uuid-0001';
const parentEntries = [user('big job'), asst('phase one done'),
  { ...toolUse(), uuid: leafUuid }];
write('forked-parent', parentEntries, 60 * 30);
write('the-fork', [
  { type: 'user', parentUuid: leafUuid, message: { role: 'user', content: [{ type: 'text', text: 'This session is being continued from a previous conversation that ran out of context. Summary: ...' }] } },
  asst('picking up where we left off'), toolUse(),
], 60 * 28);
const afterFork = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
assert.ok(!afterFork.some((f) => f.sessionId === 'forked-parent'),
  'a continued-elsewhere parent must not be nagged about');
// The fork itself DID end mid-tool and was never picked up: it is the loose end.
assert.ok(afterFork.some((f) => f.sessionId === 'the-fork'), 'the fork itself is the loose end');
// In-place compaction writes the same preamble MID-file; that must not make a
// file's own entries exclude it or anything else.
const compacted = [user('go'), asst('lots of work'),
  { type: 'user', parentUuid: 'internal-uuid-7', message: { role: 'user', content: [{ type: 'text', text: 'This session is being continued from a previous conversation. Summary: ...' }] } },
  asst('continuing'), { ...toolUse(), uuid: 'internal-uuid-9' }];
write('compacted-inplace', compacted, 60 * 29);
const afterCompact = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
assert.ok(afterCompact.some((f) => f.sessionId === 'compacted-inplace'),
  'in-place compaction does not hide a genuinely abandoned session');
ok('a continuation fork retires its parent, and only its parent');

// A fork whose preamble is preceded by an injected user row (system reminder,
// hook echo) must still be recognised: the scan decides on the first HUMAN
// user message, not the first user-shaped row (Codex, High).
const leaf2 = 'leaf-uuid-0002';
write('forked-parent-2', [user('job two'), asst('midway'), { ...toolUse(), uuid: leaf2 }], 60 * 31);
write('the-fork-2', [
  { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>housekeeping</system-reminder>' }] } },
  { type: 'user', parentUuid: leaf2, message: { role: 'user', content: [{ type: 'text', text: 'This session is being continued from a previous conversation. Summary: ...' }] } },
  asst('resuming'), toolUse(),
], 60 * 28);
const afterFork2 = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
assert.ok(!afterFork2.some((f) => f.sessionId === 'forked-parent-2'),
  'an injected row before the preamble must not hide the fork');
ok('injected user rows before the preamble do not blind the fork scan');

// The fork verdict must FOLLOW THE FILE, not a filename-keyed cache: a fork
// exists for a while with only meta rows, then gains its preamble with no
// filename change. Both Codex lenses independently caught the stale cache.
const leaf3 = 'leaf-uuid-0003';
write('forked-parent-3', [user('job three'), asst('half done'), { ...toolUse(), uuid: leaf3 }], 60 * 32);
write('late-fork', [{ type: 'file-history-snapshot', snapshot: 'x'.repeat(200) }], 60 * 27, 21_000);
const before3 = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
assert.ok(before3.some((f) => f.sessionId === 'forked-parent-3'), 'parent flagged while the fork is empty');
// The preamble lands in the EXISTING file: same name, new content.
write('late-fork', [
  { type: 'file-history-snapshot', snapshot: 'x'.repeat(200) },
  { type: 'user', parentUuid: leaf3, message: { role: 'user', content: [{ type: 'text', text: 'This session is being continued from a previous conversation. Summary: ...' }] } },
  asst('resuming'), toolUse(),
], 60 * 26);
const after3 = await findLooseEnds({ maxAgeDays: 30, limit: 20 });
assert.ok(!after3.some((f) => f.sessionId === 'forked-parent-3'),
  'the parent is released as soon as the fork gains its preamble');
ok('the fork verdict follows the file, not a stale cache');

fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log(`loose-ends: ${pass} groups pass`);
