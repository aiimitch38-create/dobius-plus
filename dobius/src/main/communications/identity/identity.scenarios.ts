/**
 * Scenario fixtures for the identity-keychain command family, for the
 * communications command verification harness's composable scenario
 * registry (src/main/communications/verify/command-scenario.ts's
 * `SCENARIO_STEPS` family contract — see that file's top doc comment). The
 * harness owner splices this in with one import + one array-spread in that
 * file (`import { SCENARIO_STEPS as identitySteps } from '../identity/identity.scenarios'`
 * is already stubbed there, commented out); this module never edits verify/
 * itself.
 *
 * Types come from the shared contract at '../scenario-contract', which
 * lives outside verify/ specifically so family modules like this one can
 * import it without crossing the tsconfig project boundary that excludes
 * verify/ from config/tsconfig.node.json (see that file's own doc comment).
 *
 * ============================================================================
 * BEFORE SPLICING THIS IN — three harness-side prerequisites, all outside
 * this file's write scope (runtime-bridge-harness.ts and command-scenario.ts
 * both live in verify/ or are owned by the harness coordinator):
 *
 * 1. SAFETY-CRITICAL — os.homedir() must be isolated before running this
 *    family. participant-identity-store.ts, agent-participant-identity-store.ts,
 *    and event-archive-store.ts all resolve their storage path as
 *    `path.join(homedir(), '.dobius', ...)` (a convention that predates this
 *    slice), NOT via `app.getPath('userData')` (which runtime-bridge-harness.ts
 *    already isolates to ISOLATED_USER_DATA_DIR for agents-store.ts). Without
 *    an equivalent `os.homedir()` mock, running this family for real would
 *    read AND WRITE Carson's actual `~/.dobius/communications-identity.enc`,
 *    `~/.dobius/communications-agent-identities.enc`, and
 *    `~/.dobius/communications-event-archive.sqlite` — exactly the kind of
 *    side effect runtime-bridge-harness.ts's own doc comment says "a
 *    verification run must never have." Every one of this slice's own unit
 *    tests mocks `os`/`homedir` for this exact reason (see
 *    participant-identity-store.test.ts and every *.test.ts in this
 *    directory) — the harness needs the same treatment before this family
 *    can run safely, not just correctly.
 * 2. `IDENTITY_RPC_METHODS` (src/main/communications/identity/identity-rpc-methods.ts)
 *    must be registered into runtime-bridge-harness.ts's RpcDispatcher —
 *    that harness currently only wires CUSTOM_AGENT_METHODS / ACCOUNT_METHODS
 *    / TEAM_METHODS, so `communications.identity.*` calls 404 as
 *    "method_not_found" until this is added.
 * 3. `electron`'s mocked `app` needs `relaunch`/`exit` no-op stubs if
 *    `sign_out` is ever added here (deliberately NOT included below — see
 *    the omission note).
 * ============================================================================
 *
 * 14 of this family's 18 commands get a fixture below. 4 are deliberately
 * omitted, each for a documented, non-key-safety reason (see the omission
 * notes at the bottom of this file) — matching native.scenarios.ts's own
 * precedent: no fixture is honest (Pass 2's empty-args fallback), a fake
 * passing fixture is not.
 *
 * KEY-LEAK SWEEP: every step below composes its structural shapeCheck with
 * `noKeyLeak()`, a shared assertion that fails the moment ANY result from
 * this family ever contains an `nsec1...` bech32 private key or a
 * `privateKey`/`private_key`-shaped field name — see that function's own
 * doc comment for why hex-pattern matching alone is NOT used (pubkeys are
 * also 64 hex chars, and several of these commands legitimately return
 * one). This is the regression guard the build report's KEY_SAFETY section
 * promised: if a future change reintroduces the exact vulnerability this
 * slice was built to close, this sweep fails every one of the 14 steps
 * below, not just the one command someone touched.
 */
import { schnorr } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import {
  ok,
  fail,
  isRecord,
  hasStringField,
  randomHexPubkey,
  type ShapeOutcome,
  type ScenarioStep
} from '../scenario-contract'

const HEX_64 = /^[0-9a-f]{64}$/

/**
 * The key-safety sweep every step in this family runs. Deliberately does
 * NOT flag bare 64-hex strings — several of these commands legitimately
 * return a pubkey (also 64 hex chars), and a blanket hex check would either
 * false-positive on every one of them or have to be disabled per-field,
 * which defeats the point of a sweep. Instead this looks for the two
 * signals that are NEVER legitimate in any of this family's results:
 * the `nsec1` bech32 prefix (the only thing that ever produces one is
 * encodeNsec() inside secure-key-entry-window.ts's reveal flow, which never
 * returns to any RPC result), and a `privateKey`/`private_key`-shaped field
 * name (none of this family's public output types ever use one).
 */
function noKeyLeak(result: unknown): ShapeOutcome {
  let serialized: string
  try {
    serialized = JSON.stringify(result) ?? String(result)
  } catch {
    return fail('result could not be serialized for the key-leak sweep')
  }
  if (serialized.includes('nsec1')) {
    return fail(`KEY LEAK: result contains an nsec1... bech32 private key: ${serialized}`)
  }
  if (/private_?key/i.test(serialized)) {
    return fail(`KEY LEAK: result contains a private-key-shaped field name: ${serialized}`)
  }
  return ok()
}

function both(structural: ShapeOutcome, result: unknown): ShapeOutcome {
  if (!structural.ok) {
    return structural
  }
  return noKeyLeak(result)
}

function fakeArchivableEventJson(pubkeyHex: string, id: string): string {
  return JSON.stringify({
    id,
    pubkey: pubkeyHex,
    created_at: Math.floor(Date.now() / 1000),
    kind: 1,
    tags: [],
    content: 'identity-keychain verification probe event',
    sig: randomHexPubkey() + randomHexPubkey() // 128 hex chars, sig-shaped; not verified by the local archive
  })
}

export const SCENARIO_STEPS: ScenarioStep[] = [
  {
    command: 'archive_events',
    args: (ctx) => {
      const eventId = randomHexPubkey()
      ctx.family.identityArchiveScope = 'identity-verify-scope'
      ctx.family.identityArchivedEventId = eventId
      return {
        candidates: [
          {
            raw_event_json: fakeArchivableEventJson(ctx.selfPubkey, eventId),
            matched_scope: { scope_type: 'channel_h', scope_value: ctx.family.identityArchiveScope }
          }
        ]
      }
    },
    shapeCheck: (r) =>
      both(
        isRecord(r) && r.persisted === 1 && r.dropped === 0
          ? ok()
          : fail(`expected {persisted:1,dropped:0}, got ${JSON.stringify(r)}`),
        r
      )
  },
  {
    // Reads back exactly what the previous step archived, in the same scope.
    command: 'read_archived_events',
    args: (ctx) => ({
      scopeType: 'channel_h',
      scopeValue: ctx.family.identityArchiveScope,
      kinds: null,
      beforeCreatedAt: null,
      beforeId: null,
      limit: 10
    }),
    shapeCheck: (r, ctx) => {
      if (!Array.isArray(r) || r.length < 1 || typeof r[0] !== 'string') {
        return both(fail(`expected a non-empty string array, got ${JSON.stringify(r)}`), r)
      }
      const parsed = JSON.parse(r[0]) as { id?: unknown }
      return both(
        parsed.id === ctx.family.identityArchivedEventId
          ? ok()
          : fail(`expected the previously archived event id, got ${JSON.stringify(parsed)}`),
        r
      )
    }
  },
  {
    // Uses the REAL Keychain-backed identity, deliberately distinct from
    // ctx.selfPubkey (the harness's synthetic localIdentity() keypair) —
    // capturing it here so later steps in this family can cross-check
    // against the real thing, not the pre-existing core identity fixture.
    command: 'persist_current_identity',
    args: () => ({}),
    shapeCheck: (r) =>
      both(
        isRecord(r) && hasStringField(r, 'pubkey') && HEX_64.test(r.pubkey as string) && r.lost === false && r.locked === false
          ? ok()
          : fail(`unexpected Identity shape: ${JSON.stringify(r)}`),
        r
      ),
    capture: (r, ctx) => {
      if (isRecord(r) && typeof r.pubkey === 'string') {
        ctx.family.identityPubkey = r.pubkey
      }
    }
  },
  {
    command: 'generate_backup_passphrase',
    args: () => ({ words: 6, separator: ' ' }),
    shapeCheck: (r) =>
      both(
        typeof r === 'string' && r.split(' ').length === 6 ? ok() : fail(`expected a 6-word passphrase, got ${JSON.stringify(r)}`),
        r
      )
  },
  {
    command: 'get_legacy_workspace_storage',
    args: () => ({}),
    shapeCheck: (r) =>
      both(
        isRecord(r) &&
          r.workspaces === null &&
          r.activeWorkspaceId === null &&
          Array.isArray(r.onboardingCompletions) &&
          r.onboardingCompletions.length === 0
          ? ok()
          : fail(`expected an empty legacy snapshot, got ${JSON.stringify(r)}`),
        r
      )
  },
  {
    // Real cryptographic oracle, not just a shape check: independently
    // verifies the returned schnorr signature against the identity captured
    // by persist_current_identity, over this module's own recomputation of
    // the canonical string (see identity-lifecycle.ts's doc comment for the
    // canonicalization — pipe-joined, field order fixed).
    command: 'sign_nostr_identity_binding',
    args: () => ({
      challengeId: 'verify-challenge',
      nonce: 'verify-nonce',
      verificationCode: '000000',
      origin: 'https://verify.invalid',
      expiresAt: '2030-01-01T00:00:00Z'
    }),
    shapeCheck: (r, ctx) => {
      if (typeof r !== 'string') {
        return both(fail('expected a JSON string'), r)
      }
      let parsed: { pubkey?: unknown; sig?: unknown; canonical?: unknown }
      try {
        parsed = JSON.parse(r)
      } catch {
        return both(fail('result was not valid JSON'), r)
      }
      if (
        typeof parsed.pubkey !== 'string' ||
        typeof parsed.sig !== 'string' ||
        typeof parsed.canonical !== 'string'
      ) {
        return both(fail(`missing pubkey/sig/canonical: ${r}`), r)
      }
      if (ctx.family.identityPubkey && parsed.pubkey !== ctx.family.identityPubkey) {
        return both(fail('signature pubkey does not match the identity captured earlier'), r)
      }
      const digest = sha256(new TextEncoder().encode(parsed.canonical))
      const verifies = schnorr.verify(parsed.sig, digest, parsed.pubkey)
      return both(verifies ? ok() : fail('schnorr signature does not verify against its own canonical string'), r)
    }
  },
  {
    command: 'create_ncryptsec_backup',
    args: () => ({ password: 'identity-verify-passphrase-8492' }),
    shapeCheck: (r) =>
      both(typeof r === 'string' && r.startsWith('ncryptsec1') ? ok() : fail(`expected an ncryptsec1... string, got ${JSON.stringify(r)}`), r),
    capture: (r, ctx) => {
      if (typeof r === 'string') {
        ctx.family.identityBackup = r
      }
    }
  },
  {
    // Round-trips the previous step's backup and cross-checks its decoded
    // public identity against persist_current_identity's earlier capture —
    // the strongest available proof this decrypted the SAME key, without
    // this scenario file ever seeing the key itself.
    command: 'verify_ncryptsec_backup',
    args: (ctx) => ({ ncryptsec: ctx.family.identityBackup, password: 'identity-verify-passphrase-8492' }),
    shapeCheck: (r, ctx) => {
      if (!isRecord(r) || !hasStringField(r, 'pubkey') || !hasStringField(r, 'npub') || typeof r.matchesCurrentIdentity !== 'boolean') {
        return both(fail(`unexpected BackupVerification shape: ${JSON.stringify(r)}`), r)
      }
      if (r.matchesCurrentIdentity !== true) {
        return both(fail('expected matchesCurrentIdentity=true for a backup of the current identity'), r)
      }
      if (ctx.family.identityPubkey && r.pubkey !== ctx.family.identityPubkey) {
        return both(fail('verified pubkey does not match the identity captured earlier'), r)
      }
      return both(ok(), r)
    }
  },
  {
    command: 'nip44_encrypt_to_self',
    args: () => ({ plaintext: 'identity-keychain nip44 verification probe' }),
    shapeCheck: (r) => {
      if (typeof r !== 'string' || r.length === 0) {
        return both(fail(`expected a non-empty base64 string, got ${JSON.stringify(r)}`), r)
      }
      // Confirms this is genuinely ciphertext, not an accidental passthrough.
      if (r.includes('identity-keychain nip44 verification probe')) {
        return both(fail('plaintext appeared verbatim in the encrypted payload'), r)
      }
      return both(ok(), r)
    },
    capture: (r, ctx) => {
      if (typeof r === 'string') {
        ctx.family.identityNip44Payload = r
      }
    }
  },
  {
    command: 'nip44_decrypt_from_self',
    args: (ctx) => ({ ciphertext: ctx.family.identityNip44Payload }),
    shapeCheck: (r) =>
      both(
        r === 'identity-keychain nip44 verification probe'
          ? ok()
          : fail(`decrypted plaintext did not round-trip, got ${JSON.stringify(r)}`),
        r
      )
  },
  {
    command: 'archive_identity',
    args: (ctx) => ({ req: { targetPubkey: ctx.otherPubkey, reason: 'identity-keychain verification probe' } }),
    shapeCheck: (r) => both(r === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(r)}`), r)
  },
  {
    command: 'unarchive_identity',
    args: (ctx) => ({ req: { targetPubkey: ctx.otherPubkey } }),
    shapeCheck: (r) => both(r === undefined ? ok() : fail(`expected undefined, got ${JSON.stringify(r)}`), r)
  },
  {
    command: 'list_archived_identities',
    args: () => ({}),
    shapeCheck: (r) =>
      both(isRecord(r) && Array.isArray(r.archived) ? ok() : fail(`expected {archived: string[]}, got ${JSON.stringify(r)}`), r)
  },
  {
    // ctx.otherPubkey is purely synthetic (randomHexPubkey() — 32 random
    // bytes, no matching private key exists anywhere), so no kind:0 profile
    // for it can possibly exist on the relay. null is the only honest,
    // guaranteed-correct answer here — not a loose placeholder.
    command: 'resolve_oa_owner',
    args: (ctx) => ({ targetPubkey: ctx.otherPubkey }),
    shapeCheck: (r) => both(r === null ? ok() : fail(`expected null (no profile exists for a synthetic pubkey), got ${JSON.stringify(r)}`), r)
  }
]

// ── Omitted from this family (4 of 18) ──────────────────────────────────────
//
// get_nsec, import_identity: both open a real `new BrowserWindow(...)`
// (secure-key-entry-window.ts) — the entire point of this slice's redesign
// (see KEY_SAFETY in the build report). runtime-bridge-harness.ts's electron
// mock only stubs `BrowserWindow.fromId: () => null`, not a constructible
// class, so these throw under the harness for the same structural reason
// native.scenarios.ts omits every command touching Notification/Tray/Menu/
// dialog/nativeImage: a genuine "headless test process" vs. "running
// Electron app" gap, not an implementation bug. A fixture here would either
// fake a passing result (dishonest) or require launching a real window
// (out of scope for this harness per its own doc comment).
//
// save_ncryptsec_copy: opens `dialog.showSaveDialog(...)`, same category —
// `dialog` isn't in the harness's electron mock at all.
//
// sign_out: deliberately excluded even though it doesn't need a real
// window, for two reasons. (1) It calls `app.relaunch()`/`app.exit()`,
// neither of which the harness's electron mock provides, so it would throw
// there too until that's added. (2) Even with that added, sign_out wipes
// the participant identity as its entire purpose — running it mid-suite
// would invalidate `ctx.family.identityPubkey` and every step after it in
// this array, for every other family sharing the same ordered ctx. A
// destructive, state-resetting command doesn't fit this contract's ordered,
// cumulative-context model safely. Covered thoroughly instead by
// identity-lifecycle.test.ts's unit tests (verifies the identity is wiped,
// app.relaunch/app.exit are called, and a fresh identity differs from the
// old one).
