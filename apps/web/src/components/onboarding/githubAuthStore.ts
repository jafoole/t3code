import { create } from "zustand";
import { DEFAULT_MODEL, ProviderInstanceId, type GithubUser } from "@t3tools/contracts";
import {
  waitForSavedEnvironmentRegistryHydration,
} from "../../environments/runtime";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { findProjectByPath } from "../../lib/projectPaths";
import { newCommandId, newProjectId } from "../../lib/utils";

export type GithubAuthStatus =
  | "loading"
  | "signed-out"
  | "awaiting-approval"
  | "setting-up"
  | "signed-in"
  | "error";

interface GithubAuthState {
  readonly status: GithubAuthStatus;
  readonly userCode: string | undefined;
  readonly verificationUri: string | undefined;
  readonly deviceCode: string | undefined;
  readonly pollInterval: number | undefined;
  readonly user: GithubUser | undefined;
  readonly error: string | undefined;
  readonly bootstrap: () => Promise<void>;
  readonly startSignIn: () => Promise<void>;
  readonly cancelSignIn: () => void;
  readonly signOut: () => Promise<void>;
}

let pollAborted = false;

/**
 * Demo mode: plays through the full sign-in experience with realistic timing
 * but never contacts GitHub, never clones, and never creates a project.
 *
 * Toggle from the DevTools console:
 *   localStorage.setItem("pallet-github-demo", "1")   // enable, then reload
 *   localStorage.removeItem("pallet-github-demo")      // disable, then reload
 *
 * Also enabled via the `?githubDemo` URL query param.
 */
export function isGithubDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (window.localStorage.getItem("pallet-github-demo") === "1") return true;
    return new URLSearchParams(window.location.search).has("githubDemo");
  } catch {
    return false;
  }
}

const DEMO_USER: GithubUser = {
  login: "sortly-demo",
  name: "Sortly Demo",
  avatar_url: "https://avatars.githubusercontent.com/u/9919?v=4",
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runDemoSignIn(): Promise<void> {
  pollAborted = false;
  useGithubAuthStore.setState({ status: "loading", error: undefined });
  await delay(450);
  if (pollAborted) return;

  useGithubAuthStore.setState({
    status: "awaiting-approval",
    userCode: "WXYZ-1234",
    verificationUri: "https://github.com/login/device",
    deviceCode: "demo-device-code",
    pollInterval: 5,
  });

  // Simulate the user approving in the browser after a few seconds.
  await delay(4000);
  if (pollAborted) return;

  useGithubAuthStore.setState({ status: "setting-up" });

  // Simulate cloning the repo.
  await delay(2200);
  if (pollAborted) return;

  useGithubAuthStore.setState({ status: "signed-in", user: DEMO_USER });
}

async function ensureSortlyProject(destPath: string): Promise<void> {
  const conn = getPrimaryEnvironmentConnection();
  if (!conn) return;

  const projects = selectProjectsAcrossEnvironments(useStore.getState()).filter(
    (p) => p.environmentId === conn.environmentId,
  );

  const existing = findProjectByPath(projects, destPath);
  if (existing) return;

  await conn.client.orchestration.dispatchCommand({
    type: "project.create",
    commandId: newCommandId(),
    projectId: newProjectId(),
    title: "Sortly Prototypes",
    workspaceRoot: destPath,
    createWorkspaceRootIfMissing: false,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    },
    createdAt: new Date().toISOString(),
  });
}

async function runPoll(deviceCode: string, currentInterval: number): Promise<void> {
  if (pollAborted) return;

  const state = useGithubAuthStore.getState();
  if (state.status !== "awaiting-approval") return;

  const bridge = window.desktopBridge;
  if (!bridge) return;

  try {
    const result = await bridge.githubAuthPollForToken(deviceCode, currentInterval);

    if (pollAborted) return;

    if (result.status === "success") {
      useGithubAuthStore.setState({ status: "setting-up" });

      const bootstrapResult = await bridge.githubBootstrapProject();

      if ("error" in bootstrapResult) {
        useGithubAuthStore.setState({ status: "error", error: bootstrapResult.error });
        return;
      }

      await ensureSortlyProject(bootstrapResult.path).catch(() => undefined);
      useGithubAuthStore.setState({ status: "signed-in", user: result.user });
      return;
    }

    if (result.status === "denied") {
      useGithubAuthStore.setState({ status: "error", error: "You denied access. Try again?" });
      return;
    }

    if (result.status === "expired") {
      useGithubAuthStore.setState({
        status: "error",
        error: "The authorization request expired. Try again.",
      });
      return;
    }

    if (result.status === "error") {
      useGithubAuthStore.setState({ status: "error", error: result.message });
      return;
    }

    const nextInterval = result.status === "slow_down" ? result.interval : currentInterval;
    if (result.status === "slow_down") {
      useGithubAuthStore.setState({ pollInterval: nextInterval });
    }

    await new Promise<void>((resolve) => setTimeout(resolve, nextInterval * 1000));
    void runPoll(deviceCode, nextInterval);
  } catch (e) {
    if (!pollAborted) {
      useGithubAuthStore.setState({
        status: "error",
        error:
          e instanceof Error ? e.message : "Unable to reach GitHub. Check your connection.",
      });
    }
  }
}

export const useGithubAuthStore = create<GithubAuthState>()((set) => ({
  status: "loading",
  userCode: undefined,
  verificationUri: undefined,
  deviceCode: undefined,
  pollInterval: undefined,
  user: undefined,
  error: undefined,

  bootstrap: async () => {
    if (isGithubDemoMode()) {
      // Always start the demo from the signed-out screen so it can be replayed.
      set({ status: "signed-out", user: undefined, error: undefined });
      return;
    }

    const bridge = window.desktopBridge;
    if (!bridge) {
      set({ status: "signed-in" });
      return;
    }

    try {
      const [storedState] = await Promise.all([
        bridge.githubAuthGetStoredState(),
        waitForSavedEnvironmentRegistryHydration(),
      ]);

      if (storedState.token) {
        set({ status: "signed-in", user: storedState.user ?? undefined });
        void bridge
          .githubBootstrapProject()
          .then((result) => {
            if ("error" in result) return;
            void ensureSortlyProject(result.path).catch(() => undefined);
          })
          .catch(() => undefined);
        return;
      }

      set({ status: "signed-out" });
    } catch {
      set({ status: "signed-out" });
    }
  },

  startSignIn: async () => {
    if (isGithubDemoMode()) {
      await runDemoSignIn();
      return;
    }

    const bridge = window.desktopBridge;
    if (!bridge) return;

    set({ status: "loading", error: undefined });

    try {
      const flowResult = await bridge.githubAuthStartDeviceFlow();
      const { device_code, user_code, verification_uri, interval } = flowResult;

      pollAborted = false;
      set({
        status: "awaiting-approval",
        userCode: user_code,
        verificationUri: verification_uri,
        deviceCode: device_code,
        pollInterval: interval,
      });

      void window.desktopBridge?.openExternal(verification_uri).catch(() => undefined);
      void runPoll(device_code, interval);
    } catch (e) {
      set({
        status: "error",
        error:
          e instanceof Error ? e.message : "Unable to reach GitHub. Check your connection.",
      });
    }
  },

  cancelSignIn: () => {
    pollAborted = true;
    set({
      status: "signed-out",
      userCode: undefined,
      verificationUri: undefined,
      deviceCode: undefined,
      error: undefined,
    });
  },

  signOut: async () => {
    if (isGithubDemoMode()) {
      pollAborted = true;
      set({ status: "signed-out", user: undefined, error: undefined });
      return;
    }

    const bridge = window.desktopBridge;
    if (!bridge) return;
    await bridge.githubAuthSignOut().catch(() => undefined);
    set({ status: "signed-out", user: undefined });
  },
}));
