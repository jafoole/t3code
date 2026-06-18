import { DEFAULT_MODEL, ProviderInstanceId, type ScopedProjectRef } from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { newCommandId, newProjectId } from "../../lib/utils";
import { openPreviewPopout } from "../Browser/openPreview";

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

// Opens the Quick's edit URL in the pop-out browser window. Deferred a tick so
// it lands after ChatView's scope-change effect runs on navigation.
export function openQuickCanvas(editUrl: string): void {
  setTimeout(() => {
    openPreviewPopout(editUrl);
  }, 50);
}

export async function createSortlyQuick(
  name: string,
): Promise<{ projectRef: ScopedProjectRef; editUrl: string } | { error: string }> {
  const bridge = window.desktopBridge;
  if (!bridge?.sortlyQuickCreate) {
    return { error: "Sortly Quick requires the Pallet desktop app." };
  }

  const conn = getPrimaryEnvironmentConnection();
  if (!conn) {
    return { error: "No backend connection yet — try again in a moment." };
  }

  const created = await bridge.sortlyQuickCreate(name);
  if ("error" in created) {
    return { error: created.error };
  }

  const projectId = newProjectId();
  await conn.client.orchestration.dispatchCommand({
    type: "project.create",
    commandId: newCommandId(),
    projectId,
    title: created.name,
    workspaceRoot: created.path,
    createWorkspaceRootIfMissing: false,
    defaultModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    },
    createdAt: new Date().toISOString(),
  });

  return {
    projectRef: scopeProjectRef(conn.environmentId, projectId),
    editUrl: created.editUrl,
  };
}
