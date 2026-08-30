import type { AcpRuntimeCatalogEntry } from "@comms/shared/api/types";

export const ONBOARDING_RUNTIME_ORDER = [
  "claude",
  "codex",
  "goose",
  "buzz-agent",
];

const VISIBLE_ONBOARDING_RUNTIME_IDS = new Set<string>(
  ONBOARDING_RUNTIME_ORDER,
);

// Dobius's own runtimes are minted per signed-in account, so their ids carry
// the account uuid (`dobius-native:claude:<uuid>`) and can never appear in a
// fixed list. Without this the onboarding step filtered out every runtime it
// had just discovered and told the user nothing was installed.
const DOBIUS_RUNTIME_ID_PREFIX = "dobius-native:";

export function runtimeIsVisibleInOnboarding(runtimeId: string) {
  return (
    runtimeId.startsWith(DOBIUS_RUNTIME_ID_PREFIX) ||
    VISIBLE_ONBOARDING_RUNTIME_IDS.has(runtimeId)
  );
}

/** Sort key: built-in Dobius runtimes lead, then the fixed upstream order. */
function onboardingRuntimeRank(runtimeId: string) {
  if (runtimeId.startsWith(DOBIUS_RUNTIME_ID_PREFIX)) return -1;
  return ONBOARDING_RUNTIME_ORDER.indexOf(runtimeId);
}

export function runtimeIsReadyForOnboarding(runtime: AcpRuntimeCatalogEntry) {
  return (
    runtime.availability === "available" &&
    (runtime.authStatus.status === "logged_in" ||
      runtime.authStatus.status === "not_applicable")
  );
}

export function getVisibleOnboardingRuntimes(
  runtimes: readonly AcpRuntimeCatalogEntry[],
) {
  return runtimes
    .filter((runtime) => runtimeIsVisibleInOnboarding(runtime.id))
    .sort(
      (left, right) =>
        onboardingRuntimeRank(left.id) - onboardingRuntimeRank(right.id),
    );
}

export function getReadyOnboardingRuntimes(
  runtimes: readonly AcpRuntimeCatalogEntry[],
) {
  return getVisibleOnboardingRuntimes(runtimes).filter(
    runtimeIsReadyForOnboarding,
  );
}
