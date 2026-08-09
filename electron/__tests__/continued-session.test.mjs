// Continued-session linking. Brett v1.0.56 (Asana 1217296245359720): a tab
// running `claude --continue` never got linked to its conversation, because
// the fresh resolver only accepts a transcript BORN after the process started
// and a continued session appends to one that already existed. Result: the
// phone showed "No messages yet" on real conversations and offered
// Start/Resume over a running Claude.
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/continued-session.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-conttest-'));
process.env.DOBIUS_TEST_USERDATA = userData;
// resolve* read ~/.claude/projects; point HOME at a scratch tree.
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-conthome-'));
process.env.HOME = home;

const PROJ = '/tmp/cont-test-project';
const encoded = PROJ.replace(/\//g, '-');
const projDir = path.join(home, '.claude', 'projects', encoded);
fs.mkdirSync(projDir, { recursive: true });

const { resolveContinuedSessionId, resolveFreshSessionId, resolveFreshSessionsForTabs } = await import('../data-service.js');
let pass = 0;
const ok = (n) => { console.log(`PASS  ${n}`); pass += 1; };

// Birth time cannot be faked (utimes moves mtime, never birthtime), so the
// "transcript predates the process" condition is built the honest way: the
// files are born NOW, and the process start is placed well after that birth.
// Offsets are large enough to clear FRESH_CLOCK_SLACK_MS (10s).
const BIRTH = Date.now();
const STARTED = BIRTH + 600_000;   // claude started long after these were born
const write = (sid, { mtime, size = 500 }) => {
  const f = path.join(projDir, `${sid}.jsonl`);
  fs.writeFileSync(f, 'x'.repeat(size));
  fs.utimesSync(f, new Date(mtime), new Date(mtime));
  return f;
};

// The continued transcript: born before the process (so the fresh resolver
// rejects it) but WRITTEN to after the process started.
write('old-continued', { mtime: STARTED + 30_000 });

// 1. The fresh resolver cannot link it (this is the bug being fixed).
assert.equal(await resolveFreshSessionId(PROJ, STARTED, new Set(), []), null);
ok('fresh resolver rejects a continued transcript (the original bug)');

// 2. The continued resolver links it on WRITE evidence.
assert.equal(await resolveContinuedSessionId(PROJ, STARTED, new Set(), []), 'old-continued');
ok('continued resolver links via write-after-start');

// 3. A transcript last written BEFORE the process started is not its work.
write('stale', { mtime: STARTED - 600_000 });
assert.equal(await resolveContinuedSessionId(PROJ, STARTED, new Set(), []), 'old-continued');
ok('transcript written before the process started is ignored');

// 4. Newest write wins when several were touched after the start.
write('newer-continued', { mtime: STARTED + 45_000 });
assert.equal(await resolveContinuedSessionId(PROJ, STARTED, new Set(), []), 'newer-continued');
ok('most recently written transcript wins');

// 5. Already claimed by another tab is never stolen.
assert.equal(
  await resolveContinuedSessionId(PROJ, STARTED, new Set(['newer-continued']), []),
  'old-continued',
);
ok('claimed sessions are not stolen');

// 6. EMPTY transcripts are never linked: doing so recreates the exact
// "No messages yet" dead end this fix removes. Isolated by claiming every
// other candidate (PROJECTS_DIR is resolved at module load, so HOME cannot be
// swapped mid-test).
write('empty-one', { mtime: STARTED + 90_000, size: 0 });
assert.equal(
  await resolveContinuedSessionId(PROJ, STARTED, new Set(['old-continued', 'stale', 'newer-continued']), []),
  null,
);
ok('empty transcripts are never linked');
// ...and an empty one never outranks a real conversation, even when newer.
assert.equal(await resolveContinuedSessionId(PROJ, STARTED, new Set(), []), 'newer-continued');
ok('empty transcript does not outrank a real one');

// 7. AMBIGUITY: another unlinked Claude in the same project could be the
// writer, so decline rather than mislink (a mislink makes auto-resume type
// `claude --resume <wrong-id>` into a terminal).
assert.equal(await resolveContinuedSessionId(PROJ, STARTED, new Set(), [STARTED - 5000]), null);
ok('declines when a rival unlinked Claude exists');


// 9. MISLINK GUARD (Codex High): tab A runs `claude --continue` (no argv id)
// while tab B in the SAME project runs `claude --resume X`. X's link is not
// written yet, so it used to be unclaimed and A could steal it, pointing the
// phone at B's conversation and risking an auto-resume typed into the wrong
// terminal. Live argv ids are now claimed before any inference runs.
const tabA = { id: 'tab-A', cwd: PROJ };
const tabB = { id: 'tab-B', cwd: PROJ };
const infoByTab = new Map([
  ['tab-A', { sessionId: null, startedAt: STARTED }],
  ['tab-B', { sessionId: 'newer-continued', startedAt: STARTED + 1000 }],
]);
const cwdByTab = new Map([['tab-A', PROJ]]); // only unidentified tabs get a cwd
const resolved = await resolveFreshSessionsForTabs(
  [tabA, tabB], infoByTab, cwdByTab, new Map(), new Set(),
);
assert.notEqual(resolved.get('tab-A'), 'newer-continued');
ok('a continued tab cannot steal another live tab\'s argv session');

// 10. Defensive inputs.
assert.equal(await resolveContinuedSessionId('', STARTED), null);
assert.equal(await resolveContinuedSessionId(PROJ, 0), null);
assert.equal(await resolveContinuedSessionId(PROJ, NaN), null);
ok('invalid inputs return null');

fs.rmSync(userData, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log(`continued-session: ${pass} groups pass`);
