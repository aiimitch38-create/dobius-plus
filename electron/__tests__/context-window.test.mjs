// Context meter window sizing: model-aware + self-calibrating (the hardcoded
// 200k pinned every Fable session at 100%).
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/context-window.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DOBIUS_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-ctxtest-'));
const { windowForModel } = await import('../data-service.js');

// 1. 200k models: haiku 4.5, sonnet 4.5 (incl. dated ids), and unknowns.
assert.equal(windowForModel('claude-haiku-4-5-20251001', 120_000), 200_000);
assert.equal(windowForModel('claude-sonnet-4-5-20250929', 50_000), 200_000);
assert.equal(windowForModel('', 0), 200_000);
assert.equal(windowForModel(null, 0), 200_000);

// 2. 1M models per current Anthropic specs: the Claude 5 family AND
// opus-4.6+/sonnet-4.6 (Codex round 2: the first map wrongly left opus-5 and
// sonnet-5 at 200k). Real repro: 696,679 tokens on claude-fable-5 was 348%
// of the old hardcoded 200k, clamped to a pinned 100%.
assert.equal(windowForModel('claude-fable-5', 696_679), 1_000_000);
assert.equal(windowForModel('claude-mythos-5', 10_000), 1_000_000);
assert.equal(windowForModel('claude-opus-5', 120_000), 1_000_000);
assert.equal(windowForModel('claude-sonnet-5', 120_000), 1_000_000);
assert.equal(windowForModel('claude-opus-4-8', 50_000), 1_000_000);
assert.equal(windowForModel('claude-opus-4-6', 50_000), 1_000_000);
assert.equal(windowForModel('claude-sonnet-4-6', 50_000), 1_000_000);

// 3. Self-calibration: observed tokens above the assumed window snap it up to
// the next standard size, so no model can pin the meter.
assert.equal(windowForModel('claude-haiku-4-5', 250_000), 500_000);
assert.equal(windowForModel('claude-haiku-4-5', 600_000), 1_000_000);
assert.equal(windowForModel('claude-fable-5', 1_200_000), 2_000_000);

// 4. Beyond every standard size: the window becomes the observation itself
// (pct reads 100, honestly, instead of >100 nonsense).
assert.equal(windowForModel('claude-fable-5', 3_000_000), 3_000_000);

fs.rmSync(process.env.DOBIUS_TEST_USERDATA, { recursive: true, force: true });
console.log('context-window: 4 groups pass');
