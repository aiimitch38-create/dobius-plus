import assert from "node:assert/strict";
import test from "node:test";

import {
  getReadyOnboardingRuntimes,
  getVisibleOnboardingRuntimes,
  runtimeIsReadyForOnboarding,
  runtimeIsVisibleInOnboarding,
} from "./onboardingRuntimeSelection.ts";

function runtime(id, availability, status) {
  return { id, availability, authStatus: { status } };
}

test("all bundled harnesses are visible in onboarding", () => {
  assert.equal(runtimeIsVisibleInOnboarding("claude"), true);
  assert.equal(runtimeIsVisibleInOnboarding("codex"), true);
  assert.equal(runtimeIsVisibleInOnboarding("goose"), true);
  assert.equal(runtimeIsVisibleInOnboarding("buzz-agent"), true);
  assert.equal(runtimeIsVisibleInOnboarding("custom"), false);
});

test("Dobius account-scoped runtimes are visible and lead the list", () => {
  // Regression: these ids carry the signed-in account's uuid, so a fixed
  // allowlist filtered out every runtime discovery had just found and the
  // onboarding step reported no harnesses installed on a machine that had one.
  const claudeAccount = "dobius-native:claude:9bcfb49a-a73d-4fc8-9d8c-34e52be366e0";
  assert.equal(runtimeIsVisibleInOnboarding(claudeAccount), true);
  assert.equal(runtimeIsVisibleInOnboarding("dobius-native:codex:active"), true);

  const ordered = getVisibleOnboardingRuntimes([
    runtime("claude", "available", "logged_in"),
    runtime(claudeAccount, "available", "logged_in"),
  ]);
  assert.deepEqual(
    ordered.map((entry) => entry.id),
    [claudeAccount, "claude"],
  );
});

test("visible onboarding runtimes use the product order", () => {
  const runtimes = [
    runtime("buzz-agent", "available", "not_applicable"),
    runtime("codex", "available", "logged_in"),
    runtime("goose", "available", "not_applicable"),
    runtime("claude", "available", "logged_in"),
  ];

  assert.deepEqual(
    getVisibleOnboardingRuntimes(runtimes).map(({ id }) => id),
    ["claude", "codex", "goose", "buzz-agent"],
  );
});

test("readiness requires an available and authenticated runtime", () => {
  assert.equal(
    runtimeIsReadyForOnboarding(runtime("claude", "available", "logged_in")),
    true,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(
      runtime("codex", "available", "not_applicable"),
    ),
    true,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(runtime("claude", "available", "logged_out")),
    false,
  );
  assert.equal(
    runtimeIsReadyForOnboarding(runtime("codex", "not_installed", "logged_in")),
    false,
  );
});

test("ready onboarding runtimes exclude unknown and non-ready harnesses", () => {
  const runtimes = [
    runtime("goose", "available", "not_applicable"),
    runtime("codex", "available", "logged_out"),
    runtime("buzz-agent", "available", "not_applicable"),
    runtime("claude", "available", "logged_in"),
    runtime("custom", "available", "not_applicable"),
  ];

  assert.deepEqual(
    getReadyOnboardingRuntimes(runtimes).map(({ id }) => id),
    ["claude", "goose", "buzz-agent"],
  );
});
