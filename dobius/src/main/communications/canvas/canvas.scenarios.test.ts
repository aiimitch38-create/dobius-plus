/**
 * Static contract checks for canvas.scenarios.ts — the properties the
 * runner (run-verification.test.ts) enforces at gate time, verified here at
 * unit time so a wiring mistake fails THIS file instead of the whole
 * install-gate run:
 *   - every step is via:'method' and names a really-registered canvas.*
 *     method exactly once (the method-seam uniqueness invariant);
 *   - every shapeCheck REJECTS garbage results, proving no step can fabricate
 *     a PASS from a malformed payload (the gate has no escape hatch for
 *     method-seam steps);
 *   - the ctx.family chain actually wires: captures from the write/read
 *     steps feed the later author-keyed steps' args.
 * Handler semantics themselves are covered end to end by
 * canvas-rpc-methods.test.ts; nothing here invokes a handler.
 */
import type * as Os from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// canvas-rpc-methods transitively imports participant-identity-store, which
// imports `electron` at module top level — same isolation contract as
// verify/runtime-bridge-harness.ts: never touch real Electron state.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('safeStorage is not available in this unit test')
    },
    decryptString: () => {
      throw new Error('safeStorage is not available in this unit test')
    }
  }
}))

// participant-identity-store resolves its keyfile under os.homedir(); pin it
// to scratch so even an accidental read/write stays out of the real home.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof Os>()
  return {
    ...actual,
    homedir: () => join(tmpdir(), 'dobius-canvas-scenarios-unit-home')
  }
})

import { CANVAS_NOTES_METHODS } from './canvas-rpc-methods'
import { SCENARIO_STEPS } from './canvas.scenarios'
import type { ScenarioContext } from '../scenario-contract'

const AUTHOR = 'a'.repeat(64)
const OTHER = 'b'.repeat(64)
const CANVAS_EVENT_ID = 'c'.repeat(64)
const NOTE_ID = 'd'.repeat(64)
const NOW = 1_700_000_000

function fakeCtx(): ScenarioContext {
  return { selfPubkey: 'e'.repeat(64), otherPubkey: OTHER, channelId: 'chan-verify', family: {} }
}

/** Synthetic handler outputs shaped exactly like canvas-rpc-methods returns. */
function fakeResults() {
  return {
    setCanvas: { ok: true, event_id: CANVAS_EVENT_ID },
    getCanvas: { content: '# Canvas Verify\n\nSeeded by canvas.scenarios.', updated_at: NOW - 5, author: AUTHOR },
    publishNote: { event_id: NOTE_ID, accepted: true, message: '' },
    getNote: {
      id: NOTE_ID,
      pubkey: AUTHOR,
      created_at: NOW,
      content: 'Canvas verification probe note.',
      tags: [['p', OTHER]]
    }
  } as const
}

function stepByCommand(command: string) {
  const found = SCENARIO_STEPS.find((step) => step.command === command)
  if (!found) {
    throw new Error(`test bug: no scenario step for ${command}`)
  }
  return found
}

describe('canvas.scenarios', () => {
  it('covers each registered canvas.* method exactly once over the method seam', () => {
    expect(SCENARIO_STEPS.length).toBe(CANVAS_NOTES_METHODS.length)
    const commands = SCENARIO_STEPS.map((step) => step.command)
    expect(new Set(commands).size).toBe(commands.length)
    expect(new Set(commands)).toEqual(new Set(CANVAS_NOTES_METHODS.map((method) => method.name)))
    for (const step of SCENARIO_STEPS) {
      expect(step.via, `${step.command} must dispatch over the gateway method seam`).toBe('method')
      expect(step.expectedError, `${step.command} must PASS, not rely on expectedError`).toBeUndefined()
    }
  })

  it('every shapeCheck rejects undefined and {} — no fabricated PASS possible', () => {
    for (const step of SCENARIO_STEPS) {
      const ctx = fakeCtx()
      // Chained args read captured family keys; seeding plausible values keeps
      // arg-building out of the way — the oracle itself must still reject.
      ctx.family.canvasVerifyAuthorPubkey = AUTHOR
      ctx.family.canvasVerifyNoteId = NOTE_ID
      ctx.family.canvasVerifyNoteCreatedAt = NOW
      // undefined and {} are malformed for every method here — including
      // getNoteReactions, whose CORRECT result is [] but never a missing or
      // non-object payload.
      for (const garbage of [undefined, {}]) {
        const verdict = step.shapeCheck(garbage, ctx)
        expect(verdict.ok, `${step.command} accepted ${JSON.stringify(garbage)}: ${JSON.stringify(verdict)}`).toBe(
          false
        )
      }
    }
  })

  it('chains write results into later steps through ctx.family', () => {
    const ctx = fakeCtx()
    const r = fakeResults()

    // Drive capture hooks with synthetic results, shapeCheck first — mirrors
    // the runner's "capture only after PASS" order.
    for (const [command, result] of [
      ['canvas.setCanvas', r.setCanvas],
      ['canvas.getCanvas', r.getCanvas],
      ['canvas.publishNote', r.publishNote],
      ['canvas.getNote', r.getNote]
    ] as const) {
      const step = stepByCommand(command)
      expect(step.shapeCheck(result, ctx).ok, `${command} should accept its own well-formed result`).toBe(true)
      step.capture?.(result, ctx)
    }

    expect(ctx.family.canvasVerifyNoteId).toBe(NOTE_ID)
    expect(stepByCommand('canvas.getNote').args(ctx)).toEqual({ noteId: NOTE_ID })
    expect(stepByCommand('canvas.getUserNotes').args(ctx)).toEqual({ pubkey: AUTHOR, limit: 10 })
    expect(stepByCommand('canvas.getLikedNotes').args(ctx)).toEqual({ authorPubkey: AUTHOR, limit: 10 })
    expect(stepByCommand('canvas.getNoteReactions').args(ctx)).toEqual({ noteIds: [NOTE_ID] })
    expect(stepByCommand('canvas.getNotesTimeline').args(ctx)).toEqual({
      pubkeys: [AUTHOR, OTHER],
      limitPerUser: 10
    })
  })
})
