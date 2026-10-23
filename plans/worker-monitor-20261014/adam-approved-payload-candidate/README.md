# ADAM approved-payload candidate

This is a review candidate, not the live ADAM checkout. `patches/adam-approved-payload.patch` contains only source and focused-test changes intended for `/Users/bayou/dobius/projects/ADAM/service`; unchanged existing files in `service/` are a bounded context mirror. `fingerprint-compatibility.test.ts` is a candidate-only cross-repository fixture and is intentionally not part of the ADAM patch.

The only external link is `node_modules`, pointing at the already-installed ADAM dependency tree for resolution. It was not modified and no package install ran. Test support copies (`src/db/database.ts`, `src/jobs/store.ts`, `src/jobs/states.ts`, `src/dobius-cloud/receipt-migration.ts`) are unchanged and excluded from the patch.

The candidate suite was bundled with the existing Dobius esbuild binary to `/private/tmp/adam-approved-payload-candidate-tests` because the installed tsx launcher attempts to open a local IPC pipe, which this sandbox rejects with EPERM. Run:

```sh
./dobius/node_modules/.bin/esbuild plans/worker-monitor-20261014/adam-approved-payload-candidate/service/tests/dobius-cloud-intents.test.ts plans/worker-monitor-20261014/adam-approved-payload-candidate/service/tests/dobius-cloud-approved-payload.test.ts plans/worker-monitor-20261014/adam-approved-payload-candidate/fingerprint-compatibility.test.ts --bundle --platform=node --format=esm --target=node24 --outbase=plans/worker-monitor-20261014/adam-approved-payload-candidate --outdir=/private/tmp/adam-approved-payload-candidate-tests
/Users/bayou/homebrew/opt/node@24/bin/node --experimental-test-isolation=none --test /private/tmp/adam-approved-payload-candidate-tests/service/tests/dobius-cloud-intents.test.js /private/tmp/adam-approved-payload-candidate-tests/service/tests/dobius-cloud-approved-payload.test.js /private/tmp/adam-approved-payload-candidate-tests/fingerprint-compatibility.test.js
```

A focused strict TypeScript command/result and source hashes are in `manifest.json`. Applying this patch to ADAM and rerunning its native tests/typecheck remain ROOT-owned follow-up; this candidate has not been applied, migrated against a live database, or wired to a producer/service route.
