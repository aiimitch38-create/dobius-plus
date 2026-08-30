# REPAIR — Communications tab shows a flashing logo and never opens

## Symptoms

Clicking **Communications** shows the Dobius mark blinking on a white screen.
Nothing else ever renders.

## Diagnosis

Driven through CDP against the installed app (`--remote-debugging-port=9222`),
not inferred. Three independent causes, only one of them structural.

### 1. The client and the backend speak different languages (structural)

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
