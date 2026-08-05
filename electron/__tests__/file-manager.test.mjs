// File-manager service: path containment (.., symlink escape), listing,
// preview kinds, create/rename/trash guards.
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/file-manager.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DOBIUS_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-fmtest-ud-'));
const fm = await import('../file-manager-service.js');

// Sandbox: root project dir + an OUTSIDE dir a symlink will try to escape to.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-fmtest-'));
const proj = path.join(base, 'proj');
const outside = path.join(base, 'outside');
fs.mkdirSync(path.join(proj, 'src'), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(proj, 'README.md'), '# hello\n');
fs.writeFileSync(path.join(proj, 'src', 'app.js'), 'console.log(1)\n');
fs.writeFileSync(path.join(proj, 'blob.bin'), Buffer.from([0x89, 0x00, 0x01, 0x02]));
fs.writeFileSync(path.join(outside, 'secret.txt'), 'do not read\n');
fs.symlinkSync(outside, path.join(proj, 'escape'));

// 1. Root listing: dirs first, then files, alphabetical.
const root = await fm.listDir(proj, '');
assert.deepEqual(root.entries.map((e) => e.name), ['escape', 'src', 'blob.bin', 'README.md']);
assert.equal(root.relPath, '');

// 2. Subdir listing via relPath.
const sub = await fm.listDir(proj, 'src');
assert.deepEqual(sub.entries.map((e) => e.name), ['app.js']);
assert.equal(sub.relPath, 'src');

// 3. `..` traversal is rejected.
const esc1 = await fm.listDir(proj, '../outside');
assert.equal(esc1.entries.length, 0);
assert.ok(esc1.error, 'traversal rejected');

// 4. Symlink escape is rejected (realpath containment).
const esc2 = await fm.listDir(proj, 'escape');
assert.equal(esc2.entries.length, 0);
assert.ok(esc2.error, 'symlink escape rejected');
const esc3 = await fm.readPreview(proj, 'escape/secret.txt');
assert.equal(esc3.kind, 'error', 'symlinked file read rejected');

// 5. Text preview.
const txt = await fm.readPreview(proj, 'README.md');
assert.equal(txt.kind, 'text');
assert.equal(txt.content, '# hello\n');
assert.equal(txt.truncated, false);

// 6. Binary sniff (NUL in head).
assert.equal((await fm.readPreview(proj, 'blob.bin')).kind, 'binary');

// 7. Create file + folder; duplicate create fails.
assert.equal((await fm.createEntry(proj, '', 'notes.txt', 'file')).ok, true);
assert.equal((await fm.createEntry(proj, 'src', 'lib', 'dir')).ok, true);
assert.equal((await fm.createEntry(proj, '', 'notes.txt', 'file')).ok, false);

// 8. Create with a traversal name or separators is rejected.
assert.equal((await fm.createEntry(proj, '', '../evil.txt', 'file')).ok, false);
assert.equal((await fm.createEntry(proj, '', 'a/b.txt', 'file')).ok, false);
assert.equal((await fm.createEntry(proj, '', '..', 'dir')).ok, false);

// 9. Rename in place; renaming the root is rejected.
assert.equal((await fm.renameEntry(proj, 'notes.txt', 'notes2.txt')).ok, true);
assert.ok(fs.existsSync(path.join(proj, 'notes2.txt')));
assert.equal((await fm.renameEntry(proj, '', 'newroot')).ok, false);
assert.equal((await fm.renameEntry(proj, 'notes2.txt', '../stolen.txt')).ok, false);

// 10. Trash guards: root rejected; outside-path rejected. (Actual trashItem is
// stubbed in tests; the containment gate is what we verify here.)
assert.equal((await fm.trashEntry(proj, '')).ok, false);
assert.equal((await fm.trashEntry(proj, '../outside/secret.txt')).ok, false);

fs.rmSync(base, { recursive: true, force: true });
fs.rmSync(process.env.DOBIUS_TEST_USERDATA, { recursive: true, force: true });
console.log('file-manager: 10 groups pass');
