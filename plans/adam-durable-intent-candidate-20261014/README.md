# ADAM atomic durable grant and intent candidate

This directory contains an unapplied source candidate for seal-before-publication ADAM grants. `DobiusCloudReceiptStore.issueGrantWithIntent()` requires an injected async sealer, prepares a stable-key request and immutable versioned identity, seals before SQLite locking, and then revalidates the instance, parent revision/project/state, uniqueness and original expiry inside one synchronous transaction. The transaction inserts the ordinary capability hash and sealed intent together; only a committed first issue returns the grant, while an exact retry returns a non-secret `existing` result.

Both duplicate paths load the intent, its binding and instance metadata. They verify canonical identity JSON and digest in both rows, current and persisted instance identity, request binding, expiry and pending state before returning `existing`; malformed, copied/rebound or mismatched records return a fixed conflict error without adding rows.

The candidate intentionally does not implement unseal, recovery transport, a production planner caller, lifecycle worker, or packaged activation. Tests use a deterministic fake sealer and synthetic temporary SQLite data; that evidence does not establish OS-backed encryption. The original ADAM checkout remains untouched.

See `baseline-manifest.json` for the nine prepared source/test baselines and `final-manifest.json` for target paths, exact candidate hashes, aggregate freeze, target baseline verification, test commands, and patch applicability.

Focused verification used explicit Node 24.18.0 in an isolated temporary staging directory, with the existing ADAM `node_modules` linked read-only:

```sh
/Users/bayou/homebrew/Cellar/node@24/24.18.0/bin/node --import /Users/bayou/dobius/projects/ADAM/node_modules/tsx/dist/loader.mjs --test /private/tmp/adam-intent-candidate.WfkZAI/service/tests/dobius-cloud-intents.test.ts /private/tmp/adam-intent-candidate.WfkZAI/service/tests/dobius-cloud-receipts.test.ts
/Users/bayou/homebrew/Cellar/node@24/24.18.0/bin/node /Users/bayou/dobius/projects/ADAM/node_modules/typescript/bin/tsc --noEmit -p /private/tmp/adam-intent-candidate.WfkZAI/tsconfig.json
```

Results: 18 focused tests passed (13 intent candidate tests and 5 receipt regressions); strict NodeNext typecheck passed. No dependency install, build, live service, original database, credential, private profile, Git mutation, or deployment was used.
