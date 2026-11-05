import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const runtimeId = "6f97e464-420a-4c7c-8d40-ff69ab0e6b9b";
const serviceCredential = Buffer.alloc(32, 0x44).toString("base64url");
const payload = {
  requestKey: "joint-approved-child",
  taskId: "task-joint-001",
  projectId: "project-a",
  workspaceId: "workspace-a",
  targetDeviceId: "device-a",
  recipeId: "recipe-a",
  title: "Synthetic approved child",
  sourceRevision: "a".repeat(40),
  estimatedBytes: 1024,
  dependencies: [],
};

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function rows(db, sql) {
  return db.prepare(sql).all();
}

function snapshotAdam(db) {
  return {
    bindings: rows(
      db,
      "SELECT binding_id,parent_job_id,identity_json,capability_hash,expires_at_ms FROM dobius_cloud_bindings ORDER BY binding_id",
    ),
    intents: rows(
      db,
      "SELECT intent_id,binding_id,identity_json,sealed_envelope,state,expires_at_ms FROM dobius_cloud_intents ORDER BY intent_id",
    ),
    parent: rows(db, "SELECT id,state,project_id FROM jobs ORDER BY id"),
  };
}

function snapshotDobius(store) {
  return {
    jobs: rows(
      store.db,
      "SELECT id,creator,request_key,fingerprint,document FROM cloud_jobs ORDER BY id",
    ),
    bindings: rows(store.db, "SELECT * FROM cloud_job_adam_bindings ORDER BY job_id"),
    events: rows(store.db, "SELECT * FROM cloud_events ORDER BY sequence"),
    outbox: rows(store.db, "SELECT * FROM cloud_job_adam_receipt_outbox ORDER BY receipt_id"),
  };
}

async function makeFixture(api, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "adam-dobius-joint-"));
  const root = realpathSync(directory);
  const adamPath = join(directory, "adam", "adam.sqlite");
  const cloudPath = join(directory, "dobius", "cloud.sqlite");
  let adamNow = 100_000;
  let cloudAuthority = true;
  let humanApproved = true;
  let generation = 1;
  let dropAfterSubmit = options.dropAfterSubmit === true;
  const action = { seals: 0, submits: 0, lookups: 0, unseals: 0, consumes: 0 };
  const enteredUnseal = deferred();
  const unsealGate = deferred();
  const sealed = new Map();
  let lastCapability;
  let cloudStore;
  let db = api.openDatabase(adamPath);
  const parentStore = new api.JobStore(db);
  const parentId = parentStore.createJob({
    objective: "Synthetic parent",
    projectId: payload.projectId,
  });
  let receipts = new api.DobiusCloudReceiptStore(db, () => adamNow);
  const decisionId = randomUUID();
  const decision = {
    schemaVersion: 1,
    decisionId,
    actorId: "synthetic-human",
    actorSourceId: "synthetic-approval-source",
    sourceEventId: "synthetic-event-1",
    actorEvidenceDigest: "b".repeat(64),
    sourceBinding: "c".repeat(64),
    authorityGeneration: 1,
    parentObjectiveId: parentId,
    parentObjectiveVersion: 1,
    projectId: payload.projectId,
    contextDigest: "d".repeat(64),
    expiresAtMs: 200_000,
    approvedPayloadJson: api.canonicalCloudJobAdamJson(payload),
  };
  const authorizedRow = new api.ApprovedDecisionStore(db).persistAuthorizedDecision(
    decision,
    adamNow,
  );
  const intentId = authorizedRow.intent_id;
  const decisionCalls = { resolve: 0, current: 0 };
  const decisionAuthority = {
    resolveExactDecisionJson: async (id) => {
      decisionCalls.resolve += 1;
      return id === decisionId && humanApproved ? api.canonicalCloudJobAdamJson(decision) : null;
    },
    isCurrent: () => {
      decisionCalls.current += 1;
      return humanApproved;
    },
  };
  const peerEvidence = Object.freeze({ fixture: "synthetic-transport-peer" });
  const identity = {
    schemaVersion: 1,
    serviceId: "adam",
    instanceId: receipts.instanceId,
    audienceRuntimeId: runtimeId,
    authorizationGeneration: generation,
    allowedMethods: [
      "adam.lookupApprovedIntent",
      "adam.sealApprovedIntent",
      "adam.submitApprovedIntent",
    ],
    allowedProjects: [payload.projectId],
    allowedResources: [
      "adam.lookupApprovedIntent",
      "adam.sealApprovedIntent",
      "adam.submitApprovedIntent",
    ].map((method) => ({ method, projectId: payload.projectId, resourceId: intentId })),
  };
  const registry = api.AdamServicePrincipalRegistry.withTrustedAdapter({
    verifyEnrollment: async () => true,
    verifyTransportPeer: async (peer) =>
      peer === peerEvidence
        ? {
            serviceId: "adam",
            instanceId: receipts.instanceId,
            audienceRuntimeId: runtimeId,
            authorizationGeneration: generation,
          }
        : null,
    verifyRevocation: async () => true,
  });
  await registry.enroll(
    { identity, credential: serviceCredential },
    Object.freeze({ fixture: "enrollment-proof" }),
  );

  const localAdamClient = {
    consumeBinding: async (rawGrant) => {
      action.consumes += 1;
      const grant = api.CloudJobAdamBindingGrant.parse(rawGrant);
      const { capability, ...binding } = grant;
      const value = receipts.consume({ schemaVersion: 1, capability, binding });
      return { state: "accepted", value };
    },
  };
  const service = new api.CloudJobService({
    openStore: () => {
      cloudStore = new api.CloudJobStore(cloudPath, () => adamNow, { localDeviceId: "device-a" });
      return cloudStore;
    },
    authorityAvailable: () => cloudAuthority,
    canUseWorkspace: async () => true,
    adamClient: localAdamClient,
  });
  service.registerProject(
    { kind: "local", id: "fixture-admin" },
    {
      id: payload.projectId,
      deviceId: payload.targetDeviceId,
      root,
      recipes: [payload.recipeId],
      capability: "portable",
    },
  );

  const sealer = {
    seal: async (rawEnvelope) => {
      action.seals += 1;
      const envelope = structuredClone(rawEnvelope);
      lastCapability = envelope.capability;
      const sealedEnvelope = `sealed:dobius-adam-intent:v1:${Buffer.from(randomUUID()).toString("base64")}`;
      sealed.set(sealedEnvelope, envelope);
      return sealedEnvelope;
    },
    dispose() {},
  };
  const unsealer = {
    unseal: async (request) => {
      action.unseals += 1;
      if (options.pauseUnseal) {
        enteredUnseal.resolve(structuredClone(request));
        await unsealGate.promise;
      }
      const envelope = sealed.get(request.sealedEnvelope);
      if (
        !envelope ||
        envelope.intentId !== request.intentId ||
        api.canonicalCloudJobAdamJson(envelope.identity) !==
          api.canonicalCloudJobAdamJson(request.identity)
      ) {
        throw new Error("synthetic ciphertext unavailable");
      }
      return {
        intentId: envelope.intentId,
        grant: { ...envelope.identity, capability: envelope.capability },
      };
    },
    dispose() {},
  };
  const bridge = new api.AdamCloudIntentBridge({
    registry,
    sealer,
    unsealer,
    runtimeId: () => runtimeId,
    cloudJobs: () => service,
  });
  let faultUsed = false;
  const invoke = async (_executable, args, body, _credential) => {
    const packet = JSON.parse(body);
    let rpcName;
    if (args[0] === "seal-adam-intent") {
      assert.equal(
        args.some((argument) => argument.includes(packet.envelope.capability)),
        false,
      );
      rpcName = "adam.sealApprovedIntent";
    } else if (args[0] === "submit-adam-child") {
      assert.equal("capability" in packet || "grant" in packet, false);
      action.submits += 1;
      rpcName = "adam.submitApprovedIntent";
    } else if (args[0] === "lookup-adam-child") {
      action.lookups += 1;
      rpcName = "adam.lookupApprovedIntent";
    } else throw new Error("unexpected synthetic CLI operation");

    if (rpcName === "adam.submitApprovedIntent") {
      if (options.mismatch === "runtime" && !faultUsed) packet.audienceRuntimeId = randomUUID();
      if (options.mismatch === "project" && !faultUsed) packet.approvedJob.projectId = "project-b";
      if (options.mismatch === "payload" && !faultUsed)
        packet.approvedJob.title = "Changed after approval";
      if (options.mismatch === "identity" && !faultUsed)
        packet.identity.contextDigest = "e".repeat(64);
      faultUsed ||= Boolean(options.mismatch);
      if (options.dropBeforeSubmit && !faultUsed) {
        faultUsed = true;
        throw new Error("synthetic transport drop before main handler");
      }
    }
    const method = api.ADAM_CLOUD_CHILD_METHODS.find((candidate) => candidate.name === rpcName);
    const result = await method.handler(packet, {
      adamCloudIntentBridge: bridge,
      adamPeerEvidence: peerEvidence,
    });
    let response = result;
    if (rpcName === "adam.sealApprovedIntent" && options.mismatch === "response" && !faultUsed) {
      faultUsed = true;
      response = { ...result, identity: { ...result.identity, projectId: "project-b" } };
    }
    if (rpcName === "adam.submitApprovedIntent" && dropAfterSubmit) {
      dropAfterSubmit = false;
      humanApproved = false;
      throw new Error("synthetic reply lost after main commit");
    }
    return { ok: true, _meta: { runtimeId }, result: response };
  };
  const credentialAuthority = {
    acquire: async () => ({
      schemaVersion: 1,
      audienceRuntimeId: runtimeId,
      credential: serviceCredential,
      runtimeUserDataPath: "/synthetic/runtime",
      authorizationGeneration: generation,
    }),
    isCurrent: () => true,
  };
  const makePublisher = () =>
    api.createApprovedDecisionPublisher({
      enabled: true,
      database: db,
      receipts,
      decisionAuthority,
      credentialAuthority,
      dobiusExecutablePath: "/synthetic/bin/dobius",
      invoke,
      now: () => adamNow,
    });
  const close = async (publishers = []) => {
    for (const publisher of publishers) await publisher?.stop(5_000);
    bridge.dispose();
    await service.shutdown(5_000).catch(() => undefined);
    if (cloudStore) {
      try {
        cloudStore.close();
      } catch {}
      cloudStore = undefined;
    }
    try {
      db.close();
    } catch {}
    rmSync(directory, { recursive: true, force: true });
  };
  return {
    directory,
    adamPath,
    cloudPath,
    decisionId,
    parentId,
    intentId,
    payload,
    decision,
    db,
    parentStore,
    registry,
    peerEvidence,
    identity,
    service,
    get cloudStore() {
      return cloudStore;
    },
    receipts,
    decisionAuthority,
    decisionCalls,
    action,
    makePublisher,
    enteredUnseal,
    unsealGate,
    setHumanApproved(value) {
      humanApproved = value;
    },
    setCloudAuthority(value) {
      cloudAuthority = value;
    },
    setAdamNow(value) {
      adamNow = value;
    },
    get now() {
      return adamNow;
    },
    get lastCapability() {
      return lastCapability;
    },
    async revokeServiceGeneration() {
      await registry.revoke("adam", generation, Object.freeze({ fixture: "revocation-proof" }));
    },
    reopenAdam() {
      db.close();
      db = api.openDatabase(adamPath);
      receipts = new api.DobiusCloudReceiptStore(db, () => adamNow);
      return { db, receipts, publisher: makePublisher() };
    },
    close,
  };
}

export async function runJointIntegration(api) {
  const fixtures = [];
  after(async () => {
    for (const fixture of fixtures) await fixture.close(fixture.publishers ?? []);
  });

  test("actual ADAM producer commits one Dobius child before lost ACK, then same-child lookup recovers after approval revocation, DB reopen, and expiry", async () => {
    const f = await makeFixture(api, { dropAfterSubmit: true });
    fixtures.push(f);
    const publisherA = f.makePublisher();
    const publisherB = f.makePublisher();
    f.publishers = [publisherA, publisherB];
    const attempts = await Promise.allSettled([
      publisherA.dispatch(f.decisionId),
      publisherB.dispatch(f.decisionId),
    ]);
    assert.equal(attempts.filter((result) => result.status === "rejected").length, 2);
    assert.deepEqual(f.action, { seals: 1, submits: 1, lookups: 0, unseals: 1, consumes: 1 });
    const originalStore = f.cloudStore;
    const originalChildRows = rows(
      originalStore.db,
      "SELECT id,creator,request_key,document FROM cloud_jobs",
    );
    assert.equal(originalChildRows.length, 1);
    const childId = originalChildRows[0].id;
    const committedBinding = rows(
      originalStore.db,
      "SELECT binding_id FROM cloud_job_adam_bindings",
    );
    assert.equal(committedBinding.length, 1);
    assert.notEqual(committedBinding[0].binding_id, f.intentId);
    assert.equal(f.parentStore.getJob(f.parentId).state, "received");
    let durable = new api.ApprovedDecisionStore(f.db).get(f.decisionId);
    assert.equal(durable.intent_published, 1);
    assert.equal(durable.child_json, null);
    const intentExpiry = durable.intent_expires_at_ms;
    assert.equal(api.databaseIntegrity(f.db), "ok");

    f.setHumanApproved(false);
    await Promise.all([publisherA.stop(5_000), publisherB.stop(5_000)]);
    f.publishers = [];
    f.setAdamNow(intentExpiry + 1);
    const reopened = f.reopenAdam();
    f.publishers = [reopened.publisher];
    const recovered = await reopened.publisher.recover();
    assert.deepEqual(recovered, { attempted: 1, failed: 0 });
    const replay = await reopened.publisher.dispatch(f.decisionId);
    assert.equal(replay.child.id, childId);
    assert.equal(f.cloudStore, originalStore);
    assert.deepEqual(f.action, { seals: 1, submits: 1, lookups: 1, unseals: 2, consumes: 1 });
    durable = new api.ApprovedDecisionStore(reopened.db).get(f.decisionId);
    assert.equal(durable.intent_id, f.intentId);
    assert.equal(durable.intent_expires_at_ms, intentExpiry);
    assert.equal(JSON.parse(durable.child_json).id, childId);
    assert.equal(rows(reopened.db, "SELECT intent_id FROM dobius_cloud_intents").length, 1);
    assert.equal(rows(reopened.db, "SELECT binding_id FROM dobius_cloud_bindings").length, 1);
    assert.equal(rows(originalStore.db, "SELECT id FROM cloud_jobs").length, 1);
    assert.equal(rows(originalStore.db, "SELECT * FROM cloud_job_adam_bindings").length, 1);
    assert.equal(new api.JobStore(reopened.db).getJob(f.parentId).state, "received");
    assert.equal(api.databaseIntegrity(reopened.db), "ok");
    assert.equal(f.lastCapability.includes(childId), false);
  });

  test("expired revoked approval with a null exact-child lookup cannot create a fresh submit", async () => {
    const f = await makeFixture(api, { dropBeforeSubmit: true });
    fixtures.push(f);
    const publisher = f.makePublisher();
    f.publishers = [publisher];
    await assert.rejects(publisher.dispatch(f.decisionId));
    assert.equal(f.action.seals, 1);
    assert.equal(f.action.submits, 1);
    assert.equal(f.action.consumes, 0);
    const before = new api.ApprovedDecisionStore(f.db).get(f.decisionId);
    f.setHumanApproved(false);
    await publisher.stop(5_000);
    f.publishers = [];
    f.setAdamNow(before.intent_expires_at_ms + 1);
    const reopened = f.reopenAdam();
    f.publishers = [reopened.publisher];
    assert.deepEqual(await reopened.publisher.recover(), { attempted: 1, failed: 1 });
    assert.deepEqual(f.action, { seals: 1, submits: 1, lookups: 1, unseals: 1, consumes: 0 });
    const after = new api.ApprovedDecisionStore(reopened.db).get(f.decisionId);
    assert.equal(after.intent_id, before.intent_id);
    assert.equal(after.intent_expires_at_ms, before.intent_expires_at_ms);
    assert.equal(after.child_json, null);
    assert.equal(rows(reopened.db, "SELECT binding_id FROM dobius_cloud_bindings").length, 1);
    assert.equal(rows(f.cloudStore.db, "SELECT id FROM cloud_jobs").length, 0);
    assert.equal(rows(f.cloudStore.db, "SELECT * FROM cloud_job_adam_bindings").length, 0);
    assert.equal(new api.JobStore(reopened.db).getJob(f.parentId).state, "received");
  });

  for (const mismatch of ["runtime", "project", "payload", "identity", "response"]) {
    test(`actual RPC composition refuses mismatched ${mismatch} without a child or consumed binding`, async () => {
      const f = await makeFixture(api, { mismatch });
      fixtures.push(f);
      const publisher = f.makePublisher();
      f.publishers = [publisher];
      const result = await Promise.allSettled([publisher.dispatch(f.decisionId)]);
      assert.equal(result[0].status, "rejected");
      const publicError = String(result[0].reason);
      assert.equal(publicError.includes(f.lastCapability ?? "\0"), false);
      assert.equal(rows(f.cloudStore.db, "SELECT id FROM cloud_jobs").length, 0);
      assert.equal(rows(f.cloudStore.db, "SELECT * FROM cloud_job_adam_bindings").length, 0);
      assert.equal(f.action.consumes, 0);
      assert.equal(f.parentStore.getJob(f.parentId).state, "received");
      const decision = new api.ApprovedDecisionStore(f.db).get(f.decisionId);
      if (mismatch === "response") {
        assert.equal(decision.intent_published, 0);
        assert.equal(rows(f.db, "SELECT binding_id FROM dobius_cloud_bindings").length, 0);
      } else {
        assert.equal(decision.intent_published, 1);
        assert.equal(rows(f.db, "SELECT binding_id FROM dobius_cloud_bindings").length, 1);
      }
    });
  }

  test("revoked service generation while unseal awaits refuses before any child or binding consume", async () => {
    const f = await makeFixture(api, { pauseUnseal: true });
    fixtures.push(f);
    const publisher = f.makePublisher();
    f.publishers = [publisher];
    const pending = publisher.dispatch(f.decisionId);
    await f.enteredUnseal.promise;
    const adamBefore = snapshotAdam(f.db);
    const cloudBefore = snapshotDobius(f.cloudStore);
    await f.revokeServiceGeneration();
    f.unsealGate.resolve();
    const outcome = await Promise.allSettled([pending]);
    assert.equal(outcome[0].status, "rejected");
    assert.deepEqual(snapshotAdam(f.db), adamBefore);
    assert.deepEqual(snapshotDobius(f.cloudStore), cloudBefore);
    assert.equal(f.action.consumes, 0);
    assert.equal(f.action.submits, 1);
    assert.equal(f.parentStore.getJob(f.parentId).state, "received");
    assert.equal(String(outcome[0].reason).includes(f.lastCapability), false);
  });

  test("cloud authority revoked during awaited unseal refuses before child, binding, or receipt writes", async () => {
    const f = await makeFixture(api, { pauseUnseal: true });
    fixtures.push(f);
    const publisher = f.makePublisher();
    f.publishers = [publisher];
    const pending = publisher.dispatch(f.decisionId);
    await f.enteredUnseal.promise;
    const adamBefore = snapshotAdam(f.db);
    const cloudBefore = snapshotDobius(f.cloudStore);
    f.setCloudAuthority(false);
    f.unsealGate.resolve();
    const outcome = await Promise.allSettled([pending]);
    assert.equal(outcome[0].status, "rejected");
    assert.deepEqual(snapshotAdam(f.db), adamBefore);
    assert.deepEqual(snapshotDobius(f.cloudStore), cloudBefore);
    assert.equal(f.action.consumes, 0);
    assert.equal(rows(f.cloudStore.db, "SELECT id FROM cloud_jobs").length, 0);
    assert.equal(rows(f.cloudStore.db, "SELECT * FROM cloud_job_adam_bindings").length, 0);
    assert.equal(f.parentStore.getJob(f.parentId).state, "received");
    assert.equal(String(outcome[0].reason).includes(f.lastCapability), false);
  });
}
