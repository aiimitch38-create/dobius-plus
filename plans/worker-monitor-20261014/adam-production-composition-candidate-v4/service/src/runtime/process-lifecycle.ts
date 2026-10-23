import { retainProcessLifetime } from "./process-lifecycle-hold.js";

export type EntrypointMode = "once" | "prepare" | "service";
export type ShutdownSignal = "SIGINT" | "SIGTERM";
export type ProcessLifecycleOptions = {
  mode: EntrypointMode;
  start: () => Promise<void>;
  execute?: () => Promise<unknown>;
  stop: (timeoutMs: number) => Promise<boolean>;
  onSignal: (signal: ShutdownSignal, handler: () => void) => () => void;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  setExitCode: (code: number) => void;
  onReady?: () => void;
  onStopping?: (signal: ShutdownSignal) => void;
  onError?: (error: unknown) => void;
  waitForRetry?: (milliseconds: number) => Promise<void>;
  stopTimeoutMs?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
};

type StartupOutcome = { state: "started" } | { state: "failed"; error: unknown };

const DEFAULT_STOP_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 10_000;
const STARTUP_KEEPALIVE_REPORT_MS = 15_000;

function defaultWait(milliseconds: number): Promise<void> {
  // This referenced timer keeps the process alive while an incomplete drain retries.
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function safeDiagnostic(write: (text: string) => void, text: string): void {
  try {
    write(text);
  } catch {
    // A broken diagnostic stream must not release process/database ownership.
  }
}

function boundedInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

/**
 * Owns service lifetime until stop confirms that no callback can use the DB.
 * False/rejected drains retry serially with referenced backoff timers.
 */
async function runProcessLifecycleOwned(
  options: ProcessLifecycleOptions,
  onDrained: () => void,
): Promise<void> {
  const removeSignalHandlers: Array<() => void> = [];
  let requestedSignal: ShutdownSignal | undefined;
  let primaryFailed = false;
  let resolveSignal!: () => void;
  const signalRequested = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const requestShutdown = (signal: ShutdownSignal): void => {
    if (requestedSignal) return;
    requestedSignal = signal;
    resolveSignal();
  };
  const reportError = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch (diagnosticError) {
      safeDiagnostic(
        options.stderr,
        `ADAM error reporting failed: ${describeError(diagnosticError)}\n`,
      );
    }
  };

  // Install before startup so a signal cannot bypass ownership while start runs.
  try {
    removeSignalHandlers.push(options.onSignal("SIGTERM", () => requestShutdown("SIGTERM")));
    removeSignalHandlers.push(options.onSignal("SIGINT", () => requestShutdown("SIGINT")));
  } catch (error) {
    primaryFailed = true;
    reportError(error);
  }
  let result: unknown;
  let operationSucceeded = false;
  if (primaryFailed) {
    // Signal ownership could not be installed; do not start more work.
  } else if (options.mode === "service") {
    const startup = Promise.resolve()
      .then(options.start)
      .then<StartupOutcome>(() => ({ state: "started" }))
      .catch((error: unknown): StartupOutcome => ({ state: "failed", error }));
    const first = await Promise.race([
      startup,
      signalRequested.then((): { state: "signal" } => ({ state: "signal" })),
    ]);
    let outcome: StartupOutcome;
    if (first.state === "signal") {
      // A promise alone cannot keep Node alive; retain a referenced timer until startup settles.
      const keepAlive = setInterval(
        () =>
          safeDiagnostic(
            options.stderr,
            "ADAM startup still owns resources while shutdown waits\n",
          ),
        STARTUP_KEEPALIVE_REPORT_MS,
      );
      try {
        outcome = await startup;
      } finally {
        clearInterval(keepAlive);
      }
    } else {
      outcome = first;
    }
    if (outcome.state === "failed") {
      primaryFailed = true;
      reportError(outcome.error);
    } else if (!requestedSignal) {
      try {
        options.onReady?.();
      } catch (error) {
        primaryFailed = true;
        reportError(error);
      }
    }
    if (!primaryFailed && !requestedSignal) await signalRequested;
  } else {
    try {
      if (!options.execute) throw new Error("entrypoint operation is unavailable");
      result = await options.execute();
      operationSucceeded = true;
    } catch (error) {
      primaryFailed = true;
      reportError(error);
    }
  }

  if (requestedSignal) {
    try {
      options.onStopping?.(requestedSignal);
    } catch (error) {
      safeDiagnostic(options.stderr, `ADAM shutdown logging failed: ${describeError(error)}\n`);
    }
  }
  await drainUntilStopped(options.stop, options.stderr, {
    stopTimeoutMs: options.stopTimeoutMs,
    retryBaseMs: options.retryBaseMs,
    retryMaxMs: options.retryMaxMs,
    waitForRetry: options.waitForRetry,
  });
  onDrained();

  for (const remove of removeSignalHandlers) {
    try {
      remove();
    } catch (error) {
      safeDiagnostic(
        options.stderr,
        `ADAM signal handler cleanup failed: ${describeError(error)}\n`,
      );
    }
  }
  if (primaryFailed) {
    options.setExitCode(1);
    return;
  }
  if (options.mode === "service") {
    options.setExitCode(0);
    return;
  }
  if (!operationSucceeded) {
    options.setExitCode(1);
    return;
  }
  options.stdout(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
  options.setExitCode(0);
}

export async function runProcessLifecycle(options: ProcessLifecycleOptions): Promise<void> {
  const releaseHold = retainProcessLifetime();
  let drained = false;
  try {
    await runProcessLifecycleOwned(options, () => {
      drained = true;
    });
  } catch (error) {
    safeDiagnostic(
      options.stderr,
      `ADAM lifecycle failed; process and database remain owned through drain: ${describeError(error)}\n`,
    );
    if (!drained) {
      await drainUntilStopped(options.stop, options.stderr, {
        stopTimeoutMs: options.stopTimeoutMs,
        retryBaseMs: options.retryBaseMs,
        retryMaxMs: options.retryMaxMs,
        waitForRetry: options.waitForRetry,
      });
    }
    options.setExitCode(1);
  } finally {
    releaseHold();
  }
}

/** Direct callers keep process ownership until a stop attempt confirms true. */
export async function drainUntilStopped(
  stop: (timeoutMs: number) => Promise<boolean>,
  stderr: (text: string) => void,
  settings: Pick<
    ProcessLifecycleOptions,
    "stopTimeoutMs" | "retryBaseMs" | "retryMaxMs" | "waitForRetry"
  > = {},
): Promise<void> {
  const releaseHold = retainProcessLifetime();
  const stopTimeoutMs = boundedInteger(settings.stopTimeoutMs, DEFAULT_STOP_TIMEOUT_MS);
  const retryBaseMs = boundedInteger(settings.retryBaseMs, DEFAULT_RETRY_BASE_MS);
  const retryMaxMs = Math.max(
    retryBaseMs,
    boundedInteger(settings.retryMaxMs, DEFAULT_RETRY_MAX_MS),
  );
  const wait = settings.waitForRetry ?? defaultWait;
  let retryDelayMs = retryBaseMs;
  for (;;) {
    let drained = false;
    try {
      drained = await stop(stopTimeoutMs);
    } catch (error) {
      safeDiagnostic(
        stderr,
        `ADAM shutdown attempt failed; process and database remain owned: ${describeError(error)}\n`,
      );
    }
    if (drained) {
      releaseHold();
      return;
    }
    safeDiagnostic(
      stderr,
      `ADAM shutdown incomplete; process and database remain owned; retrying in ${retryDelayMs}ms\n`,
    );
    try {
      await wait(retryDelayMs);
    } catch (error) {
      safeDiagnostic(
        stderr,
        `ADAM retry wait failed; retaining process ownership: ${describeError(error)}\n`,
      );
      await defaultWait(retryDelayMs);
    }
    retryDelayMs = Math.min(retryMaxMs, Math.max(retryBaseMs, retryDelayMs * 2));
  }
}
