import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AdamService } from "./runtime/service.js";
import {
  drainUntilStopped,
  runProcessLifecycle,
  type EntrypointMode,
  type ShutdownSignal,
} from "./runtime/process-lifecycle.js";

const stamp = (): string => new Date().toISOString();

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "../..");
const dataDir = process.env.ADAM_DATA_DIR || join(projectRoot, "service", "data");
const port = Number(process.env.ADAM_PORT || 8791);
const service = new AdamService({
  dataDir,
  port,
  commitmentsPath: join(projectRoot, "COMMITMENTS.md"),
  promptProfilesPath: join(projectRoot, "config", "prompt-profiles.yaml"),
  modelRoutingPath: join(projectRoot, "config", "model-routing.yaml"),
});

function modeFromArgs(args: readonly string[]): EntrypointMode {
  if (args.includes("--once")) return "once";
  if (args.includes("--prepare-tomorrow")) return "prepare";
  return "service";
}

async function operationFor(mode: EntrypointMode): Promise<unknown> {
  if (mode === "once") return service.reconcile();
  if (mode === "prepare") {
    return service.supervisor.prepareTomorrow({
      channel: "cli",
      senderId: "carson",
      dedupeKey: `cli:${new Date().toISOString().slice(0, 10)}`,
    });
  }
  return undefined;
}

async function main(): Promise<void> {
  const mode = modeFromArgs(process.argv);
  let stoppingLogged = false;
  await runProcessLifecycle({
    mode,
    start: () => service.start(),
    execute: () => operationFor(mode),
    stop: (timeoutMs) => service.stop(timeoutMs),
    onSignal: (signal: ShutdownSignal, handler) => {
      const listener = (): void => handler();
      process.on(signal, listener);
      return () => process.off(signal, listener);
    },
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    setExitCode: (code) => {
      process.exitCode = code;
    },
    onReady: () => process.stdout.write(`${stamp()} ADAM service listening on 127.0.0.1:${port}\n`),
    onStopping: () => {
      if (stoppingLogged) return;
      stoppingLogged = true;
      process.stderr.write(`${stamp()} ADAM service stopping\n`);
    },
    onError: (error) =>
      process.stderr.write(`${stamp()} ${error instanceof Error ? error.stack : String(error)}\n`),
  });
}

void main().catch((error: unknown) => {
  try {
    process.stderr.write(
      `${stamp()} lifecycle setup failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  } catch {
    // Preserve shutdown ownership even if stderr is unavailable.
  }
  void drainUntilStopped(
    (timeoutMs) => service.stop(timeoutMs),
    (text) => {
      try {
        process.stderr.write(text);
      } catch {
        // Retry remains active even if diagnostics cannot be written.
      }
    },
  ).then(() => {
    process.exitCode = 1;
  });
});
