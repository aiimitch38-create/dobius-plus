// Tear-off window tab persistence (Asana 1217079763770509 "Fix updating"):
// tabs added inside a tear-off window persist under config.tearOffWindows
// (keyed by the torn tab id) and survive restart; entries whose window is not
// in lastTearOffs are pruned on the next config load.
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/tearoff-tabs.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated userData BEFORE importing config-manager (module load reads it).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-teartest-'));
process.env.DOBIUS_TEST_USERDATA = userData;

const TORN = 'term-/tmp/tear-proj-4284';
const EXTRA = 'term-/tmp/tear-proj-14284';

fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  projects: {},
  lastTearOffs: [{ projectPath: '/tmp/tear-proj', tabId: TORN, label: 'CS Support' }],
  tearOffWindows: {
    [TORN]: { tabs: [{ id: TORN, label: 'CS Support' }, { id: EXTRA, label: 'Tab 14284' }], tabCounter: 9, activeTabId: EXTRA },
    'term-/tmp/tear-proj-999': { tabs: [{ id: 'term-/tmp/tear-proj-999', label: 'stale' }], tabCounter: 2, activeTabId: null },
  },
}));

const cm = await import('../config-manager.js');
let pass = 0;
const ok = (name) => { console.log(`PASS  ${name}`); pass += 1; };

// 1) load prunes the entry NOT referenced by lastTearOffs, keeps the live one
cm.loadConfig();
const kept = cm.getTearOffWindowState(TORN);
assert.equal(kept.tabs.length, 2);
assert.equal(kept.activeTabId, EXTRA);
assert.equal(cm.getTearOffWindowState('term-/tmp/tear-proj-999'), null);
ok('orphan pruned on load, live entry kept with both tabs');

// 2) round-trip: save overwrites, load returns the saved shape
cm.setTearOffWindowState(TORN, {
  tabs: [{ id: TORN, label: 'CS Support' }],
  tabCounter: 12,
  activeTabId: TORN,
});
const rt = cm.getTearOffWindowState(TORN);
assert.equal(rt.tabs.length, 1);
assert.equal(rt.tabCounter, 12);
assert.equal(rt.activeTabId, TORN);
ok('save/load round-trip');

// 3) invalid writes are rejected, valid state stays intact
cm.setTearOffWindowState(TORN, { tabs: 'nope' });
cm.setTearOffWindowState('__proto__', { tabs: [{ id: 'x' }] });
cm.setTearOffWindowState('', { tabs: [{ id: 'x' }] });
assert.equal(cm.getTearOffWindowState(TORN).tabs.length, 1);
assert.equal(Object.prototype.tabs, undefined);
assert.equal(cm.getTearOffWindowState('__proto__'), null);
ok('invalid/polluting writes rejected');

// 4) empty tab list reads as null (restore falls back to the single torn tab)
cm.setTearOffWindowState(TORN, { tabs: [], tabCounter: 1, activeTabId: null });
assert.equal(cm.getTearOffWindowState(TORN), null);
ok('empty tab list reads as null');

fs.rmSync(userData, { recursive: true, force: true });
console.log(`tearoff-tabs: ${pass} groups pass`);
