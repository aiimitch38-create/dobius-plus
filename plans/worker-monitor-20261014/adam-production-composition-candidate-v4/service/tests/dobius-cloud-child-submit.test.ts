import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { submitAdamCloudChild } from "../src/dobius-cloud/child-submit.js";
import { runLocalChildSubmit } from "../src/dobius-cloud/child-submit-process.js";
import {
  AdamCloudChildSubmitError,
  type AdamCloudChildRequest,
  type AdamCloudSubmissionProof,
} from "../src/dobius-cloud/child-submit-contract.js";
import { canonicalCloudJobAdamSha256 } from "../src/dobius-cloud/receipt-contract.js";

class FixtureChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  killCount = 0;
  emitErrorOnKill = false;
  kill() {
    this.killed = true;
    this.killCount += 1;
    if (this.emitErrorOnKill) this.emit("error", new Error("synthetic kill error"));
    return true;
  }
  asProcess() {
    return this as unknown as ChildProcessWithoutNullStreams;
  }
}

function fixture() {
  const input = {
    requestKey: "request-1",
    taskId: "task-1",
    projectId: "project-1",
    workspaceId: "workspace-1",
    targetDeviceId: "worker-1",
    recipeId: "recipe-1",
    title: "Synthetic task",
    sourceRevision: "a".repeat(40),
    estimatedBytes: 10,
    dependencies: [],
  };
  const identity = {
    schemaVersion: 1 as const,
    bindingId: "b318dc55-1f52-4eaf-9e77-9b5ca269cf97",
    adamInstanceId: "adam-local",
    parentObjectiveId: "objective-1",
    parentObjectiveVersion: 2,
    projectId: input.projectId,
    contextDigest: "c".repeat(64),
    requestFingerprint: canonicalCloudJobAdamSha256(input),
    expiresAtMs: Date.now() + 60_000,
  };
  const request: AdamCloudChildRequest = {
    input,
    grant: { ...identity, capability: "synthetic-capability-value-not-a-secret-0001" },
  };
  const proof: AdamCloudSubmissionProof = {
    ready: true,
    submissionEnabled: true,
    localRuntime: true,
    runtimeId: "fixture-runtime",
    runtimeUserDataPath: join(tmpdir(), "dobius-fixture"),
    projectId: input.projectId,
    bindingId: identity.bindingId,
    requestFingerprint: identity.requestFingerprint,
    expiresAtMs: identity.expiresAtMs,
  };
  const response = {
    id: "rpc-fixture",
    ok: true,
    result: {
      job: {
        id: "child-1",
        state: "queued",
        projectId: input.projectId,
        requestKey: input.requestKey,
        taskId: input.taskId,
        workspaceId: input.workspaceId,
        targetDeviceId: input.targetDeviceId,
        recipeId: input.recipeId,
        sourceRevision: input.sourceRevision,
      },
    },
    _meta: { runtimeId: proof.runtimeId },
  };
  return { input, request, proof, response };
}

test("requires a current ready authority proof before spawning anything", async () => {
  const f = fixture();
  let spawned = false;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => null, isCurrent: () => true },
      spawnProcess: (() => {
        spawned = true;
        throw new Error("must not run");
      }) as never,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.equal(spawned, false);

  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => ({ ...f.proof, submissionEnabled: false }), isCurrent: () => true },
      spawnProcess: (() => { spawned = true; throw new Error("must not run"); }) as never,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.equal(spawned, false);

  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => false },
      spawnProcess: (() => {
        spawned = true;
        throw new Error("must not run");
      }) as never,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.equal(spawned, false);
});

test("spawns fixed local CLI argv with sanitized selectors and returns only matched safe metadata", async () => {
  const f = fixture();
  const child = new FixtureChild();
  let invocation:
    | { executable: string; args: string[]; options: Record<string, unknown> }
    | undefined;
  const spawnProcess = ((executable: string, args: string[], options: Record<string, unknown>) => {
    invocation = { executable, args, options };
    child.stdin.once("finish", () => {
      child.stdout.end(JSON.stringify(f.response));
      child.stderr.end("synthetic diagnostic that must not escape");
      setImmediate(() => child.emit("close", 0, null));
    });
    return child.asProcess();
  }) as never;
  const envBefore = {
    DOBIUS_PAIRING_CODE: process.env.DOBIUS_PAIRING_CODE,
    DOBIUS_REMOTE_PAIRING: process.env.DOBIUS_REMOTE_PAIRING,
    DOBIUS_ENVIRONMENT: process.env.DOBIUS_ENVIRONMENT,
  };
  try {
    process.env.DOBIUS_PAIRING_CODE = "inherited-pairing";
    process.env.DOBIUS_REMOTE_PAIRING = "inherited-remote";
    process.env.DOBIUS_ENVIRONMENT = "inherited-environment";
    const result = await submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      spawnProcess,
      now: () => 1_000,
    });
    assert.deepEqual(invocation?.args, ["submit-adam-child", "--request-stdin", "--json"]);
    assert.equal(invocation?.executable, "/trusted/bin/dobius");
    const spawnOptions = invocation?.options as {
      shell: boolean;
      cwd: string;
      env: NodeJS.ProcessEnv;
    };
    assert.equal(spawnOptions.shell, false);
    assert.equal(spawnOptions.cwd, f.proof.runtimeUserDataPath);
    assert.equal(spawnOptions.env.DOBIUS_USER_DATA_PATH, f.proof.runtimeUserDataPath);
    for (const key of ["DOBIUS_PAIRING_CODE", "DOBIUS_REMOTE_PAIRING", "DOBIUS_ENVIRONMENT"]) {
      assert.equal(spawnOptions.env[key], undefined);
    }
    const received = JSON.parse(String(child.stdin.read())) as { grant: { capability: string } };
    assert.equal(received.grant.capability, f.request.grant.capability);
    assert.deepEqual(result, {
      id: "child-1",
      state: "queued",
      projectId: f.input.projectId,
      requestKey: f.input.requestKey,
      sourceRevision: f.input.sourceRevision,
      targetDeviceId: f.input.targetDeviceId,
      recipeId: f.input.recipeId,
    });
    assert.equal(JSON.stringify(result).includes(f.request.grant.capability), false);
    assert.equal(JSON.stringify(result).includes("synthetic diagnostic"), false);
  } finally {
    for (const [key, value] of Object.entries(envBefore)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("uses a disposable executable fixture with stdin payload and no capability argv", async () => {
  const f = fixture();
  const directory = mkdtempSync(join(tmpdir(), "adam-cloud-child-fixture-"));
  const executable = join(directory, "dobius-fixture");
  const runtimeDirectory = join(directory, "runtime");
  mkdirSync(runtimeDirectory);
  writeFileSync(
    executable,
    `#!${process.execPath}\nlet body='';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', chunk => body += chunk);\nprocess.stdin.on('end', () => {\n  const request = JSON.parse(body);\n  process.stdout.write(JSON.stringify({ id: 'fixture-rpc', ok: true, result: { job: { id: 'child-fixture', state: 'queued', ...request.input } }, _meta: { runtimeId: 'fixture-runtime' } }));\n});\n`,
    { mode: 0o700 },
  );
  chmodSync(executable, 0o700);
  try {
    const result = await submitAdamCloudChild(f.request, {
      executablePath: executable,
      authority: {
        acquire: async () => ({ ...f.proof, runtimeUserDataPath: runtimeDirectory }),
        isCurrent: () => true,
      },
    });
    assert.equal(result.id, "child-fixture");
    assert.equal(result.projectId, f.input.projectId);
    assert.equal(result.targetDeviceId, f.input.targetDeviceId);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects request/grant fingerprint mismatch before spawn", async () => {
  const f = fixture();
  const request = { ...f.request, input: { ...f.request.input, title: "modified after grant" } };
  let spawned = false;
  await assert.rejects(
    submitAdamCloudChild(request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      spawnProcess: (() => {
        spawned = true;
        throw new Error("must not run");
      }) as never,
    }),
    (error: unknown) =>
      error instanceof AdamCloudChildSubmitError && error.code === "invalid-request",
  );
  assert.equal(spawned, false);
});

test("deduplicates and sorts dependencies before grant fingerprint verification and stdin", async () => {
  const f = fixture();
  const canonicalInput = { ...f.input, dependencies: ["dep-a", "dep-b"] };
  const request = {
    input: { ...f.input, dependencies: ["dep-b", "dep-a", "dep-b"] },
    grant: { ...f.request.grant, requestFingerprint: canonicalCloudJobAdamSha256(canonicalInput) },
  };
  const proof = { ...f.proof, requestFingerprint: request.grant.requestFingerprint };
  const child = new FixtureChild();
  const chunks: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stdin.once("finish", () => {
    const wire = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.deepEqual(wire.input.dependencies, ["dep-a", "dep-b"]);
    child.stdout.end(JSON.stringify({
      ...f.response,
      result: { job: { ...canonicalInput, id: "child-normalized", state: "queued" } },
      _meta: { runtimeId: proof.runtimeId },
    }));
    setImmediate(() => child.emit("close", 0, null));
  });
  const result = await submitAdamCloudChild(request, {
    executablePath: "/trusted/bin/dobius",
    authority: { acquire: async () => proof, isCurrent: () => true },
    spawnProcess: (() => child.asProcess()) as never,
  });
  assert.equal(result.id, "child-normalized");
});

test("rejects a returned child whose project, revision, or requested target differs", async () => {
  const f = fixture();
  const child = new FixtureChild();
  const spawnProcess = (() => {
    child.stdin.once("finish", () => {
      child.stdout.end(
        JSON.stringify({
          ...f.response,
          result: { job: { ...f.response.result.job, targetDeviceId: "other-worker" } },
        }),
      );
      setImmediate(() => child.emit("close", 0, null));
    });
    return child.asProcess();
  }) as never;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      spawnProcess,
    }),
    (error: unknown) =>
      error instanceof AdamCloudChildSubmitError && error.code === "invalid-response",
  );
});

test("bounds combined stdout/stderr and deadline, kills the child, and redacts process output", async () => {
  const f = fixture();
  const oversized = new FixtureChild();
  oversized.emitErrorOnKill = true;
  const overflowSpawn = (() => {
    setImmediate(() => oversized.stdout.write(Buffer.alloc(64 * 1024 + 1)));
    return oversized.asProcess();
  }) as never;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      spawnProcess: overflowSpawn,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "output-limit",
  );
  assert.equal(oversized.killed, true);
  assert.equal(oversized.killCount, 1, "synchronous kill error must not reenter failure");

  const stalled = new FixtureChild();
  stalled.emitErrorOnKill = true;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      spawnProcess: (() => stalled.asProcess()) as never,
      deadlineMs: 20,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "deadline",
  );
  assert.equal(stalled.killed, true);
  assert.equal(stalled.killCount, 1);
  assert.equal(stalled.listenerCount("error"), 1, "error sink stays attached until close");
  assert.doesNotThrow(() => stalled.emit("error", new Error("late synthetic child error")));
  assert.doesNotThrow(() => stalled.stdin.emit("error", new Error("late stdin error")));
  assert.doesNotThrow(() => stalled.stdout.write(Buffer.alloc(80 * 1024)));
  assert.doesNotThrow(() => stalled.stderr.write(Buffer.alloc(80 * 1024)));
  assert.equal(stalled.stdout.listenerCount("data"), 1, "late output is drained and discarded");
  stalled.emit("close", null, "SIGKILL");
  assert.equal(stalled.listenerCount("error"), 0, "process sinks are removed only after close");

  const failed = new FixtureChild();
  const failureSpawn = (() => {
    setImmediate(() => {
      failed.stderr.end(`capability ${f.request.grant.capability}`);
      failed.emit("close", 7, null);
    });
    return failed.asProcess();
  }) as never;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      spawnProcess: failureSpawn,
    }),
    (error: unknown) =>
      error instanceof AdamCloudChildSubmitError &&
      error.code === "child-failed" &&
      !error.message.includes(f.request.grant.capability) &&
      !error.message.includes("capability"),
  );
});

test("uses one total monotonic deadline across authority acquisition and CLI execution", async () => {
  const f = fixture();
  const child = new FixtureChild();
  const authority = {
    acquire: async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return f.proof;
    },
    isCurrent: () => true,
  };
  const spawnProcess = (() => {
    child.stdin.once("finish", () => {
      setTimeout(() => {
        child.stdout.end(JSON.stringify(f.response));
        child.emit("close", 0, null);
      }, 50);
    });
    return child.asProcess();
  }) as never;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius", authority, spawnProcess, deadlineMs: 90,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "deadline",
  );
  assert.equal(child.killed, true);
});

test("redacts clock and authority exceptions and rechecks proof after child close", async () => {
  const f = fixture();
  let spawned = false;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => { throw new Error("private authority detail"); } },
      spawnProcess: (() => { spawned = true; throw new Error("must not run"); }) as never,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready" && !error.message.includes("private"),
  );
  assert.equal(spawned, false);
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      now: () => { throw new Error("private clock detail"); },
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready" && !error.message.includes("private"),
  );
  let nanClockSpawned = false;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
      now: () => Number.NaN,
      spawnProcess: (() => { nanClockSpawned = true; throw new Error("must not run"); }) as never,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.equal(nanClockSpawned, false, "a non-finite clock cannot authorize a spawn");

  let authorityChecks = 0;
  let fencedSpawned = false;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => ++authorityChecks === 1 },
      spawnProcess: (() => { fencedSpawned = true; throw new Error("must not run"); }) as never,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.equal(authorityChecks, 2, "the final authority fence runs at the spawn boundary");
  assert.equal(fencedSpawned, false, "revocation at the final fence prevents process creation");

  const child = new FixtureChild();
  let checks = 0;
  const spawnProcess = (() => {
    child.stdin.once("finish", () => {
      child.stdout.end(JSON.stringify(f.response));
      setImmediate(() => child.emit("close", 0, null));
    });
    return child.asProcess();
  }) as never;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius", spawnProcess,
      authority: { acquire: async () => f.proof, isCurrent: () => ++checks < 3 },
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.equal(checks, 3, "proof checked before spawn and again after process completion");
});

test("does not deliver grant bytes when spawn startup consumes the shared deadline", async () => {
  const f = fixture();
  const child = new FixtureChild();
  const received: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => received.push(chunk));
  const deadlineAt = performance.now() + 20;
  const spawnProcess = (() => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
    return child.asProcess();
  }) as never;

  const pending = runLocalChildSubmit(f.request, f.proof, {
    executablePath: "/trusted/bin/dobius",
    deadlineAt,
    assertProofCurrent: () => {},
    spawnProcess,
  });
  let rejectionCount = 0;
  void pending.catch(() => { rejectionCount += 1; });
  await assert.rejects(
    pending,
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "deadline",
  );
  assert.equal(Buffer.concat(received).byteLength, 0);
  assert.equal(child.killed, true);
  assert.equal(child.killCount, 1);
  assert.equal(child.listenerCount("error"), 1, "error sink stays until actual close");
  child.emit("error", new Error("late synthetic spawn failure"));
  child.stdin.emit("error", new Error("late synthetic stdin failure"));
  child.emit("close", null, "SIGKILL");
  assert.equal(child.listenerCount("error"), 0);
  await Promise.resolve();
  assert.equal(rejectionCount, 1, "late events do not settle the request twice");
});

test("does not deliver grant bytes when proof is revoked during synchronous spawn", async () => {
  const f = fixture();
  const child = new FixtureChild();
  const received: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => received.push(chunk));
  let current = true;
  let checks = 0;
  const promise = submitAdamCloudChild(f.request, {
    executablePath: "/trusted/bin/dobius",
    authority: {
      acquire: async () => f.proof,
      isCurrent: () => {
        checks += 1;
        return current;
      },
    },
    spawnProcess: (() => {
      current = false;
      return child.asProcess();
    }) as never,
  });

  await assert.rejects(
    promise,
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "not-ready",
  );
  assert.ok(checks >= 3, "proof is checked again after spawn before stdin delivery");
  assert.equal(Buffer.concat(received).byteLength, 0);
  assert.equal(child.killed, true);
  assert.equal(child.killCount, 1);
  assert.equal(child.listenerCount("error"), 1, "error sink stays until actual close");
  child.emit("error", new Error("late synthetic spawn failure"));
  child.emit("close", null, "SIGKILL");
  assert.equal(child.listenerCount("error"), 0);
});

test("times out a missing proof and rejects non-absolute trusted selections", async () => {
  const f = fixture();
  let spawned = false;
  let acquisitionSignal: AbortSignal | undefined;
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "/trusted/bin/dobius",
      authority: {
        acquire: (_request, signal) => {
          acquisitionSignal = signal;
          return new Promise(() => {});
        },
        isCurrent: () => true,
      },
      spawnProcess: (() => {
        spawned = true;
        throw new Error("must not run");
      }) as never,
      deadlineMs: 15,
    }),
    (error: unknown) => error instanceof AdamCloudChildSubmitError && error.code === "deadline",
  );
  assert.equal(spawned, false);
  assert.equal(acquisitionSignal?.aborted, true);
  await assert.rejects(
    submitAdamCloudChild(f.request, {
      executablePath: "dobius",
      authority: { acquire: async () => f.proof, isCurrent: () => true },
    }),
    (error: unknown) =>
      error instanceof AdamCloudChildSubmitError && error.code === "invalid-request",
  );
});
