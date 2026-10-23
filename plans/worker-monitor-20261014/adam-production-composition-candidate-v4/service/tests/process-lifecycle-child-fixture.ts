import {
  drainUntilStopped,
  runProcessLifecycle,
  type EntrypointMode,
  type ShutdownSignal,
} from "../src/runtime/process-lifecycle.js";

const scenario = process.argv[2] ?? "";
const handlers = new Map<ShutdownSignal, () => void>();
const emit = (text: string): void => {
  process.stdout.write(`${text}\n`);
};
const delayWithoutKeepingAlive = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });

function modeFor(value: string): EntrypointMode {
  return value.startsWith("once-") ? "once" : value.startsWith("prepare-") ? "prepare" : "service";
}

function signal(signalName: ShutdownSignal): void {
  handlers.get(signalName)?.();
}

async function stopFor(value: string, call: number): Promise<boolean> {
  emit(`STOP_${call}_PENDING`);
  await delayWithoutKeepingAlive(value === "stop-false" || value === "stop-rejected" ? 120 : 30);
  if (value === "stop-false" && call === 1) {
    emit("STOP_FALSE");
    return false;
  }
  if (value === "stop-rejected" && call === 1) {
    emit("STOP_REJECTED");
    throw new Error("synthetic first stop rejection");
  }
  emit("STOP_TRUE");
  return true;
}

async function executeFor(value: string): Promise<unknown> {
  emit("EXECUTE_PENDING");
  signal("SIGTERM");
  signal("SIGINT");
  await delayWithoutKeepingAlive(120);
  emit("EXECUTE_SETTLED");
  if (value.endsWith("failure")) throw new Error("synthetic late operation failure");
  return value.startsWith("prepare-") ? { prepared: true } : { reconciled: true };
}

async function main(): Promise<void> {
  let stopCalls = 0;
  let stoppingCalls = 0;
  if (scenario === "direct-drain") {
    await drainUntilStopped(
      () => stopFor("stop-false", ++stopCalls),
      (text) => process.stderr.write(text),
      { retryBaseMs: 10, retryMaxMs: 10 },
    );
    return;
  }
  const mode = modeFor(scenario);
  await runProcessLifecycle({
    mode,
    start: async () => undefined,
    execute: () => executeFor(scenario),
    stop: async () => stopFor(scenario, ++stopCalls),
    onSignal: (name, handler) => {
      handlers.set(name, handler);
      return () => handlers.delete(name);
    },
    stdout: emit,
    stderr: (text) => process.stderr.write(text),
    setExitCode: (code) => {
      process.exitCode = code;
    },
    onReady: () => {
      emit("READY");
      signal("SIGTERM");
      signal("SIGINT");
    },
    onStopping: () => emit(`STOPPING_${++stoppingCalls}`),
    onError: (error) => process.stderr.write(`OPERATION_ERROR ${String(error)}\n`),
    retryBaseMs: 10,
    retryMaxMs: 10,
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`FIXTURE_ERROR ${String(error)}\n`);
  process.exitCode = 99;
});
