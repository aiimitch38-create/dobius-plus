// Config diet (v1.0.50): checkpoints migrate out of config.json into
// per-project files, closedTabs get trimmed to 10 x 200 lines, and the
// getCheckpoints/saveCheckpoints round-trip works.
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/checkpoint-migration.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated userData BEFORE importing config-manager (module load reads it).
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-cptest-'));
process.env.DOBIUS_TEST_USERDATA = userData;

const PROJ = '/tmp/cp-test-project';
const bigScrollback = Array.from({ length: 1500 }, (_, i) => `line ${i}`);
const fatClosed = Array.from({ length: 25 }, (_, i) => ({
  label: `closed ${i}`,
  projectPath: PROJ,
  scrollback: Array.from({ length: 500 }, (_, j) => `closed line ${j}`),
  closedAt: 1700000000000 + i,
}));

fs.writeFileSync(path.join(userData, 'config.json'), JSON.stringify({
  projects: {
    [PROJ]: {
      tabs: [{ id: 'term-a-1', label: 'one' }],
      checkpoints: [
        { id: 'cp-1', label: 'First', timestamp: 1700000000000, scrollback: bigScrollback, cols: 80, rows: 24 },
        { id: 'cp-2', label: 'Second', timestamp: 1700000001000, scrollback: ['only line'], cols: 80, rows: 24 },
      ],
      closedTabs: fatClosed,
    },
    '/tmp/cp-empty-project': { tabs: [], checkpoints: [] },
  },
}));

const cm = await import('../config-manager.js');
const cfg = cm.loadConfig();

// 1) checkpoints moved out of config for both projects (empty array dropped too)
assert.equal(cfg.projects[PROJ].checkpoints, undefined, 'inline checkpoints removed');
assert.equal(cfg.projects['/tmp/cp-empty-project'].checkpoints, undefined, 'empty checkpoints key dropped');

// 2) the per-project file holds the full migrated data
const encoded = Buffer.from(PROJ).toString('base64url');
const filePath = path.join(userData, 'checkpoints', `${encoded}.json`);
assert.ok(fs.existsSync(filePath), 'checkpoints file written');
const onDisk = JSON.parse(fs.readFileSync(filePath, 'utf8'));
assert.equal(onDisk.length, 2);
assert.equal(onDisk[0].scrollback.length, 1500, 'scrollback intact after migration');

// 3) closedTabs trimmed to 10 entries x 200 lines, keeping the NEWEST lines
const closed = cfg.projects[PROJ].closedTabs;
assert.equal(closed.length, 10);
assert.equal(closed[0].scrollback.length, 200);
assert.equal(closed[0].scrollback[199], 'closed line 499', 'slice(-200) keeps the tail');

// 4) the migrated config was persisted to disk (next boot loads the slim file)
const reread = JSON.parse(fs.readFileSync(path.join(userData, 'config.json'), 'utf8'));
assert.equal(reread.projects[PROJ].checkpoints, undefined, 'migration persisted');
assert.equal(reread.projects[PROJ].closedTabs.length, 10, 'closedTabs trim persisted');

// 5) getCheckpoints / saveCheckpoints round-trip + delete semantics
const list = await cm.getCheckpoints(PROJ);
assert.equal(list.length, 2);
assert.equal(list[1].label, 'Second');
await cm.saveCheckpoints(PROJ, list.filter((c) => c.id !== 'cp-1'));
const afterDelete = await cm.getCheckpoints(PROJ);
assert.equal(afterDelete.length, 1);
assert.equal(afterDelete[0].id, 'cp-2');

// 6) unknown project reads as []
assert.deepEqual(await cm.getCheckpoints('/tmp/never-existed'), []);

// 7) guards: bad inputs are no-ops, not throws
await cm.saveCheckpoints('', [{ id: 'x' }]);
await cm.saveCheckpoints(PROJ, 'not-an-array');
assert.equal((await cm.getCheckpoints(PROJ)).length, 1, 'bad saves ignored');

fs.rmSync(userData, { recursive: true, force: true });
console.log('checkpoint-migration: 7 groups pass');
