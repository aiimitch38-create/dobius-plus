import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

const fixturePath = fileURLToPath(new URL("./process-lifecycle-child-fixture.js", import.meta.url));

type ChildResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function runChild(scenario: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fixturePath, scenario], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 2_000);
    child.once("error", (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(watchdog);
      if (timedOut) {
        reject(new Error(`test-owned child failed to exit after safe drain: ${scenario}`));
        return;
      }
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function assertNaturalExit(result: ChildResult, code: number): void {
  assert.equal(result.signal, null, "fixture must exit naturally, not by watchdog signal");
  assert.equal(result.code, code);
}

function indexOf(text: string, marker: string): number {
  const index = text.indexOf(marker);
  assert.notEqual(index, -1, `missing child marker: ${marker}\n${text}`);
  return index;
}

it("retains first unref'd false stop through retry and coalesces signals", async () => {
  const result = await runChild("stop-false");
  assertNaturalExit(result, 0);
  assert.ok(indexOf(result.stdout, "STOP_1_PENDING") < indexOf(result.stdout, "STOP_FALSE"));
  assert.ok(indexOf(result.stdout, "STOP_FALSE") < indexOf(result.stdout, "STOP_2_PENDING"));
  assert.ok(indexOf(result.stdout, "STOP_2_PENDING") < indexOf(result.stdout, "STOP_TRUE"));
  assert.equal(result.stdout.match(/STOPPING_/g)?.length, 1);
  assert.equal(result.stdout.includes('"ok": true'), false);
});

it("retains a rejected first unref'd stop and naturally exits after retry", async () => {
  const result = await runChild("stop-rejected");
  assertNaturalExit(result, 0);
  assert.ok(indexOf(result.stdout, "STOP_REJECTED") < indexOf(result.stdout, "STOP_2_PENDING"));
  assert.ok(indexOf(result.stdout, "STOP_2_PENDING") < indexOf(result.stdout, "STOP_TRUE"));
  assert.match(result.stderr, /synthetic first stop rejection/);
});

it("gives direct drain helper callers referenced ownership through false and true", async () => {
  const result = await runChild("direct-drain");
  assertNaturalExit(result, 0);
  assert.ok(indexOf(result.stdout, "STOP_1_PENDING") < indexOf(result.stdout, "STOP_FALSE"));
  assert.ok(indexOf(result.stdout, "STOP_FALSE") < indexOf(result.stdout, "STOP_2_PENDING"));
  assert.ok(indexOf(result.stdout, "STOP_2_PENDING") < indexOf(result.stdout, "STOP_TRUE"));
});

it("retains signaled once and prepare successes through execute and safe drain", async () => {
  for (const scenario of ["once-success", "prepare-success"]) {
    const result = await runChild(scenario);
    assertNaturalExit(result, 0);
    assert.ok(
      indexOf(result.stdout, "EXECUTE_PENDING") < indexOf(result.stdout, "EXECUTE_SETTLED"),
    );
    assert.ok(indexOf(result.stdout, "EXECUTE_SETTLED") < indexOf(result.stdout, "STOP_1_PENDING"));
    assert.ok(indexOf(result.stdout, "STOP_TRUE") < indexOf(result.stdout, '"ok": true'));
  }
});

it("keeps late once and prepare failures owned, reports failure after drain, and emits no JSON", async () => {
  for (const scenario of ["once-failure", "prepare-failure"]) {
    const result = await runChild(scenario);
    assertNaturalExit(result, 1);
    assert.ok(
      indexOf(result.stdout, "EXECUTE_PENDING") < indexOf(result.stdout, "EXECUTE_SETTLED"),
    );
    assert.ok(indexOf(result.stdout, "EXECUTE_SETTLED") < indexOf(result.stdout, "STOP_1_PENDING"));
    indexOf(result.stdout, "STOP_TRUE");
    assert.match(result.stderr, /synthetic late operation failure/);
    assert.equal(result.stdout.includes('"ok": true'), false);
  }
});
