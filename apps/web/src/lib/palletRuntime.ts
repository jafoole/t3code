/**
 * Adapter between Pallet's features and upstream T3 Code's state layer.
 *
 * Upstream's "Rewrite client connection architecture" (#2978) removed the
 * Zustand store (`../../store`), the imperative environment runtime
 * (`../../environments/runtime`) and `../../environmentApi`, replacing them
 * with Effect atoms. Two of Pallet's flows are non-React — the GitHub auth
 * Zustand store and `createSortlyQuick` — so they cannot call upstream's hooks.
 *
 * `useAtomCommand` is only a thin wrapper over `runAtomCommand`, so the
 * imperative path is supported; it just isn't exposed anywhere convenient.
 * Everything Pallet needs is funnelled through this one module so the next
 * upstream merge conflicts here instead of across four feature files.
 */
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  CreateProjectInput,
  DeleteProjectInput,
  UpdateProjectInput,
} from "@t3tools/client-runtime/state/projects";
import type { UpdateThreadMetadataInput } from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { environmentProjects, projectEnvironment } from "../state/projects";
import { primaryServerProvidersAtom, primaryServerSettingsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";

/** Non-React read of the primary environment id (replaces `getPrimaryEnvironmentConnection`). */
export function readPrimaryEnvironmentId(): EnvironmentId | null {
  return appAtomRegistry.get(primaryEnvironmentIdAtom);
}

/** Non-React read of every known project (replaces `selectProjectsAcrossEnvironments`). */
export function readProjectsAcrossEnvironments(): ReadonlyArray<EnvironmentProject> {
  return appAtomRegistry.get(environmentProjects.projectsAtom);
}

/** Non-React read of the primary environment's provider snapshots. */
export function readPrimaryServerProviders(): ReadonlyArray<ServerProvider> {
  return appAtomRegistry.get(primaryServerProvidersAtom);
}

/**
 * Non-React read of the primary environment's settings. Client-local keys
 * come back as defaults (same merge as `mergeEnvironmentSettings` in
 * `hooks/useSettings`, inlined so this adapter stays hook-free) — callers
 * here only consume the server-authoritative provider/model fields.
 */
export function readPrimaryUnifiedSettings(): UnifiedSettings {
  return { ...appAtomRegistry.get(primaryServerSettingsAtom), ...DEFAULT_CLIENT_SETTINGS };
}

export function createProjectCommand(environmentId: EnvironmentId, input: CreateProjectInput) {
  return runAtomCommand(
    appAtomRegistry,
    projectEnvironment.create,
    { environmentId, input },
    { label: "pallet:project:create", reportFailure: true, reportDefect: true },
  );
}

export function updateProjectCommand(environmentId: EnvironmentId, input: UpdateProjectInput) {
  return runAtomCommand(
    appAtomRegistry,
    projectEnvironment.update,
    { environmentId, input },
    { label: "pallet:project:update", reportFailure: true, reportDefect: true },
  );
}

export function deleteProjectCommand(environmentId: EnvironmentId, input: DeleteProjectInput) {
  return runAtomCommand(
    appAtomRegistry,
    projectEnvironment.delete,
    { environmentId, input },
    { label: "pallet:project:delete", reportFailure: true, reportDefect: true },
  );
}

export function updateThreadMetadataCommand(
  environmentId: EnvironmentId,
  input: UpdateThreadMetadataInput,
) {
  return runAtomCommand(
    appAtomRegistry,
    threadEnvironment.updateMetadata,
    { environmentId, input },
    { label: "pallet:thread:update-metadata", reportFailure: true, reportDefect: true },
  );
}

/**
 * Replaces `waitForSavedEnvironmentRegistryHydration`. The GitHub bootstrap
 * auto-creates a project at most once, and used this to avoid racing an
 * un-hydrated project list (which previously produced duplicate projects on
 * nearly every launch). Atoms hydrate lazily, so we poll until the primary
 * environment resolves rather than block forever if none ever does.
 */
export async function waitForPrimaryEnvironment(timeoutMs = 10_000): Promise<EnvironmentId | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const environmentId = readPrimaryEnvironmentId();
    if (environmentId !== null) return environmentId;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
