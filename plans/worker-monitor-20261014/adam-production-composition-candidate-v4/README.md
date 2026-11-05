# ADAM production composition candidate V4

V4 is a new staged correction to V3's process ownership. A referenced interval is acquired synchronously at lifecycle entry and held through startup, once/prepare execution, every stop attempt and retry, and output/status finalization. The exported `drainUntilStopped` helper also owns a referenced hold for direct callers; each hold is released once only after a `true` drain.

Once/prepare work is allowed to finish after a shutdown signal. The process and its shared database remain owned while that operation is pending; only after it settles does serialized shutdown drain begin. Late operation failures retain exit status 1, no success JSON is emitted before successful drain, and duplicate signals coalesce. Rejected/false stops retain ownership through bounded backoff and retry. Successful drain releases all lifecycle holds so a clean child exits naturally.

The child-process regressions invoke the production lifecycle helper using fake signal callbacks and unref'd fixture timers for pending stop/operation work. They run with ignored stdin and no IPC, and the parent watchdog can kill only these test-owned children. A frozen-V3 probe still exits before `RETRY` or `STOP_CALLED`; V4's corresponding cases reach true drain and exit naturally.

V1, V2 and V3 candidate directories are preserved. This V4 patch remains default-disabled, unapplied to ADAM, and has not been installed or live-tested. It adds no provider/enrollment authority and does not authorize service/account/head changes.
