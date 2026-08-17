import React from "react";
import ReactDOM from "react-dom/client";
import { getPublicKey } from "nostr-tools/pure";
import { App } from "@/app/App";
import { NostrBindConsentDialog } from "@/features/profile/ui/NostrBindConsentDialog";
import "@fontsource-variable/inter/wght.css";
import "@/shared/styles/globals.css";
import { UpdaterProvider } from "@/features/settings/hooks/UpdaterProvider";
import { migrateLegacyCommunityStorageBeforeRender } from "@/features/communities/legacyCommunityStorage";
import { CommunitiesProvider } from "@/features/communities/useCommunities";
import { CommunityOnboardingProvider } from "@/features/onboarding/communityOnboarding";
import { ThemeProvider } from "@/shared/theme/ThemeProvider";
import { EmojiBurstProvider } from "@/shared/ui/EmojiBurstProvider";
import { PoofBurstProvider } from "@/shared/ui/PoofBurstProvider";
import { Toaster } from "@/shared/ui/sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import { recoverLocalStorageQuotaOnStartup } from "@/shared/lib/localStorageQuota";

type E2eWindow = Window & {
  __BUZZ_E2E__?: unknown;
};

const E2E_DEFAULT_PUBKEY = "deadbeef".repeat(8);
const E2E_COMMUNITY_ID = "e2e-default-community";
const ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX = "buzz-onboarding-complete.v1:";
const DEV_STATE_RESET_PARAM = "resetDevState";
const DOBIUS_IDENTITY_STORAGE_KEY = "dobius-buzz-identity.v1";

type DobiusIdentity = {
  privateKey: string;
  pubkey: string;
  username: string;
};

function getOrCreateDobiusIdentity(): DobiusIdentity {
  const stored = window.localStorage.getItem(DOBIUS_IDENTITY_STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<DobiusIdentity>;
      if (
        typeof parsed.privateKey === "string" &&
        typeof parsed.pubkey === "string" &&
        typeof parsed.username === "string"
      ) {
        return parsed as DobiusIdentity;
      }
    } catch {
      // Replace corrupt local development identity state below.
    }
  }

  const secret = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = Array.from(secret, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const identity = {
    privateKey,
    pubkey: getPublicKey(secret),
    username: "Dobius User",
  };
  window.localStorage.setItem(
    DOBIUS_IDENTITY_STORAGE_KEY,
    JSON.stringify(identity),
  );
  return identity;
}

function resetDevWebviewStateFromUrl() {
  if (!import.meta.env.DEV) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get(DEV_STATE_RESET_PARAM) !== "1") {
    return;
  }

  // WebKit groups every Buzz binary under one disk directory, but storage is
  // isolated by origin. Clearing here resets only this dev server's origin;
  // deleting the shared WebKit directory would also destroy installed-app state.
  window.localStorage.clear();
  window.sessionStorage.clear();
  url.searchParams.delete(DEV_STATE_RESET_PARAM);
  window.history.replaceState(window.history.state, "", url);
}

function configureDevE2eBridgeFromUrl() {
  // Why: Dobius embeds the compiled E2E renderer, not Vite's development
  // server. Keep URL-controlled mock activation available in that explicit
  // build mode so the UI does not wait forever for the removed Tauri shell.
  if (!(import.meta.env.DEV || import.meta.env.MODE === "e2e")) {
    return;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("embed") === "dobius") {
    const identity = getOrCreateDobiusIdentity();
    const relayUrl = "ws://localhost:3300";
    const e2eWindow = window as E2eWindow;
    e2eWindow.__BUZZ_E2E__ = {
      mode: "relay",
      identity,
      relayWsUrl: relayUrl,
      relayHttpUrl: "http://localhost:3300",
      autoConnectDefaultRelay: true,
    };

    const community = {
      addedAt: new Date().toISOString(),
      id: "dobius-local-community",
      name: "Dobius",
      pubkey: identity.pubkey,
      relayUrl,
    };
    window.localStorage.setItem("buzz-communities", JSON.stringify([community]));
    window.localStorage.setItem("buzz-active-community-id", community.id);
    window.localStorage.setItem(
      `${ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX}${identity.pubkey}`,
      "true",
    );
    return;
  }

  if (url.searchParams.get("e2e") !== "mock") {
    return;
  }

  const e2eWindow = window as E2eWindow;
  e2eWindow.__BUZZ_E2E__ ??= { mode: "mock" };

  const community = {
    addedAt: new Date().toISOString(),
    id: E2E_COMMUNITY_ID,
    name: "E2E Test",
    relayUrl: "ws://localhost:3000",
  };
  window.localStorage.setItem("buzz-communities", JSON.stringify([community]));
  window.localStorage.setItem("buzz-active-community-id", E2E_COMMUNITY_ID);
  window.localStorage.setItem(
    `${ONBOARDING_COMPLETION_STORAGE_KEY_PREFIX}${E2E_DEFAULT_PUBKEY}`,
    "true",
  );
}

function renderApp() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <CommunitiesProvider>
        <CommunityOnboardingProvider>
          <ThemeProvider defaultTheme="buzz">
            <TooltipProvider delayDuration={300}>
              <EmojiBurstProvider>
                <PoofBurstProvider>
                  <UpdaterProvider>
                    <App />
                    <NostrBindConsentDialog />
                  </UpdaterProvider>
                  <Toaster />
                </PoofBurstProvider>
              </EmojiBurstProvider>
            </TooltipProvider>
          </ThemeProvider>
        </CommunityOnboardingProvider>
      </CommunitiesProvider>
    </React.StrictMode>,
  );
}

async function installE2eBridgeIfConfigured() {
  // The mock bridge is compiled only into dev and explicit E2E builds. A
  // pre-bootstrap global alone must never activate mock IPC in production.
  if (
    !(import.meta.env.DEV || import.meta.env.MODE === "e2e") ||
    !(window as E2eWindow).__BUZZ_E2E__
  ) {
    return;
  }

  const { maybeInstallE2eTauriMocks } = await import("@/testing/e2eBridge");
  maybeInstallE2eTauriMocks();
}

async function bootstrap() {
  resetDevWebviewStateFromUrl();
  configureDevE2eBridgeFromUrl();
  recoverLocalStorageQuotaOnStartup();
  await installE2eBridgeIfConfigured();
  await migrateLegacyCommunityStorageBeforeRender();
  renderApp();
}

void bootstrap();
