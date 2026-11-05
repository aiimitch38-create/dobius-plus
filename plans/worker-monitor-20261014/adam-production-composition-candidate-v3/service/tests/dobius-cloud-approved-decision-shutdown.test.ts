import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, it } from "node:test";
import { openDatabase } from "../src/db/database.js";
import { JobStore } from "../src/jobs/store.js";
import { ApprovedDecisionStore } from "../src/dobius-cloud/approved-decision-store.js";
import { canonicalCloudJobAdamJson } from "../src/dobius-cloud/receipt-contract.js";
import { ProjectRegistrySchema } from "../src/projects/registry.js";
import { AdamService, type ServiceDobiusClient } from "../src/runtime/service.js";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

const runtimeId = "6f97e464-420a-4c7c-8d40-ff69ab0e6b9b";
const decisionId = "8f084f3e-e22e-4413-bc7e-b271cb5626b5";
const payload = {
  requestKey: "shutdown-test",
  taskId: "task-shutdown",
  projectId: "project-a",
  workspaceId: "workspace-a",
  targetDeviceId: "device-a",
  recipeId: "recipe-a",
  title: "Synthetic shutdown",
  sourceRevision: "a".repeat(40),
  estimatedBytes: 16,
  dependencies: [],
};
const projectRegistry = ProjectRegistrySchema.parse({
  version: 1,
  authority: {
    registryId: "adam-project-registry",
    sourceOfTruth: "ADAM config/project-registry.yaml",
    reconciledAt: "2026-10-15T12:00:00.000Z",
    dobiusPlus: {
      canonicalCheckout: "/synthetic/dobius",
      sourcePath: "/synthetic/dobius/src",
      compiledOutputPath: "/synthetic/dobius/out",
      runtimeEntryPath: "/synthetic/dobius/main.js",
      packagedOutputPath: "/synthetic/dobius/dist",
      installedAppPath: "/synthetic/Dobius+.app",
      activation: "disabled",
    },
    adam: {
      canonicalCheckout: "/synthetic/adam",
      sourcePath: "/synthetic/adam/src",
      distPath: "/synthetic/adam/dist",
      runtimeEntryPath: "/synthetic/adam/main.js",
      activation: "disabled",
    },
  },
  projects: [
    {
      id: "project-a",
      name: "Synthetic",
      aliases: ["synthetic"],
      owner: "test",
      classification: "maintenance",
      status: "active",
      riskTier: "low",
      dataSensitivity: "internal",
      locations: [{ path: "registry-only:fixture", role: "missing", verified: false }],
      execution: { mode: "disabled" },
      purpose: "bounded service test",
      notes: [],
    },
  ],
});

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
    if (Date.now() >= deadline) throw new Error("synthetic service did not reach expected state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

it("bounds shutdown around startup recovery and an authenticated request, retaining DB until an ignored provider settles", async () => {
  const directory = mkdtempSync(join(tmpdir(), "adam-approved-shutdown-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "adam.sqlite");
  const seed = openDatabase(databasePath);
  const parentId = new JobStore(seed).createJob({
    objective: "Synthetic parent",
    projectId: payload.projectId,
  });
  const decision = {
    schemaVersion: 1 as const,
    decisionId,
    actorId: "actor-test",
    actorSourceId: "source-test",
    sourceEventId: "event-test",
    actorEvidenceDigest: "b".repeat(64),
    sourceBinding: "c".repeat(64),
    authorityGeneration: 1,
    parentObjectiveId: parentId,
    parentObjectiveVersion: 1,
    projectId: payload.projectId,
    contextDigest: "d".repeat(64),
    expiresAtMs: Date.now() + 60_000,
    approvedPayloadJson: canonicalCloudJobAdamJson(payload),
  };
  new ApprovedDecisionStore(seed).persistAuthorizedDecision(decision, Date.now());
  seed.close();

  const source = deferred<unknown | null>();
  const started = deferred<void>();
  let dispatchHandler: ((request: IncomingMessage, response: ServerResponse) => void) | undefined;
  let forcedServerClose = false;
  let syntheticServerListening = true;
  const syntheticServer = {
    get listening() {
      return syntheticServerListening;
    },
    requestTimeout: 0,
    headersTimeout: 0,
    keepAliveTimeout: 0,
    address: () => null,
    once: () => syntheticServer,
    close: () => syntheticServer,
    closeAllConnections: () => {
      forcedServerClose = true;
      syntheticServerListening = false;
    },
  } as unknown as Server;
  let providerCalls = 0;
  let bridgeCalls = 0;
  const credential = {
    schemaVersion: 1 as const,
    audienceRuntimeId: runtimeId,
    credential: Buffer.alloc(32, 0x44).toString("base64url"),
    runtimeUserDataPath: "/synthetic/runtime",
    authorizationGeneration: 1,
  };
  const service = new AdamService({
    dataDir: directory,
    port: 0,
    approvedDecisionDispatchEnabled: true,
    approvedDecisionAuthority: {
      resolveExactDecisionJson: () => {
        providerCalls += 1;
        started.resolve();
        return source.promise;
      },
      isCurrent: () => true,
    },
    approvedIntentCredentialAuthority: { acquire: async () => credential, isCurrent: () => true },
    approvedIntentDobiusExecutablePath: "/synthetic/dobius",
    approvedIntentInvoke: async () => {
      bridgeCalls += 1;
      throw new Error("must not reach CLI");
    },
    projectRegistry,
    orchestrationAlerts: { recipient: "+15555550123" },
    testServer: {
      create: (handler) => {
        dispatchHandler = handler;
        return syntheticServer;
      },
      listen: async () => undefined,
    },
    dobiusClient: {
      status: async () => ({ ok: true }),
      worktreePs: async () => ({ worktrees: [], runtimeId }),
      terminalList: async () => ({ terminals: [], runtimeId }),
      terminalShow: async () => ({ terminal: {} }),
      terminalRead: async () => ({ terminal: {} }),
      terminalSend: async () => ({ terminal: {} }),
      terminalClose: async () => ({ terminal: {} }),
      terminalWait: async () => ({ terminal: {} }),
      repoShow: async () => ({}),
      repoSearchRefs: async () => ({}),
      worktreeList: async () => ({ worktrees: [] }),
      worktreeCreate: async () => ({}) as never,
      terminalCreate: async () => ({ terminal: { handle: "synthetic" } }),
    } as unknown as ServiceDobiusClient,
  });
  await service.start();
  await started.promise;
  assert.ok(dispatchHandler);
  const responseReceived = deferred<{ status: number; body: string }>();
  const request = Readable.from([JSON.stringify({ decisionId })]) as Readable &
    Partial<IncomingMessage>;
  Object.assign(request, {
    method: "POST",
    url: "/v1/internal/dobius/approved-decisions/dispatch",
    headers: { authorization: `Bearer ${service.token}`, "content-type": "application/json" },
  });
  let responseStatus = 0;
  const response = {
    writeHead(status: number) {
      responseStatus = status;
      return this;
    },
    end(body: string) {
      responseReceived.resolve({ status: responseStatus, body });
    },
  } as unknown as ServerResponse;
  dispatchHandler(request as IncomingMessage, response);
  await waitFor(() => providerCalls === 1);
  const beforeStop = Date.now();
  const drained = await service.stop(60);
  const elapsedMs = Date.now() - beforeStop;
  assert.equal(drained, false);
  assert.ok(elapsedMs < 180, `bounded stop exceeded its 60ms deadline allowance: ${elapsedMs}ms`);
  assert.equal(forcedServerClose, true);
  const responseResult = await responseReceived.promise;
  assert.equal(responseResult.status, 503);
  assert.equal(bridgeCalls, 0);
  assert.equal(
    Number(service.db.prepare("SELECT count(*) AS n FROM dobius_cloud_bindings").get()?.n),
    0,
  );
  assert.equal(
    Number(service.db.prepare("SELECT count(*) AS n FROM dobius_cloud_intents").get()?.n),
    0,
  );

  source.resolve(canonicalCloudJobAdamJson(decision));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(bridgeCalls, 0);
  assert.equal(
    Number(service.db.prepare("SELECT count(*) AS n FROM dobius_cloud_bindings").get()?.n),
    0,
  );
  assert.equal(
    Number(service.db.prepare("SELECT count(*) AS n FROM dobius_cloud_intents").get()?.n),
    0,
  );
  assert.equal(await service.stop(500), true);
  assert.throws(() => service.db.prepare("SELECT 1"), /closed|not open/i);
});
