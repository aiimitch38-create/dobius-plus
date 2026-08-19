/**
 * Scenario fixtures for the canvas-notes and channel-templates command
 * families (19 commands: save-subscription CRUD, get_canvas/set_canvas,
 * the social-note family, and channel-template CRUD+duplicate — see
 * command-manifest.json's `feature: "canvas-notes" | "channel-templates"`
 * rows), for the communications command verification harness's composable
 * scenario registry (src/main/communications/verify/command-scenario.ts's
 * `SCENARIO_STEPS` family contract). The harness owner splices this in
 * with one import + one array-spread in that file; this module never edits
 * verify/ itself — see scenario-contract.ts's top comment for why the
 * shared types below are imported from there (an unexcluded location)
 * rather than from verify/command-scenario.ts directly.
 *
 * ORDERING NOTE: several steps below reuse `ctx.channelId`, the channel
 * CORE_SCENARIO_STEPS creates and later deletes. Reusing it after that
 * delete is deliberate, not a bug: `delete_channel` only archives the
 * channel and fires a NIP-09 delete request (relay-store.ts does not
 * actually implement NIP-09 removal, and even if it did, this family's
 * canvas/save-subscription commands address by the raw channel-id STRING
 * as a `d`-tag or scope value — they never re-resolve it through
 * `get_channel_details`), so any channel-id-shaped string works equally
 * well here. This also means `requiresSecondBoundary` is not needed for
 * `set_canvas` below: it writes kind 30011 (canvas-relay-kinds.ts), a
 * different kind than the 39000/39002 addressable writes CORE's own
 * channel-lifecycle steps make to the same channel id, and RelayStore's
 * replacement collapsing is keyed by (pubkey, KIND, d-tag) — different
 * kind means no collision regardless of timing.
 */
import type { ScenarioContext, ScenarioStep, ShapeOutcome } from '../scenario-contract'
import { fail, hasStringField, isRecord, ok } from '../scenario-contract'

function familyOf(ctx: ScenarioContext): Record<string, unknown> {
  return ctx.family
}

// ---------------------------------------------------------------------
// save-subscription family (create/list/merge/remove/delete)
// ---------------------------------------------------------------------

function isRawSaveSubscriptionRow(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {return fail(`expected a save subscription row, got ${typeof value}`)}
  if (!hasStringField(value, 'identity_pubkey')) {return fail('missing identity_pubkey')}
  if (!hasStringField(value, 'relay_url')) {return fail('missing relay_url')}
  if (!hasStringField(value, 'scope_type')) {return fail('missing scope_type')}
  if (!hasStringField(value, 'scope_value')) {return fail('missing scope_value')}
  if (typeof value.kinds !== 'string') {return fail(`kinds should be a JSON-encoded string column, got ${typeof value.kinds}`)}
  if (typeof value.created_at !== 'number') {return fail('missing created_at')}
  return ok()
}

const SAVE_SUBSCRIPTION_STEPS: ScenarioStep[] = [
  {
    command: 'create_save_subscription',
    args: (ctx) => ({ scopeType: 'channel_h', scopeValue: ctx.channelId, kinds: [9, 40002] }),
    shapeCheck: expectUndefinedOrRow
  },
  {
    command: 'list_save_subscriptions',
    args: () => ({}),
    shapeCheck: (result, ctx) => {
      if (!Array.isArray(result)) {return fail('expected an array')}
      const mine = result.find((row) => isRecord(row) && row.scope_value === ctx.channelId)
      if (!mine) {return fail('created save subscription did not appear in list_save_subscriptions')}
      return isRawSaveSubscriptionRow(mine)
    }
  },
  {
    command: 'merge_save_subscription_kinds',
    args: () => ({ kind: 24200 }),
    shapeCheck: expectUndefinedOrRow
  },
  {
    command: 'remove_save_subscription_kind',
    args: () => ({ kind: 24200 }),
    shapeCheck: expectUndefinedOrRow
  },
  {
    command: 'delete_save_subscription',
    args: (ctx) => ({ scopeType: 'channel_h', scopeValue: ctx.channelId }),
    shapeCheck: (result) => (typeof result === 'boolean' ? ok() : fail(`expected a boolean, got ${JSON.stringify(result)}`))
  }
]

/** merge_save_subscription_kinds/remove_save_subscription_kind mirror
 * every other mutation-only command in this codebase (edit_message,
 * add_channel_members's siblings, etc.): the case block awaits the store
 * call and returns undefined to the caller, since the Buzz UI reloads its
 * subscription list via list_save_subscriptions rather than reading a
 * return value here. */
function expectUndefinedOrRow(result: unknown): ShapeOutcome {
  return result === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(result)}`)
}

// ---------------------------------------------------------------------
// canvas family (get_canvas/set_canvas)
// ---------------------------------------------------------------------

const CANVAS_CONTENT = '# Verify Canvas\n\nSeeded by the verification harness.'

const CANVAS_STEPS: ScenarioStep[] = [
  {
    command: 'set_canvas',
    args: (ctx) => ({ channelId: ctx.channelId, content: CANVAS_CONTENT }),
    shapeCheck: (result) => {
      if (!isRecord(result)) {return fail(`expected a set_canvas result, got ${typeof result}`)}
      if (result.ok !== true) {return fail(`expected ok: true, got ${JSON.stringify(result.ok)}`)}
      if (!hasStringField(result, 'event_id')) {return fail('missing event_id')}
      return ok()
    }
  },
  {
    command: 'get_canvas',
    args: (ctx) => ({ channelId: ctx.channelId }),
    shapeCheck: (result) => {
      if (!isRecord(result)) {return fail(`expected a get_canvas result, got ${typeof result}`)}
      if (result.content !== CANVAS_CONTENT) {return fail(`canvas content did not round-trip: ${JSON.stringify(result.content)}`)}
      if (typeof result.updated_at !== 'number') {return fail('missing updated_at')}
      if (!hasStringField(result, 'author')) {return fail('missing author')}
      return ok()
    }
  }
]

// ---------------------------------------------------------------------
// social-note family (publish/get/reactions/timeline/global/liked)
// ---------------------------------------------------------------------

function isRawUserNotesResponse(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {return fail(`expected a notes response, got ${typeof value}`)}
  if (!Array.isArray(value.notes)) {return fail('missing notes array')}
  if (value.next_cursor !== null && !isRecord(value.next_cursor)) {
    return fail(`next_cursor should be an object or null, got ${JSON.stringify(value.next_cursor)}`)
  }
  return ok()
}

const NOTE_CONTENT = 'Verification note from the canvas-notes scenario.'

const SOCIAL_NOTE_STEPS: ScenarioStep[] = [
  {
    command: 'publish_note',
    args: (ctx) => ({ content: NOTE_CONTENT, replyTo: null, mentionPubkeys: [ctx.otherPubkey], mediaTags: null }),
    shapeCheck: (result) => {
      if (!isRecord(result)) {return fail(`expected a publish_note result, got ${typeof result}`)}
      if (!hasStringField(result, 'event_id')) {return fail('missing event_id')}
      if (result.accepted !== true) {return fail(`expected accepted: true, got ${JSON.stringify(result.accepted)}`)}
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.event_id === 'string') {familyOf(ctx).noteId = result.event_id}
    }
  },
  {
    command: 'get_note',
    args: (ctx) => ({ noteId: familyOf(ctx).noteId }),
    shapeCheck: (result, ctx) => {
      if (!isRecord(result)) {return fail(`expected a note object, got ${typeof result}`)}
      if (result.id !== familyOf(ctx).noteId) {return fail('note id mismatch')}
      if (result.content !== NOTE_CONTENT) {return fail(`content mismatch: ${JSON.stringify(result.content)}`)}
      return ok()
    }
  },
  {
    command: 'get_note_reactions',
    args: (ctx) => ({ noteIds: [familyOf(ctx).noteId] }),
    // Why an empty array is the correct, non-trivial assertion here: no
    // reaction ever targets this note within this scenario run —
    // add_reaction/remove_reaction are CORE-owned, single-use commands
    // already spent on ctx.eventId (a channel message), and this family
    // cannot call them a second time without violating the harness's
    // "every command appears in SCENARIO exactly once" invariant. See
    // note-reaction-aggregate.test.ts for the aggregation logic's real
    // coverage of a non-empty case.
    shapeCheck: (result) => (Array.isArray(result) && result.length === 0 ? ok() : fail(`expected [], got ${JSON.stringify(result)}`))
  },
  {
    command: 'get_user_notes',
    args: (ctx) => ({ pubkey: ctx.selfPubkey, limit: 10, before: null, beforeId: null }),
    shapeCheck: (result, ctx) => {
      const shape = isRawUserNotesResponse(result)
      if (!shape.ok) {return shape}
      const notes = (result as Record<string, unknown>).notes as unknown[]
      const mine = notes.find((note) => isRecord(note) && note.id === familyOf(ctx).noteId)
      return mine ? ok() : fail('published note did not appear in get_user_notes')
    }
  },
  {
    command: 'get_global_notes',
    args: () => ({ limit: 20, before: null, beforeId: null }),
    shapeCheck: (result, ctx) => {
      const shape = isRawUserNotesResponse(result)
      if (!shape.ok) {return shape}
      const notes = (result as Record<string, unknown>).notes as unknown[]
      const mine = notes.find((note) => isRecord(note) && note.id === familyOf(ctx).noteId)
      return mine ? ok() : fail('published note did not appear in get_global_notes')
    }
  },
  {
    command: 'get_liked_notes',
    args: (ctx) => ({ authorPubkey: ctx.selfPubkey, limit: 10 }),
    shapeCheck: isRawUserNotesResponse
  },
  {
    command: 'get_notes_timeline',
    args: (ctx) => ({ pubkeys: [ctx.selfPubkey, ctx.otherPubkey], limitPerUser: 10 }),
    shapeCheck: (result, ctx) => {
      const shape = isRawUserNotesResponse(result)
      if (!shape.ok) {return shape}
      const notes = (result as Record<string, unknown>).notes as unknown[]
      const mine = notes.find((note) => isRecord(note) && note.id === familyOf(ctx).noteId)
      return mine ? ok() : fail('published note did not appear in get_notes_timeline')
    }
  }
]

// ---------------------------------------------------------------------
// channel-template family (list/create/update/duplicate/delete)
// ---------------------------------------------------------------------

function isRawChannelTemplateShape(value: unknown): ShapeOutcome {
  if (!isRecord(value)) {return fail(`expected a channel template object, got ${typeof value}`)}
  if (!hasStringField(value, 'id')) {return fail('missing id')}
  if (!hasStringField(value, 'name')) {return fail('missing name')}
  if (!hasStringField(value, 'channel_type')) {return fail('missing channel_type')}
  if (!hasStringField(value, 'visibility')) {return fail('missing visibility')}
  if (value.is_builtin !== false) {return fail(`is_builtin should be the honest default false, got ${JSON.stringify(value.is_builtin)}`)}
  if (!isRecord(value.agents) || !Array.isArray(value.agents.personas) || !Array.isArray(value.agents.teams)) {
    return fail(`agents should be { personas: [], teams: [] }, got ${JSON.stringify(value.agents)}`)
  }
  if (!hasStringField(value, 'created_at')) {return fail('missing created_at')}
  if (!hasStringField(value, 'updated_at')) {return fail('missing updated_at')}
  return ok()
}

const CHANNEL_TEMPLATE_STEPS: ScenarioStep[] = [
  {
    command: 'list_channel_templates',
    args: () => ({}),
    shapeCheck: (result) => (Array.isArray(result) ? ok() : fail(`expected an array, got ${typeof result}`))
  },
  {
    command: 'create_channel_template',
    args: () => ({
      input: {
        name: 'Verify Channel Template',
        description: 'created by the verification harness',
        channelType: 'stream',
        visibility: 'open',
        canvasTemplate: '# Starter Canvas',
        agents: { personas: [], teams: [] }
      }
    }),
    shapeCheck: (result) => {
      const shape = isRawChannelTemplateShape(result)
      if (!shape.ok) {return shape}
      const record = result as Record<string, unknown>
      return record.name === 'Verify Channel Template' ? ok() : fail(`name not set: ${JSON.stringify(record.name)}`)
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.id === 'string') {familyOf(ctx).channelTemplateId = result.id}
    }
  },
  {
    command: 'update_channel_template',
    args: (ctx) => ({
      input: { id: familyOf(ctx).channelTemplateId, name: 'Verify Channel Template Updated', visibility: 'private' }
    }),
    shapeCheck: (result, ctx) => {
      const shape = isRawChannelTemplateShape(result)
      if (!shape.ok) {return shape}
      const record = result as Record<string, unknown>
      if (record.id !== familyOf(ctx).channelTemplateId) {return fail('update_channel_template returned a different id')}
      if (record.name !== 'Verify Channel Template Updated') {return fail('name change did not take')}
      if (record.visibility !== 'private') {return fail('visibility change did not take')}
      return ok()
    }
  },
  {
    command: 'duplicate_channel_template',
    args: (ctx) => ({ id: familyOf(ctx).channelTemplateId }),
    shapeCheck: (result, ctx) => {
      const shape = isRawChannelTemplateShape(result)
      if (!shape.ok) {return shape}
      const record = result as Record<string, unknown>
      if (record.id === familyOf(ctx).channelTemplateId) {return fail('duplicate returned the same id as the original')}
      if (record.name !== 'Verify Channel Template Updated (Copy)') {return fail(`unexpected duplicate name: ${JSON.stringify(record.name)}`)}
      return ok()
    },
    capture: (result, ctx) => {
      if (isRecord(result) && typeof result.id === 'string') {familyOf(ctx).channelTemplateCopyId = result.id}
    }
  },
  {
    command: 'delete_channel_template',
    args: (ctx) => ({ id: familyOf(ctx).channelTemplateCopyId }),
    shapeCheck: (result) => (result === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(result)}`))
  }
]

export const SCENARIO_STEPS: ScenarioStep[] = [
  ...SAVE_SUBSCRIPTION_STEPS,
  ...CANVAS_STEPS,
  ...SOCIAL_NOTE_STEPS,
  ...CHANNEL_TEMPLATE_STEPS
]
