# ADAM approved-payload candidate v2

This is a new review candidate in the Dobius workspace. The prior v1 candidate is immutable and remains available at `adam-approved-payload-candidate/`; this directory contains the reviewed project-authorization correction. The unified patch is relative to the captured, unchanged ADAM baseline and changes only six scoped service source/test paths. Other copied regular files are context/support mirrors. `fingerprint-compatibility.test.ts` is a candidate-only Dobius parity test and is excluded from the ADAM patch.

The parser now requires the approved child `projectId` to equal the authorized request project before sealing. Existing-row validation and consume independently recheck stored payload project against the binding project; a matching recomputed digest does not authorize a cross-project payload. The existing canonical fingerprint, parent/context/instance/expiry checks, atomic publication, duplicate/replay rules, legacy identity-only refusal, and sealed capability handling remain in place.

The only dependency link is `node_modules` to the already-installed ADAM dependency tree for local resolution; it was not modified and no install ran. Focused tests were bundled with Dobius's existing esbuild into `/private/tmp/adam-approved-payload-candidate-v2-tests` because the tsx launcher is blocked by sandbox IPC `EPERM`.

```sh
./dobius/node_modules/.bin/esbuild plans/worker-monitor-20261014/adam-approved-payload-candidate-v2/service/tests/dobius-cloud-intents.test.ts plans/worker-monitor-20261014/adam-approved-payload-candidate-v2/service/tests/dobius-cloud-approved-payload.test.ts plans/worker-monitor-20261014/adam-approved-payload-candidate-v2/fingerprint-compatibility.test.ts --bundle --platform=node --format=esm --target=node24 --outbase=plans/worker-monitor-20261014/adam-approved-payload-candidate-v2 --outdir=/private/tmp/adam-approved-payload-candidate-v2-tests
/Users/bayou/homebrew/opt/node@24/bin/node --experimental-test-isolation=none --test /private/tmp/adam-approved-payload-candidate-v2-tests/service/tests/dobius-cloud-intents.test.js /private/tmp/adam-approved-payload-candidate-v2-tests/service/tests/dobius-cloud-approved-payload.test.js /private/tmp/adam-approved-payload-candidate-v2-tests/fingerprint-compatibility.test.js
```

The strict no-emit TypeScript command, manifest, exact patch and frozen file hashes are recorded in `manifest.json`. This candidate has not been applied to ADAM; a ROOT-authorized ADAM checkout must apply/review it and run native migration/tests. No live service, producer, sealer, database, or runtime activation is included.
