// Dismissing a loose end. Shared by the desktop tab and the phone board, so a
// bug here is a bug in both at once.
//
// The rule this locks down (Codex, High): "Not important" applies to the
// session AS IT STOOD, not to the session forever. The first implementation
// keyed on sessionId alone, so dismissing S hid it permanently. Resume S, work
// on it for an hour, abandon it again, and the new abandoned work never
// appeared on that device.
// Run: node ./electron/__tests__/loose-dismiss.test.mjs
import assert from 'node:assert/strict';
import {
  parseDismissed, isDismissed, visibleLooseEnds, withDismissal,
} from '../../shared/loose-dismiss.js';

let pass = 0;
const ok = (n) => { console.log(`PASS  ${n}`); pass += 1; };
const item = (sessionId, lastActivityAt) => ({ sessionId, lastActivityAt });

// 1. The core rule, both directions.
const S = item('sess-a', 1000);
const d = withDismissal({}, S);
assert.equal(isDismissed(S, d), true, 'hidden while unchanged');
assert.equal(isDismissed(item('sess-a', 1000), d), true, 'same activity time stays hidden');
assert.equal(isDismissed(item('sess-a', 1001), d), false, 'ANY later activity brings it back');
assert.equal(isDismissed(item('sess-b', 9999), d), false, 'a different session is unaffected');
ok('a dismissal covers the session as it stood, not forever');

// 2. Filtering a real list.
const list = [item('a', 100), item('b', 200), item('c', 300)];
let dis = withDismissal({}, list[1]);
assert.deepEqual(visibleLooseEnds(list, dis).map((i) => i.sessionId), ['a', 'c']);
// b gets resumed, worked on, abandoned again at a later time.
const listAfter = [item('a', 100), item('b', 5000), item('c', 300)];
assert.deepEqual(visibleLooseEnds(listAfter, dis).map((i) => i.sessionId), ['a', 'b', 'c']);
ok('re-abandoned work reappears in the list');

// 3. Defensive input. An unreadable list must fail toward SHOWING work.
assert.deepEqual(parseDismissed(undefined), {});
assert.deepEqual(parseDismissed('not json'), {});
assert.deepEqual(parseDismissed('null'), {});
assert.deepEqual(parseDismissed('{"a":"nope","b":7}'), { b: 7 }, 'non-numeric stamps dropped');
// The pre-stamp array format is dropped, not migrated: every plausible
// invented stamp risks hiding real work forever.
assert.deepEqual(parseDismissed('["a","b"]'), {});
assert.deepEqual(visibleLooseEnds(list, parseDismissed('["a","b"]')).length, 3);
ok('unparseable or legacy state shows everything rather than hiding it');

// 4. Round-trips through JSON, which is how it is actually stored.
const stored = JSON.stringify(withDismissal({}, item('x', 42)));
assert.equal(isDismissed(item('x', 42), parseDismissed(stored)), true);
ok('survives a localStorage round-trip');

// 5. Never mutates the object the caller is holding in React state.
const before = withDismissal({}, item('keep', 1));
const snapshot = { ...before };
withDismissal(before, item('other', 2));
assert.deepEqual(before, snapshot, 'input untouched');
ok('non-mutating');

// 6. Bounded. Dismiss 250 sessions; the oldest 50 are forgotten, and the
// forgotten ones are the ones that have aged out of the scan window anyway.
let many = {};
for (let i = 0; i < 250; i += 1) many = withDismissal(many, item(`s${i}`, i + 1));
assert.equal(Object.keys(many).length, 200);
assert.equal(many.s0, undefined, 'oldest dropped');
assert.equal(many.s249, 250, 'newest kept');
ok('the dismissal list is bounded, dropping the stalest first');

// 7. A missing activity time must not crash, and must honour the dismissal
// rather than nagging on every refresh.
const noTime = { sessionId: 'q' };
const dq = withDismissal({}, noTime);
assert.equal(typeof dq.q, 'number', 'falls back to a wall-clock stamp');
assert.equal(isDismissed(noTime, dq), true);
assert.equal(isDismissed(null, dq), false);
assert.deepEqual(visibleLooseEnds(null, dq), []);
ok('items with no activity time are safe');

// 8. NaN must never become a stamp. NaN is typeof "number" but compares false
// against everything, so a NaN stamp meant "Not important" simply did not hide
// the row, and JSON turned it into null on the next load (Codex, Medium).
const dn = withDismissal({}, { sessionId: 'n', lastActivityAt: NaN });
assert.ok(Number.isFinite(dn.n), 'stamp is finite');
assert.equal(isDismissed({ sessionId: 'n', lastActivityAt: NaN }, dn), true);
assert.equal(isDismissed({ sessionId: 'n', lastActivityAt: Date.now() + 60_000 }, dn), false);
// A NaN already sitting in storage must be discarded, not honoured.
assert.deepEqual(parseDismissed(JSON.stringify({ q: NaN })), {}, 'JSON turns NaN to null; dropped');
ok('a NaN activity time cannot poison a dismissal');

console.log(`loose-dismiss: ${pass} groups pass`);
