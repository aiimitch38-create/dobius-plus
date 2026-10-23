# Independent ADAM production composition V4 review

**Verdict: PASS — bounded source review only.** V4 closes both reproduced V3 process-lifetime gaps: a referenced hold begins synchronously before startup/one-shot work and remains until a successful drain plus status/output handling, and isolated children show natural exit only after a true drain. The exact published-intent lost-ACK recovery still finds the committed child after database reopen with human approval permanently revoked, without a second submit, seal, or expiry renewal.

## Review identity and freeze

- Review task / dispatch: `task_1788a470460e` / `ctx_6a8b09d9bacb`.
- Current coordinator/runtime: `term_2958d5fd-ff36-4ae7-9f23-6ed32a748f54` / `6627a505-a9ea-4b59-90e7-d051eb153516`.
- Candidate author task / dispatch: `task_870200e6587d` / `ctx_65f0283a235a`.
- Canonical checkout / branch: `/Users/bayou/Projects (Code)/Dobius/dobius-plus`, `fix/channel-cost`.
- Author report: `plans/worker-monitor-20261014/BUILD2-adam-production-composition-candidate-v4.md`, SHA-256 `76eec5c0270d0466d01fb96690920cb53a18be72f0cff725c51b5871244eac7f`.
- Candidate manifest SHA-256 / aggregate: `ddb8bc73f8521af2563cf32cf1d67c1ae20c77fc3db7e65dfe7b22b24d38a96e`.
- Candidate patch SHA-256: `ff3ffd0ff9d138e04de3f58ecccc279c962c123755dd2fe831cf1e3d3c93db2d`.
- Preserved V1/V2/V3 manifest hashes: `31d705aed3d657f9436ed0d065c57625f8a5a1ece9d20466fe88499753a25a98`, `7fc192a3c8311f5b2d07b662a7cb506276b445741f15ebba9b82c94254c060d4`, `8ce0583a2f24ca3a3d61d97767c95b3e24676a44522741d3408fcb009555567c`.
- Immutable ROOT base and recovery wire contracts: `f31b56bec89ac9841afed587eea76e6f5ba085c800f0a26e7760ba60a7e26e6f` and `75d3cc984bd37cc2279ddcd3793c08c3b3554812c065250af06bf4b268ffb0ac`.

The 84 regular candidate files (81 source/test entries plus three support files) exactly match manifest hashes and byte counts; there are no symlinks or extras. All 21 changed/new source entries were checked against the read-only ADAM baseline: nine modified-file baseline hashes match and twelve new paths are absent as declared. V1, V2, and V3 manifests and every listed file also match their preserved hashes with no extra files. The patch and both wire contracts match their declared hashes.

## Lifecycle review

The production entrypoint in `service/src/main.ts:43-69` calls `runProcessLifecycle`; the main catch path uses the independently holding `drainUntilStopped` at `:72-92`. `runProcessLifecycle` acquires `retainProcessLifetime()` synchronously at `process-lifecycle.ts:186-188`, before entering its async body, and releases exactly once in `finally:207-209`. The hold is a referenced interval (`process-lifecycle-hold.ts:1-11`), so it spans promise-only work and `service.stop()`'s unref'd deadlines.

- Signal handlers install before startup (`process-lifecycle.ts:82-89`). A signal during startup retains a referenced reporting interval until startup settles (`:99-118`), suppresses ready publication, then drains. A signal during once/prepare does not lose ownership while `execute()` is pending because the outer hold began first; it drains only after the operation settles (`:134-157`). Late operation errors are recorded and yield exit code 1 only after safe drain.
- The drain helper itself owns a hold (`:212-228`), serializes stop attempts (`:229-243`), catches false/rejected results, retains ownership across retry diagnostics and referenced backoff (`:244-257`), and releases only after stop returns true. No arbitrary retry limit, force-exit, or early success status is present.
- Once/prepare JSON and success status occur after drain and handler cleanup (`:158-183`). Repeated signals coalesce (`:66-70`); the isolated child tests verify one stopping callback. The five child-test cases cover false then true, rejected then true, direct-drain retry, successful once/prepare, and late once/prepare failures. Each fixture's stop/execute delay timer is unref'd, stdin is ignored, no IPC is used, and signals are fake callbacks. Each child must have `signal === null`; a separate parent watchdog kills only a hung test-owned child. Thus the test runner's own liveness does not keep the child alive.
- Callback/error paths preserve shutdown ownership: `onError` exceptions are caught and diagnostics use a swallowing writer (`:39-45,71-80`); `onReady` errors become primary failure before drain (`:125-132`); `onStopping` and signal-removal exceptions are diagnosed without skipping drain (`:145-168`); stdout publication is after drain, and a thrown write enters the lifecycle failure path (`:182-183,193-206`). The production `main.ts` exit-code callback assigns only `0` or `1` to `process.exitCode` (`:58-60`); no arbitrary callback is used in production there.
- ADAM service stop can return false while approved work, HTTP handlers, or callbacks remain unsettled and retains the database in that case (`service.ts:309-332`). The lifecycle hold survives its unref'd deadline (`:320-325`) and retry. Publisher stop aborts active work and waits for active and unsettled operations (`approved-decision-operation.ts:101-120`); repeated stop remains safe. The service's periodic work timers are unref'd/cleared, so successful stop plus release permits natural process exit.

The V2 recovery invariant is preserved in the V4 production publisher and test. The regression `recovers a post-commit lost ACK after permanent decision revocation through lookup only` commits binding and child before dropping the ACK, advances beyond approval expiry, closes/reopens the database, and calls recovery while decision resolution remains at one. It observes one exact lookup, one original submit/seal total, unchanged intent expiry, and the same stored child (`dobius-cloud-approved-decision-publisher.test.ts:301-332`). A null lookup with revoked decision does not submit again (`:334-349`); revoked service credentials prohibit lookup (`:351-376`). This preserves lookup-only recovery separately from freshness checks for a new submission.

No blocking source issue was found in the requested V4 lifecycle scope. As in the author receipt, a never-settling once/prepare operation or permanently incomplete stop deliberately retains the process indefinitely; that is fail-safe ownership, not bounded termination. No production account, provider, endpoint, credential, keychain, ADAM service/database, process signal, or Dobius runtime was exercised.

## Independent validation

I rebuilt and ran all nine manifest-listed suites once with existing dependencies, fresh temporary output, and Node v24.18.0. The command was executed from the canonical repository root; it used no installation:

```sh
python3 - <<'PY'
import os, subprocess, tempfile, sys
repo='/Users/bayou/Projects (Code)/Dobius/dobius-plus'
cand=repo+'/plans/worker-monitor-20261014/adam-production-composition-candidate-v4'
service=cand+'/service'
out=tempfile.mkdtemp(prefix='adam-v4-review-20261016-',dir='/private/tmp')
os.symlink('/Users/bayou/dobius/projects/ADAM/node_modules',out+'/node_modules')
inputs=['dobius-cloud-approved-decision-publisher.test.ts','dobius-cloud-approved-decision-shutdown.test.ts','dobius-cloud-approved-payload.test.ts','dobius-cloud-child-submit.test.ts','dobius-cloud-intents.test.ts','dobius-cloud-receipt-recovery.test.ts','dobius-cloud-receipts.test.ts','process-lifecycle.test.ts','process-lifecycle-child.test.ts','process-lifecycle-child-fixture.ts']
args=['./dobius/node_modules/.bin/esbuild']+[service+'/tests/'+x for x in inputs]+['--bundle','--platform=node','--format=esm','--target=node24','--external:yaml',f'--outbase={service}',f'--outdir={out}']
env=os.environ.copy();env['NODE_PATH']='/Users/bayou/dobius/projects/ADAM/node_modules'
build=subprocess.run(args,cwd=repo,env=env)
if build.returncode:sys.exit(build.returncode)
node='/Users/bayou/homebrew/opt/node@24/bin/node'
tests=[out+'/tests/'+x.removesuffix('.ts')+'.js' for x in inputs if x.endswith('.test.ts')]
sys.exit(subprocess.run([node,'--experimental-test-isolation=none','--test','--test-concurrency=1',*tests],cwd=repo,env=env).returncode)
PY
```

Output directory: `/private/tmp/adam-v4-review-20261016-lq7nieub`. Esbuild exited 0; Node v24.18.0 exited 0 with 70 passed, 0 failed, across the nine test files. The child assertions verify natural exit rather than watchdog signal. I did not rerun the author's strict typecheck, lint, format, or patch-application checks; those remain author-recorded, not independently claimed.

## Limits

This is a bounded source/candidate PASS, not an applied, packaged, live, or production-bridge acceptance. The candidate remains unapplied to ADAM; the feature remains default-disabled and no production authority/enrollment was enabled. ROOT must separately verify integration and any live operation under its authorized gates. AWS remains deferred and the historical Storage queue remains paused.
