# ADAM production composition candidate V2

This additive candidate preserves the reviewed V1 directory and stages two corrections: bounded/cancellable approved-decision operations with honest service shutdown, and read-only exact-child lookup for post-commit lost-ack recovery after decision revocation.

The shared approved-intent request remains unchanged. Recovery uses the separately reviewed `adam.lookupApprovedIntent` wire contract and a still-current service credential; it does not require the original human decision after an exact published intent exists. A `null` lookup permits a new submit only after the original decision is freshly resolved, remains exact/current and unexpired, and the immutable published DTO passes its normal checks.

The operation runner bounds provider and CLI waits, propagates cancellation and generation context, and retains an unsettled-operation fence when an injected provider ignores abort. Service shutdown stops timers, aborts the publisher before awaiting HTTP close, drains tracked callbacks within one deadline, and closes the shared database only when every drain is proven. An incomplete drain returns `false`, writes a bounded stderr diagnostic, and leaves the database open for a later retry.

Default dispatch remains disabled because the production constructor supplies no decision/custody authorities. This is a candidate patch only; it has not been applied to ADAM or live-tested.
