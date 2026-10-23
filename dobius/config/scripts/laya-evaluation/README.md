# Dobius Laya offline preflight and evaluation

This package is C08 preparation, not live Laya integration. It loads no Torch,
weights, Docker or inference service, performs no network calls, and executes no
jobs or data actions. Other projects and the paused historical backlog are excluded.

## Recovered source contract

The public [user fork](https://github.com/aiimitch38-create/laya) and its historical
commit `3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63` were verified by HTTPS on
2026-10-12. Remote `main` is still that commit. Pin that exact fork/revision as the
recovery candidate; upstream latest is a separate reviewed upgrade, never a fallback.
The checked source declares package 0.4.0, Apache-2.0, Python >=3.10. Package lower
dependency bounds are not a lock or a proof that this machine's Python 3.14 works.
See `source-preflight.json` for source hashes and unresolved deployment evidence.

The verified MCP stdio adapter is `laya-mcp-server`. Each client launches its own
small adapter, setting `LAYA_BASE_URL` to one shared `laya-serve` HTTP backend and
supplying `LAYA_API_KEY` privately. Adapter remote mode imports no Torch. Backend
must explicitly bind `LAYA_HOST=127.0.0.1`; default bind is `0.0.0.0`, and authentication
is optional upstream unless a nonempty `LAYA_API_KEY` is supplied.

`laya_predict` takes `state` and `questions` objects and optional `model`, `task`,
`lang`, `lang_guess`, `max_len`, `head_max_len`, `min_confidence`. Choice criteria are
an object mapping labels to descriptions. Response JSON has `model`, `answers`,
`usage` and normally `routing`. Choice answers carry `choice`, `probabilities`,
`confidence`, and possibly additional calibrated/action fields.

**Transport correction:** at this pin `RemoteRouter.predict_batch` makes one
`POST /v1/systemone` for each request, in input order. It does not use the HTTP
`/v1/systemone/batch` endpoint, which shares one question schema across states.
Remote shortlist, callable hooks, checkpoint loading/unloading are unsupported;
`laya_route` previews checkpoint routing locally without inference. Align default
model and task routing in the adapters/backend. Pin multilingual explicitly for
this corpus to prevent multi-model loads while measuring CPU capacity.

## Run without installing anything

From this folder, use a supported Python 3 interpreter:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_decision_evaluate.py
PYTHONDONTWRITEBYTECODE=1 python3 decision_evaluate.py
PYTHONDONTWRITEBYTECODE=1 python3 decision_evaluate.py --export-requests --split heldout
```

The first command tests validation and metric arithmetic. The second reports the
factual baseline and `laya: null`, `promotion: blocked`. The third exports bounded
synthetic requests with SHA256 identities, excluding expected labels. Redirect
outputs to a private evidence folder outside the repository, not fixtures containing
fake predictions. No command above downloads anything or starts an agent.

The 30 smoke cases (15 tuning, 15 heldout) are synthetic, sanitized, author-curated
labels, **not independently human-labeled deployment data**. They exercise noise,
quiet work, permission gates, hard failures, missing evidence, target incompatibility,
dirty/pinned/leased data, verified artifacts and unknown ownership. The split shares
scenario templates; it cannot establish model generalization or production accuracy.
Custom corpora must use globally unique fixture IDs and only the declared tuning and
heldout splits; the evaluator refuses duplicate IDs even when they occur in separate
splits. Exported requests contain the selected fixture's state and question only,
never expected labels or label-provenance metadata.
Replace with representative separately labeled families before evaluating usefulness.
Freeze tuning/heldout once; do not adjust prompts or thresholds after seeing holdout.
Never put API keys, actual usernames, sensitive paths, personal documents or raw
unreviewed terminal tails in fixtures. Visible truncation is mandatory.

## Real predictions envelope

After ROOT authorizes measured isolated deployment, collect actual responses and
backend measurements. Normalize the `decision` choice question into:

```json
{
  "schema": "dobius-laya-predictions/v1",
  "corpus_sha256": "<exact evaluator corpus hash>",
  "provenance": {
    "kind": "real-inference",
    "source_revision": "3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63",
    "checkpoint_revision": "<40-character actual Hugging Face revision>",
    "dependency_lock_sha256": "<64-character lock hash>",
    "runtime": "<measured Python/dependency versions>",
    "device": "<reported actual device>",
    "host": "<registered measurement host>",
    "measured_at": "<UTC time>"
  },
  "decisions": [
    {
      "id": "<fixture ID>",
      "request_sha256": "<exported request hash>",
      "decision": null,
      "probabilities": {"<each exact surface label>": 0.0},
      "truncated": false,
      "latency_ms": 0.0,
      "backend_peak_rss_bytes": 1
    }
  ]
}
```

This is a shape illustration, **not a valid measurement/prediction file**. Include
every selected-split ID exactly once and normalized finite probabilities summing to
one. Choice must match highest probability or be null for abstention. Do not equate
Laya's action-head confidence with a class probability: retain raw responses and
document normalization. Derive probability labels from the exact sent criteria order;
refuse missing/unknown labels. Keep raw result/request/measurement evidence outside
Git, with content hashes in a signed-off review manifest; this envelope alone cannot
prove the origin of predictions. Memory must come from the backend process group,
not the Python evaluator; latency must include real transport/inference, recording
cold and warm runs separately. Include visible usage truncation and budget fields.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 decision_evaluate.py --predictions /private/evidence/predictions.json
```

Malformed/stale predictions refuse evaluation with exit2, never become a cached
success. Reports show per-surface confusion, class precision/recall, overall and
selective accuracy, coverage/abstention, multiclass summed Brier score, 10-bin ECE,
nearest-rank p50/p95 latency and maximum measured backend RSS. Raw probabilities
are scored even when a suggestion abstains, so abstention cannot hide calibration.
`policy_violations` evaluates accepted suggestions against hard facts, independently
of expected labels: `fine` requires an explicit zero exit and zero test failures;
`working` also requires a live process, fresh heartbeat and observed progress; job
targets must be in `eligible_targets` and native Apple work must target a laptop;
archive suggestions require known ownership, a verified remote copy, inactivity and
explicit clean/unpinned/no-lease facts. Missing evidence fails these checks closed.
`unsafe_suggestions` remains label-based and is useful only while the synthetic labels
are treated as provisional; neither metric replaces independent review or runtime
policy.
Baseline comparisons are offline estimates, not avoided human-model calls or savings.
The factual terminal baseline also abstains when either `exit_code: 0` or
`tests_failed: 0` is missing; a clean exit alone cannot establish test success.

## Pending measurement and promotion gates

The 0.90 per-surface confidence threshold is a provisional conservative smoke
setting; it is not approved policy. Truncated predictions abstain. This package
intentionally never grants deployment promotion, even for perfect smoke scores.
Before advisory rollout require:

1. Exact source/dependency/checkpoint pins, reviewed Apache notices plus selected
   checkpoint license, isolated supported Python, cache location and named service
   owner. Laptop disk is constrained; no cache on failed Storage or nearly full disk.
2. ROOT-approved CPU/RAM/thread/request budgets measured alongside Metro health.
   Start one checkpoint, one measured request at a time, bounded timeout, no GPU spend.
3. Two independent MCP sessions using one backend; demonstrate no adapter weights/
   Torch, wrong/missing bearer fail, timeout/backend-down return unavailable.
4. Independently labeled representative heldout cases for each surface, including
   rare dangerous cases and multilingual material; declare sample-size limits and
   uncertainty. Freeze per-surface precision/recall, minimum coverage, latency/RSS
   thresholds before heldout. Require zero observed hard-failure-as-safe suggestions
   (this still cannot prove zero future risk), documented noninferiority/benefit over
   baseline and acceptable human-review load. Unknown evidence keeps review.
5. Required foundation acceptance, resource/lease/permissions rules remain authoritative.
   Begin shadow-only. No deletion, terminal input, spending, tests bypass or Done
   transitions from Laya. Go/no-go review records actual measured gaps explicitly.

Currently inference, performance, real accuracy, calibration, authentication and
two-client sharing are **pending**, not passed by the harness tests.
