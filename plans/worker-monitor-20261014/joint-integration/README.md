# ADAM–Dobius synthetic integration harness

`run.mjs` bundles the exact V4 ADAM candidate and reviewed Dobius main-process modules from caller-supplied roots, then runs `joint-integration.test.mjs` with Node's test runner. The only persistent state is two isolated temporary SQLite databases per scenario; the runner removes its temporary bundle and the suite removes each scenario's databases during teardown.

From the canonical `dobius-plus` repository root, run:

```sh
/Users/bayou/homebrew/opt/node@24/bin/node plans/worker-monitor-20261014/joint-integration/run.mjs \
  --repo '/Users/bayou/Projects (Code)/Dobius/dobius-plus' \
  --adam-service '/Users/bayou/Projects (Code)/Dobius/dobius-plus/plans/worker-monitor-20261014/adam-production-composition-candidate-v4/service'
```

The test transport parses the actual candidate CLI's stdin JSON and calls the actual Dobius RPC method handler directly. Trusted enrollment/peer evidence and seal/unseal crypto are synthetic fixture seams; no actual CLI process, RPC socket, OS key store, service enrollment, user database, or live ADAM checkout is accessed. The V4 candidate remains unapplied and the default production bridge remains unavailable without real enrollment and transport composition.
