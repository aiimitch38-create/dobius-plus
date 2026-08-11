// Context meter window sizing: model-aware + self-calibrating (the hardcoded
// 200k pinned every Fable session at 100%).
// Run: node --import ./electron/__tests__/register.mjs ./electron/__tests__/context-window.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DOBIUS_TEST_USERDATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-ctxtest-'));
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'dobius-ctxhome-'));
process.env.HOME = HOME;
const { windowForModel, estimateContextForSession } = await import('../data-service.js');

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

// 5. The model the status bar SHOWS. Claude Code stamps some turns
// `<synthetic>` (its own internal messages), and those carry usage like any
// other turn, so taking the last model verbatim rendered the badge as the
// literal string "<synthetic>". Measured on this Mac before the fix: 8 of 112
// recent sessions ended on a synthetic turn, so the badge read as broken
// roughly 1 session in 14. A synthetic turn is not a model change.
const PROJ = path.join(HOME, 'Projects (Code)', 'ctx-model-project');
fs.mkdirSync(PROJ, { recursive: true });
const projDir = path.join(HOME, '.claude', 'projects', PROJ.replace(/[^a-zA-Z0-9.-]/g, '-'));
fs.mkdirSync(projDir, { recursive: true });

const turn = (model, tokens) => JSON.stringify({
  message: { role: 'assistant', model, usage: { input_tokens: tokens } },
});
const writeSession = (id, lines) => fs.writeFileSync(path.join(projDir, `${id}.jsonl`), `${lines.join('\n')}\n`);

// A real mid-session model switch MUST be reflected: this is the whole point
// of reading the model off the transcript instead of a config value.
writeSession('sess-switch-0001', [turn('claude-fable-5', 1000), turn('claude-opus-5', 2000)]);
let r = await estimateContextForSession('sess-switch-0001', PROJ);
assert.equal(r.model, 'claude-opus-5', 'the badge follows a mid-session switch');
assert.equal(r.tokens, 2000);

// A trailing synthetic turn must NOT overwrite it.
writeSession('sess-synth-0002', [turn('claude-opus-5', 1000), turn('<synthetic>', 1500)]);
r = await estimateContextForSession('sess-synth-0002', PROJ);
assert.equal(r.model, 'claude-opus-5', 'a synthetic turn is not a model change');
// Its token count is still the newest reading; only the attribution is kept.
assert.equal(r.tokens, 1500);
// And the window is sized for the REAL model, not for an unknown id.
assert.equal(r.maxTokens, 1_000_000, 'sized for the real model, not the synthetic');

// Nothing but synthetic turns: no model rather than a fake one. The status bar
// hides the badge on an empty model, which is the honest outcome.
writeSession('sess-onlysynth-0003', [turn('<synthetic>', 900)]);
r = await estimateContextForSession('sess-onlysynth-0003', PROJ);
assert.equal(r.model, '', 'no real model seen means no badge');

// 6. Compact reset. Between /compact and the next reply there is no fresh
// usage entry, so the meter showed the pre-compact figure (886,585 for 17
// minutes on a real 2026-08-10 compact of the dev session, and forever if
// you compact and walk away). The boundary row's compactMetadata.postTokens
// is the CLI's own measurement of what survived; a boundary NEWER than every
// turn must win, and the next real turn must supersede it.
const boundary = (postTokens) => JSON.stringify({
  type: 'system', subtype: 'compact_boundary',
  compactMetadata: postTokens == null
    ? { trigger: 'manual', preTokens: 887235 }
    : { trigger: 'manual', preTokens: 887235, postTokens },
  content: 'Conversation compacted',
});
const writeRaw = (id, lines) => fs.writeFileSync(path.join(projDir, `${id}.jsonl`), `${lines.join('\n')}\n`);

writeRaw('sess-compacted-0004', [turn('claude-opus-5', 886585), boundary(34526)]);
r = await estimateContextForSession('sess-compacted-0004', PROJ);
assert.equal(r.tokens, 34526, 'a trailing compact resets to the CLI-measured survivor count');
assert.equal(r.model, 'claude-opus-5', 'the model survives the reset');

// The first post-compact turn supersedes the boundary figure.
writeRaw('sess-postcompact-0005', [turn('claude-opus-5', 886585), boundary(34526), turn('claude-opus-5', 109346)]);
r = await estimateContextForSession('sess-postcompact-0005', PROJ);
assert.equal(r.tokens, 109346, 'a turn after the boundary wins');

// Old-CLI boundary without postTokens: no guessing, keep the last reading.
writeRaw('sess-oldcompact-0006', [turn('claude-opus-5', 500000), boundary(null)]);
r = await estimateContextForSession('sess-oldcompact-0006', PROJ);
assert.equal(r.tokens, 500000, 'a boundary without postTokens changes nothing');

fs.rmSync(HOME, { recursive: true, force: true });
fs.rmSync(process.env.DOBIUS_TEST_USERDATA, { recursive: true, force: true });
console.log('context-window: 6 groups pass');
