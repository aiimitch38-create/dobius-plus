# REPAIR — Communications tab shows a flashing logo and never opens

## Symptoms

Clicking **Communications** shows the Dobius mark blinking on a white screen.
Nothing else ever renders.

## CORRECTION — the first diagnosis below was wrong

Section 1 concluded that the two sides share no vocabulary and that ~187
commands had to be ported. **The measurements were accurate; the conclusion was
not.** It was reached by calling `window.dobiusCommunications.invoke(...)`
through CDP, which is the raw bridge *underneath* the layer the client uses.

`shared/api/dobiusCommunications.ts` is a 3,221-line translator with **171
command cases**, already wired in at `shared/api/tauri.ts:311`
(`invokeTauri` -> `invokeDobiusBackedTauriCommand` -> raw bridge as fallback).
Buzz's snake_case commands are translated there. Nothing needed porting.

**The real root cause, and it is mine.** `dobiusCommunications.ts` read the
participant identity out of localStorage:

```ts
const raw = window.localStorage.getItem("dobius-buzz-identity.v1");
if (!raw) throw new Error("Dobius Communications identity is unavailable");
```

The only writer of that key is the standalone `main.tsx` entry point, whose
identity bootstrap I deliberately left out of `CommunicationsPage.tsx` —
correctly, because it stored a Nostr secret in plain text and Phase 4 had
already migrated it into the encrypted main-process store
(`participant-identity-buzz-migration.ts`). **I removed the writer and never
repointed the reader.** So `localIdentity()` throws on the client's first call
and it never leaves the loading gate. Confirmed on the live machine: the only
matching localStorage keys are `buzz-theme-cache` and two mobile-sidebar flags.

The identity itself was never lost — it is reachable from the renderer right
now, which is what makes the fix small:

```
window.api.communications.getIdentity()
  -> {"pubkey":"ebcaeee747b709be8449d70ad6a56e7f83429be2f873d42d762457d65624645f",
      "username":"Dobius User"}
```

### Fix applied

- `localIdentity()` now returns the **public half only**, from a module-level
  cache. No secret enters the renderer.
- `primeDobiusIdentity()` fills that cache from the main process;
  `CommunicationsPage` awaits it before mounting the client, because 30-odd
  call sites read `.pubkey` synchronously while building relay tags and
  filters. This is what replaces the deleted bootstrap.
- `signedEvent()` is now async and signs via
  `window.api.communications.signEvent`. All 15 call sites await it.
- `decrypt_observer_event` / `build_observer_control_event` need NIP-44 against
  a *peer* pubkey, and the bridge only offers to-self. They now throw a named
  error instead of reaching for a key the renderer no longer has. A peer-scoped
  main-process method is the follow-up.

### Still outstanding

49 of the 187 commands have no case in the translator: mesh, pairing,
workflows, canvas notes, channel templates, media upload, project PR signing.
Most already have allowlisted backend methods (`canvas.*`, `channelTemplate.*`,
`agent.snapshot.*`, `workflow.*`), so they are "add a case", not "build a
backend".

---

## Original diagnosis (section 1 superseded by the correction above)

Driven through CDP against the installed app (`--remote-debugging-port=9222`),
not inferred. Three independent causes, only one of them structural.

### 1. The client and the backend speak different languages (WRONG — see above)

The restored client is Buzz's, so it calls Tauri commands in snake_case:

```
window.dobiusCommunications.invoke("get_identity")
  -> {"ok":false,"error":{"code":"command_not_allowed",
      "message":"Unsupported command: get_identity"}}
```

The gateway allowlist (`src/shared/communications-bridge.ts:44`) contains **144
methods, every one of them dotted** — `agent.list`, `canvas.getNote`,
`communications.identity.signOut`. Zero are snake_case. The same bridge, same
session, works perfectly when given a name it knows:

```
window.dobiusCommunications.invoke("agent.list")
  -> {"ok":true,"result":{"agents":[{"name":"Adam", ...}]}}
```

So the bridge is fine and the backend is fine. **The vocabularies do not
overlap at all.** The client issues **187 distinct snake_case commands**; every
single one is rejected before it reaches the dispatcher.

`tauri-shim/core.ts` bridges the *transport* (Tauri `invoke` -> our IPC
channel) but passes the command string through untranslated. The missing piece
is a vocabulary map, and it was never built because until now nothing spoke
Buzz's names — the old `buzz/native/` stub was written against the dotted names
directly, which is why it worked and this does not.

**Where the boot hangs, concretely:** `useIdentityQuery` calls `get_identity`
(`shared/api/hooks.ts:5` -> `shared/api/tauriIdentity.ts:24`). It fails,
react-query retries once, and while unsettled `machineOnboarding.ts:213`
computes `stage = "blocking"`, which returns `<AppLoadingGate/>`
(`app/App.tsx:664`).

**Partial implementation already exists, in the wrong place.** The verification
harness pairs 50 Buzz command names with working in-process implementations
(`src/main/communications/verify/relay-world-ops.ts`, wired in
`verify/*.scenarios.ts` as `direct:` handlers) — `get_identity` and
`is_shared_identity` among them. **45 of the client's 187 commands are already
covered there.** They are not reachable from the gateway, and `verify/` is
explicitly excluded from `config/tsconfig.node.json`, so production code cannot
import them where they currently sit.

### 2. The loading mark fades to nothing (my regression, this branch)

`shared/ui/dobius-logo/dobius-logo.css` gives `LoadingMark` the
`dobius-logo--breathe` keyframes, which run `opacity: 0 -> 1 -> 0` forever. On a
gate that never resolves, that is exactly the reported blinking. The bee sprite
it replaced never dropped below full opacity — it animated wing transforms, not
opacity. My substitution changed a solid mark into a disappearing one.

### 3. Public assets were never carried over (pre-existing)

Console shows `net::ERR_FILE_NOT_FOUND` for `/pow/poof1..5@3x.png` and
`/pow/plop.m4a`. The client references 18 paths under `public/` that live in the
deleted vendor tree and were not restored:

- `/pow/*` — poof burst frames + sound
- `/onboarding/starter-team/*.png` — starter agent portraits
- `/harness-logos/*` — 8 runtime marks
- `/landing/buzz-wordmark.png`

**Also my regression:** the whole-word rename rewrote the *asset paths* as well
as the copy, so the client now asks for `iris.png` / `atlas.png` / `sage.png`
while the upstream files are `fizz.png` / `honey.png` / `bumble.png`. Restoring
the assets under their original names would still 404.

## Fix

Split by size, because only the first two are repairs.

**A. Loading mark (this cycle).** Replace the fade-to-zero keyframes with a
pulse whose floor is visible. Nothing that renders the mark should ever animate
it to `opacity: 0`.

**B. Public assets (this cycle).** Restore the 18 referenced files from
`fdcffaaf^` into `src/renderer/public/`, renaming the three starter-team
portraits to the names the rebranded code now asks for. Drop
`landing/buzz-wordmark.png` — the wordmark is Buzz's and is replaced by the
Dobius mark.

**C. Command vocabulary (NOT this cycle — needs a decision).** Options:

1. *Boot path only* — move the ~45 covered implementations out of `verify/` into
   a production module, add their snake_case names to the allowlist, and map
   them in the shim. Gets the client past identity and rendering; most features
   still dead. Smallest change that shows a real UI.
2. *Full map* — all 187 commands. 45 have implementations to route to; ~142 need
   writing against the existing dotted RPC surface, including argument-shape
   translation in both directions. This is a build phase, not a repair.
3. *Reverse the map* — rewrite the client's ~52 API modules to call dotted
   methods directly and delete the shim's translation burden. Larger diff in the
   vendored tree, but removes a permanent translation layer.

Recommendation: **1 now** (to see whether anything else is broken behind the
gate, which we currently cannot know), then decide between 2 and 3 with that
evidence in hand.

## Rollback

A and B are additive; revert the commit. C is not started.
