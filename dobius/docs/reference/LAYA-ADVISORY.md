# Laya advisory foundation

The main-process advisory foundation is read-only and deliberately unavailable
until a current deployment gate proves an authenticated, evaluated Laya service.
The C08 offline harness is not that gate: its corpus is synthetic and its report
is aggregate evaluation evidence, not per-job inference. No fallback classifier
or hard-coded suggestion is presented as Laya output.

## Boundary

Callers submit only a surface and opaque subject IDs. An injected main-process
authority reader resolves current job, board, agent, data, storage, or verification
facts, computes freshness and eligible labels, and returns bounded enum/scalar facts
plus digest references. Caller-supplied facts and eligibility are rejected. Raw
terminal output, notes, secrets, and subject IDs are not serialized into the
provider request. The authority's raw `sourceRevision` stays internal; the
provider receives a domain-separated HMAC-SHA-256 revision token made with a
random per-service key. That token is stable only for the same revision and key.
It limits raw revision disclosure and cross-service correlation; it does not
anonymize facts or prove that those facts contain no identifying information.

The six discriminated surfaces are `job-routing`, `kanban`, `agents`, `data`,
`storage`, and `verification`. Job-routing and storage choices are per-request
opaque aliases generated from the authoritative eligible set. The service validates
all output labels and normalized probabilities and checks the exact
source/checkpoint/evaluation/schema/policy binding. The provider's opaque revision
token is echoed and validated; the raw source revision remains internal.

## Coherent authority and gate currentness

The service requires a trusted, synchronous main-owned `authorityEpoch.current()`
ticket before its first asynchronous read. Every writer that changes authoritative
facts or the deployment gate must advance that same monotonic safe-integer epoch
before publishing the change; tickets must never reset or be reused. The service
checks the ticket before inference and again synchronously immediately before
persisting, caching, or returning a suggestion. Missing, malformed, or changed
tickets fail closed, and the service does not infer without an initial ticket.
Two independent asynchronous reads alone cannot prove that authority and gate
were current together at return. No production epoch adapter is wired yet, so the
default service remains unavailable.

Deterministic policy remains authoritative. It vetoes ineligible targets, unsafe
archive candidates, permission-gate conflicts, missing live process evidence, hard
verification failures, and any attempt to claim completion or authorize cleanup.
Low confidence and provider abstention remain abstentions. The service cannot mutate
jobs, grant permissions, clean storage, or execute advice.

## Provider and evaluation gate

The default provider is unavailable. A main-process provider must also report
support for the requested classifier surface. Before a suggestion can be returned,
the trusted deployment-gate reader must provide an unexpired strict gate containing
the pinned source and checkpoint revisions, independent human-labeled held-out
report digest, per-surface sample counts and thresholds, zero policy violations,
passed thresholds and calibration review, tested fallback, authenticated provider
status, two-client readback, and privacy review. C08's synthetic aggregate cannot
satisfy this contract. Missing or unsupported classifier heads, missing/expired
gates, malformed responses, timeout, quota/backpressure, or stale sources return
`unavailable`; they do not create a suggestion.

Requests reserve capacity and quota before the first asynchronous authority read;
one deadline and abort signal cover authority, provider availability, gate, inference,
and post-inference revalidation. A timed-out request returns unavailable, but keeps its
capacity slot until every started dependency settles, so an abort-ignoring provider
cannot allow unbounded hidden work. Expired pending calls cause bounded backpressure.
The request digest binds the full accepted deployment gate, including deployment ID,
thresholds, sample counts, and issue/expiry times; changing any gate field cannot reuse
cached advice. In-flight duplicate exact digests coalesce; only exact current read-only
inputs under the same authority epoch may use the short-lived bounded cache. Before a
cache hit or coalesced result is returned, the service rereads source authority and
deployment-gate provenance under the same request deadline, then synchronously checks
the shared epoch. A change during any await invalidates the result. Concurrency, quota,
deadline, and cache bounds reject non-integer or non-finite configuration values.

A suggestion is exposed only after its metadata has been durably appended to a private
hash-chained journal. The journal requires an absolute path and uses an exclusive
sibling lock across verification and append. A busy or unknown lock is preserved and
refused; stale locks are never removed by age guesses. The journal stores decision IDs,
input/evidence digests, revisions, confidence, timing, vetoes, and later
outcome/correction codes. It stores no raw evidence and is separate from job state.

## Verification limits

Focused contract/service/policy/journal tests exercise the typed boundary with
explicit test-only provider fixtures; these fixtures do not claim inference or model
accuracy. Runtime RPC, preload, renderer/mobile readback, model deployment, real
held-out evaluation, and live service acceptance are separate follow-up gates.
Until those gates pass, the foundation remains undeployed and all application
behavior continues to use deterministic sources.
