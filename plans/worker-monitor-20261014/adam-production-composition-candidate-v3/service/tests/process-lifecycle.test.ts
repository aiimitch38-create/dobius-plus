import assert from "node:assert/strict";
import { it } from "node:test";
import {
  runProcessLifecycle,
  type EntrypointMode,
  type ProcessLifecycleOptions,
  type ShutdownSignal,
} from "../src/runtime/process-lifecycle.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("lifecycle did not reach expected state");
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

function fixture(mode: EntrypointMode) {
  const handlers = new Map<ShutdownSignal, () => void>();
  const retryWaiters: Array<() => void> = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const options = (overrides: Partial<ProcessLifecycleOptions> = {}): ProcessLifecycleOptions => ({
    mode,
    start: async () => undefined,
    stop: async () => true,
    onSignal: (signal, handler) => {
      handlers.set(signal, handler);
      return () => handlers.delete(signal);
    },
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    setExitCode: (code) => exitCodes.push(code),
    waitForRetry: async () => new Promise<void>((resolve) => retryWaiters.push(resolve)),
    retryBaseMs: 1,
    retryMaxMs: 4,
    ...overrides,
  });
  return {
    options,
    stdout,
    stderr,
    exitCodes,
    retryWaiters,
    handlerCount: () => handlers.size,
    signal: (signal: ShutdownSignal) => handlers.get(signal)?.(),
    releaseRetry: async () => {
      await waitFor(() => retryWaiters.length > 0);
      retryWaiters.shift()?.();
    },
  };
}

it("holds one-shot JSON and success exit until a false drain later succeeds", async () => {
  const f = fixture("once");
  let stopCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      execute: async () => ({ count: 2 }),
      stop: async () => ++stopCalls > 1,
    }),
  );
  await waitFor(() => stopCalls === 1);
  assert.deepEqual(f.stdout, []);
  assert.deepEqual(f.exitCodes, []);
  await f.releaseRetry();
  await run;
  assert.equal(f.stdout.length, 1);
  assert.match(f.stdout[0], /"ok": true/);
  assert.deepEqual(f.exitCodes, [0]);
});

it("emits prepare-tomorrow result only after the shutdown contract is true", async () => {
  const f = fixture("prepare");
  let stopCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      execute: async () => ({ scheduled: false, reason: "no work" }),
      stop: async () => ++stopCalls > 1,
    }),
  );
  await waitFor(() => stopCalls === 1);
  assert.deepEqual(f.stdout, []);
  await f.releaseRetry();
  await run;
  assert.match(f.stdout[0], /"reason": "no work"/);
  assert.deepEqual(f.exitCodes, [0]);
});

it("preserves one-shot operation errors and emits no JSON before/after draining", async () => {
  const f = fixture("once");
  let stopCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      execute: async () => {
        throw new Error("reconcile failed");
      },
      stop: async () => ++stopCalls > 1,
      onError: (error) => f.stderr.push(`${String(error)}\n`),
    }),
  );
  await waitFor(() => stopCalls === 1);
  assert.deepEqual(f.stdout, []);
  assert.deepEqual(f.exitCodes, []);
  await f.releaseRetry();
  await run;
  assert.match(f.stderr.join(""), /reconcile failed/);
  assert.deepEqual(f.stdout, []);
  assert.deepEqual(f.exitCodes, [1]);
});

it("keeps retrying persistent false without success output or exit", async () => {
  const f = fixture("prepare");
  let allowDrain = false;
  let stopCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      execute: async () => ({ prepared: true }),
      stop: async () => {
        stopCalls += 1;
        return allowDrain;
      },
    }),
  );
  for (let expected = 1; expected <= 4; expected += 1) {
    await waitFor(() => stopCalls === expected);
    assert.deepEqual(f.stdout, []);
    assert.deepEqual(f.exitCodes, []);
    if (expected < 4) await f.releaseRetry();
  }
  allowDrain = true;
  await f.releaseRetry();
  await run;
  assert.match(f.stdout[0], /"prepared": true/);
  assert.deepEqual(f.exitCodes, [0]);
});

it("recovers a rejected stop serially and reports the attempt", async () => {
  const f = fixture("once");
  let calls = 0;
  const run = runProcessLifecycle(
    f.options({
      execute: async () => "ok",
      stop: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary close failure");
        return true;
      },
    }),
  );
  await waitFor(() => calls === 1);
  assert.deepEqual(f.stdout, []);
  await f.releaseRetry();
  await run;
  assert.match(f.stderr.join(""), /temporary close failure/);
  assert.deepEqual(f.exitCodes, [0]);
});

it("coalesces duplicate signals during startup and drains only after startup settles", async () => {
  const f = fixture("service");
  const startup = deferred<void>();
  let startCalled = false;
  let stopCalls = 0;
  let activeStops = 0;
  let maxActiveStops = 0;
  let readyCalls = 0;
  let stoppingCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      start: () => {
        startCalled = true;
        assert.equal(f.handlerCount(), 2);
        return startup.promise;
      },
      stop: async () => {
        activeStops += 1;
        maxActiveStops = Math.max(maxActiveStops, activeStops);
        stopCalls += 1;
        await Promise.resolve();
        activeStops -= 1;
        return stopCalls > 1;
      },
      onReady: () => {
        readyCalls += 1;
      },
      onStopping: () => {
        stoppingCalls += 1;
      },
    }),
  );
  await waitFor(() => startCalled);
  f.signal("SIGTERM");
  f.signal("SIGINT");
  assert.equal(stopCalls, 0);
  startup.resolve();
  await waitFor(() => stopCalls === 1);
  assert.equal(readyCalls, 0);
  assert.equal(stoppingCalls, 1);
  await f.releaseRetry();
  await run;
  assert.equal(maxActiveStops, 1);
  assert.equal(stoppingCalls, 1);
  assert.deepEqual(f.exitCodes, [0]);
});

it("keeps a normal service alive after duplicate signals until its retry drains", async () => {
  const f = fixture("service");
  let stopCalls = 0;
  let readyCalls = 0;
  let stoppingCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      stop: async () => ++stopCalls > 1,
      onReady: () => {
        readyCalls += 1;
      },
      onStopping: () => {
        stoppingCalls += 1;
      },
    }),
  );
  await waitFor(() => readyCalls === 1);
  f.signal("SIGINT");
  f.signal("SIGTERM");
  await waitFor(() => stopCalls === 1);
  assert.deepEqual(f.exitCodes, []);
  await f.releaseRetry();
  await run;
  assert.equal(stoppingCalls, 1);
  assert.deepEqual(f.exitCodes, [0]);
});

it("preserves startup failure and nonzero exit through an incomplete drain", async () => {
  const f = fixture("service");
  const failure = new Error("startup failed");
  let stopCalls = 0;
  const run = runProcessLifecycle(
    f.options({
      start: async () => {
        throw failure;
      },
      stop: async () => ++stopCalls > 1,
      onError: (error) => f.stderr.push(`startup: ${String(error)}\n`),
    }),
  );
  await waitFor(() => stopCalls === 1);
  assert.deepEqual(f.exitCodes, []);
  assert.deepEqual(f.stdout, []);
  await f.releaseRetry();
  await run;
  assert.match(f.stderr.join(""), /startup failed/);
  assert.deepEqual(f.exitCodes, [1]);
});

it("does not publish prepare success when the operation failed", async () => {
  const f = fixture("prepare");
  const failure = new Error("prepare failed");
  const run = runProcessLifecycle(
    f.options({
      execute: async () => {
        throw failure;
      },
      onError: (error) => f.stderr.push(`${String(error)}\n`),
    }),
  );
  await run;
  assert.deepEqual(f.stdout, []);
  assert.match(f.stderr.join(""), /prepare failed/);
  assert.deepEqual(f.exitCodes, [1]);
});

it("installs signal ownership before startup and reports startup errors only after final safe exit", async () => {
  const f = fixture("service");
  let stopCalls = 0;
  let firstError: unknown;
  const run = runProcessLifecycle(
    f.options({
      start: async () => {
        assert.equal(f.handlerCount(), 2);
        throw new Error("early startup error");
      },
      stop: async () => ++stopCalls > 1,
      onError: (error) => {
        firstError = error;
      },
    }),
  );
  assert.equal(typeof f.signal, "function");
  await waitFor(() => stopCalls === 1);
  assert.match(String(firstError), /early startup error/);
  assert.deepEqual(f.exitCodes, []);
  await f.releaseRetry();
  await run;
  assert.deepEqual(f.exitCodes, [1]);
});
