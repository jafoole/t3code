import type { ModelSelection, ScopedProjectRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";

import { createProjectCommand, readPrimaryEnvironmentId } from "../../lib/palletRuntime";
import { newCommandId, newProjectId } from "../../lib/utils";

export const QUICKS_PATH_SEGMENT = "/Sortly Quicks/";

export function isSortlyQuickWorkspace(workspaceRoot: string | null | undefined): boolean {
  return typeof workspaceRoot === "string" && workspaceRoot.includes(QUICKS_PATH_SEGMENT);
}

export function defaultQuickName(now = new Date()): string {
  const date = now.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = now.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  return `Quick — ${date} ${time}`;
}

export async function createSortlyQuick(
  name: string,
  /**
   * Provider the new Quick's project defaults to. Passed in rather than
   * hardcoded: the project default propagates to the Quick's thread, so
   * assuming a driver here silently starts every Quick on it — and hard-fails
   * with `ProviderValidationError` if the user has that provider disabled.
   * Resolved from actually-enabled providers by `useCreateQuick`.
   */
  defaultModelSelection: ModelSelection,
): Promise<{ projectRef: ScopedProjectRef; editUrl: string } | { error: string }> {
  const bridge = window.desktopBridge;
  if (!bridge?.sortlyQuickCreate) {
    return { error: "Sortly Quick requires the Pallet desktop app." };
  }

  const environmentId = readPrimaryEnvironmentId();
  if (!environmentId) {
    return { error: "No backend connection yet — try again in a moment." };
  }

  const created = await bridge.sortlyQuickCreate(name);
  if ("error" in created) {
    return { error: created.error };
  }

  const projectId = newProjectId();
  await createProjectCommand(environmentId, {
    commandId: newCommandId(),
    projectId,
    title: created.name,
    workspaceRoot: created.path,
    createWorkspaceRootIfMissing: false,
    defaultModelSelection,
    createdAt: new Date().toISOString(),
  });

  return {
    projectRef: scopeProjectRef(environmentId, projectId),
    editUrl: created.editUrl,
  };
}
