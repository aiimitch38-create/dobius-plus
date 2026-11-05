# Failed tasks release their worker dispatch

The current runtime keeps an active dispatch after `task-update --status failed`, so an idle worker cannot receive its next job. The source fix fails the active context after recording the task failure, preserving the result and failed task state. It does not promote dependent work or add a successful completion. Repeated failure updates leave the failure counter and a newer worker dispatch alone; explicit retries retain the circuit breaker.

Validation: Node 24 focused orchestration DB and new regression suites passed 66 tests across two files. Scoped lint and formatting passed. This source change is not installed in the running desktop. The current BUILD2 correction continues its original dispatch with an explicit module ownership extension; the undelivered replacement task was retired.

No runtime database was edited directly, no unrelated queue was reset, and no build, install or live feature activation occurred. AWS remains deferred and historical Storage remains paused.
