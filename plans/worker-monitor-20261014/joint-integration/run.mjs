#!/usr/bin/env node
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return resolve(process.argv[index + 1]);
}

const repo = option("--repo");
const adamService = option("--adam-service");
const dobius = join(repo, "dobius");
const require = createRequire(join(dobius, "package.json"));
const esbuild = require("esbuild");
const scratch = mkdtempSync(join(tmpdir(), "dobius-adam-joint-build-"));
const output = join(scratch, "joint-integration.test.mjs");
const imported = (path) => JSON.stringify(resolve(path));
const entry = `
import { openDatabase, databaseIntegrity } from ${imported(join(adamService, "src/db/database.ts"))};
import { JobStore } from ${imported(join(adamService, "src/jobs/store.ts"))};
import { ApprovedDecisionStore } from ${imported(join(adamService, "src/dobius-cloud/approved-decision-store.ts"))};
import { DobiusCloudReceiptStore } from ${imported(join(adamService, "src/dobius-cloud/receipt-store.ts"))};
import { createApprovedDecisionPublisher } from ${imported(join(adamService, "src/dobius-cloud/approved-decision-publisher.ts"))};
import { canonicalCloudJobAdamJson } from ${imported(join(adamService, "src/dobius-cloud/receipt-contract.ts"))};
import { CloudJobAdamBindingGrant } from ${imported(join(dobius, "src/shared/cloud-job-adam-receipts.ts"))};
import { CloudJobStore } from ${imported(join(dobius, "src/main/automations/cloud-jobs/store.ts"))};
import { CloudJobService } from ${imported(join(dobius, "src/main/automations/cloud-job-service.ts"))};
import { AdamCloudIntentBridge } from ${imported(join(dobius, "src/main/adam-service-principal/adam-cloud-intent-bridge.ts"))};
import { AdamServicePrincipalRegistry } from ${imported(join(dobius, "src/main/adam-service-principal/registry.ts"))};
import { ADAM_CLOUD_CHILD_METHODS } from ${imported(join(dobius, "src/main/runtime/rpc/methods/adam-cloud-child.ts"))};
import { runJointIntegration } from ${imported(join(repo, "plans/worker-monitor-20261014/joint-integration/joint-integration.test.mjs"))};
await runJointIntegration({ openDatabase, databaseIntegrity, JobStore, ApprovedDecisionStore,
  DobiusCloudReceiptStore, createApprovedDecisionPublisher, canonicalCloudJobAdamJson,
  CloudJobAdamBindingGrant, CloudJobStore, CloudJobService, AdamCloudIntentBridge,
  AdamServicePrincipalRegistry, ADAM_CLOUD_CHILD_METHODS });
`;

try {
  await esbuild.build({
    stdin: { contents: entry, resolveDir: repo, sourcefile: "joint-entry.ts", loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    nodePaths: [join(dobius, "node_modules"), join(adamService, "node_modules")],
    outfile: output,
    logLevel: "warning",
  });
  const result = spawnSync(process.execPath, ["--test", output], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
