/**
 * Composable scenario registry for the communications command verification
 * harness's dispatch runner (run-verification.test.ts).
 *
 * THIS FILE IS THE COMPOSER, not the only source of scenario steps. A
 * feature agent implementing a command family (chat, identity, native,
 * huddles, agents, ...) writes their own `<family>.scenarios.ts` next to
 * their feature code, in their OWN directory — never here — and exports:
 *
 *   export const SCENARIO_STEPS: ScenarioStep[]
 *
 * importing `ScenarioStep`, `ScenarioContext`, `ShapeOutcome`, and the
 * shared helpers from `../scenario-contract.ts` (NOT from this file — see
 * that module's doc comment for why the contract lives there and not here:
 * short version, config/tsconfig.node.json excludes this whole `verify/`
 * directory, so a family file importing from here hits TS6307). This file
 * only imports each family's `SCENARIO_STEPS` and concatenates them — see
 * the FAMILY IMPORTS section further down. That keeps six agents from ever
 * touching the same file: a new family lands as a two-line addition here
 * (one import, one array-spread), never a merge conflict.
 *
 * This file still re-exports everything from `../scenario-contract` below,
 * so `'../verify/command-scenario'` keeps working for anything already
 * importing from it (teams.scenarios.ts, huddles.scenarios.ts as
 * originally written) — Node/Vitest resolve that import fine regardless of
 * tsc project boundaries. Only `config/tsconfig.node.json` cares about the
 * boundary, which is why NEW family modules should import the contract
 * directly from `../scenario-contract` instead.
 *
 * ORIGINAL CORE: the 54 commands this harness's first version hand-built
 * fixtures for (identity, relay lifecycle, channels, messages, agent
 * lifecycle, teams-snapshots) stay inline below, split into
 * `CORE_SETUP_STEPS` (establishes a live persona/managed agent/channel/
 * message/DM) and `CORE_TEARDOWN_STEPS` (deletes them) with every family's
 * steps spliced in between — see the ORDERING doc comment further down for
 * why. No reason to split my own, already-owned content into a separate
 * file just to mirror the family pattern.
 *
 * Only commands with a scenario step (core or family) get a hand-built
 * fixture + oracle. Every other command (pending, removed-pending, or a
 * family's commands before that family lands) is dispatched with `{}` and
 * no oracle in run-verification.test.ts's Pass 2 — safe for a genuinely
 * unimplemented command (`invokeDobiusBackedTauriCommand`'s switch in
 * dobiusCommunications.ts dispatches on command name alone, so it throws
 * the fixed "not implemented" error regardless of arguments), but NOT
 * safe to read as a "still broken" signal once a command gains a real
 * implementation before it has a scenario — see PASS2_FIX in this task's
 * report for how run-verification.test.ts now labels that case distinctly.
 *
 * GRACEFUL DEGRADATION POLICY: a family's import line is added to this file
 * ONLY once that family's `<family>.scenarios.ts` actually exists on disk —
 * never pre-wired speculatively. A static `import` of a file that doesn't
 * exist yet fails to resolve and crashes every test in this directory, not
 * just the missing family's commands, so there is no safe way to guess
 * ahead. Until a family lands, its commands simply aren't in SCENARIO yet
 * and fall through to Pass 2 (empty-args fallback, not a crash).
 */
export {
  type ShapeOutcome,
  type ScenarioContext,
  type ScenarioStep,
  isRecord,
  hasStringField,
  ok,
  fail,
  expectUndefined,
  expectArray,
  randomHexPubkey
} from '../scenario-contract'
import type { ScenarioStep } from '../scenario-contract'
import { CORE_SETUP_STEPS, CORE_TEARDOWN_STEPS } from './core.scenarios'


// ---------------------------------------------------------------------
// FAMILY IMPORTS
//
// Add one import line here + one array-spread line in SCENARIO below, as a
// pair, ONLY once that family's `<family>.scenarios.ts` file exists on
// disk — see this file's top doc comment ("GRACEFUL DEGRADATION POLICY")
// for why a speculative import of a not-yet-written file is unsafe.
//
// Family modules should import the contract (ScenarioStep, ScenarioContext,
// ShapeOutcome, ok/fail/isRecord/hasStringField/expectUndefined/
// expectArray/randomHexPubkey) from '../scenario-contract' — NOT from
// '../verify/command-scenario' — so config/tsconfig.node.json can typecheck
// them without crossing this excluded directory's boundary (TS6307). See
// scenario-contract.ts's own doc comment for the full reasoning.
//
// Expected families (from the six agents this composer was built for):
//
// import { SCENARIO_STEPS as identitySteps } from '../identity/identity.scenarios'
//
// Landed: teams (create_team/update_team/delete_team) — not under a
// subdirectory like the others, since team-store.ts's family lives
// directly in src/main/communications/, so its scenario module does too.
import { SCENARIO_STEPS as teamsSteps } from '../teams.scenarios'
// Landed: huddles (voice-huddles lifecycle commands). Still imports the
// contract from '../verify/command-scenario' (this file re-exports it, so
// that keeps resolving at runtime) rather than the new '../scenario-contract'
// — reported to the harness's coordinator to have huddles.scenarios.ts's
// import line updated; not edited here (out of this composer's write scope).
import { SCENARIO_STEPS as huddlesSteps } from '../huddles/huddles.scenarios'
// Landed: chat (channels-membership/messages-dm/relay-lifecycle families).
import { SCENARIO_STEPS as chatSteps } from '../chat/chat.scenarios'
// Landed: native-ux (5 of 14 commands are headless-testable; see that
// file's own doc comment for which 9 are intentionally excluded).
import { SCENARIO_STEPS as nativeSteps } from '../native/native.scenarios'
// Landed: agent-lifecycle / agent-provider-config / agent-approvals.
import { SCENARIO_STEPS as agentsSteps } from '../agents/agents.scenarios'
// Landed: workstation-git + media (method seam — the vendor switch has no
// cases for this family; every step dispatches the RPC method name through
// the real gateway handler via via:'method').
import { SCENARIO_STEPS as workstationSteps } from '../workstation/workstation.scenarios'
// Landed: agent/team snapshots (method seam, same as workstation).
import { SCENARIO_STEPS as snapshotsSteps } from '../snapshots/snapshots.scenarios'
// Landed: workflow lifecycle (method seam, same as workstation).
import { SCENARIO_STEPS as workflowsSteps } from '../workflows/workflows.scenarios'
// Landed: channel-template lifecycle (method seam, same as workstation).
import { SCENARIO_STEPS as channelTemplatesSteps } from '../../runtime/rpc/methods/channel-templates.scenarios'
// Landed: save-subscription lifecycle (method seam, same as workstation).
import { SCENARIO_STEPS as saveSubscriptionsSteps } from '../../runtime/rpc/methods/save-subscriptions.scenarios'
// Landed: canvas + social notes (method seam, same as workstation).
import { SCENARIO_STEPS as canvasSteps } from '../canvas/canvas.scenarios'
// ---------------------------------------------------------------------

/**
 * ORDERING: `CORE_SETUP_STEPS` run FIRST, always — they establish
 * `selfPubkey`/`otherPubkey` (seeded by run-verification.test.ts) and
 * `channelId`/`personaId`/`managedAgentPubkey`/`eventId` (via their own
 * `capture` steps), and leave the persona/managed agent/channel/message/DM
 * all still LIVE (not yet deleted). Every family's steps run next, against
 * that live world, in the order they're spread below — if one family's
 * steps must run before another's (e.g. one captures a `ctx.family` key the
 * other reads), order them accordingly here; this composer, not the
 * families themselves, owns final ordering. `CORE_TEARDOWN_STEPS` run
 * LAST, always — deleting the persona and the channel only after every
 * family has had a chance to operate on them (see `CORE_TEARDOWN_STEPS`'s
 * own doc comment for why this is split from setup at all).
 *
 * A family step throwing does NOT abort this run or skip teardown: every
 * step (args/dispatch/shapeCheck/capture) runs inside its own try/catch in
 * run-verification.test.ts, so one bad fixture becomes that one command's
 * ERROR entry, never a crash that leaves the world un-torn-down for
 * whichever family runs next.
 */
export const SCENARIO: ScenarioStep[] = [
  ...CORE_SETUP_STEPS,
  ...teamsSteps,
  ...huddlesSteps,
  ...chatSteps,
  ...nativeSteps,
  ...agentsSteps,
  // Method-seam families (via:'method' — dispatched by RPC method name
  // through the real gateway handler; see run-verification.test.ts's
  // methodEntries tests for their stricter gate).
  ...workstationSteps,
  ...snapshotsSteps,
  ...workflowsSteps,
  ...channelTemplatesSteps,
  ...saveSubscriptionsSteps,
  ...canvasSteps,
  // , ...identitySteps
  ...CORE_TEARDOWN_STEPS
]

export const SCENARIO_COMMANDS = new Set(SCENARIO.map((step) => step.command))
