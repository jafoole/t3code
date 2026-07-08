import { scopeThreadRef } from "@t3tools/client-runtime";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { useParams, useRouter } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore } from "../../composerDraftStore";
import { readEnvironmentApi } from "../../environmentApi";
import type { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useSettings } from "../../hooks/useSettings";
import { newCommandId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { selectSidebarThreadsForProjectRefs, useStore } from "../../store";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../threadRoutes";
import { resolveThreadRowClassName } from "../Sidebar.logic";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";

type HandleNewThread = ReturnType<typeof useNewThreadHandler>["handleNewThread"];

interface SortlyQuickListProps {
  quicks: readonly SidebarProjectSnapshot[];
  /** Logical project key of the currently-open thread's project, if any. */
  activeRouteProjectKey: string | null;
  handleNewThread: HandleNewThread;
}

/**
 * Flat list of Sortly Quicks, rendered under the "Sortly Quicks" section.
 *
 * A Quick is a single prototype, not a multi-thread project — so each row is
 * the prototype itself: click to open its conversation/canvas, hover for
 * rename/delete. We deliberately don't show the project chrome (expand
 * chevron, thread list, "new thread" button) that confused the project model.
 */
export function SortlyQuickList({
  quicks,
  activeRouteProjectKey,
  handleNewThread,
}: SortlyQuickListProps) {
  // A just-created Quick lives on /draft/$draftId — no server thread yet, so
  // activeRouteProjectKey (thread-derived) can't match it. Resolve the active
  // draft's project reactively so the row still highlights.
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const activeDraftId = routeTarget?.kind === "draft" ? routeTarget.draftId : null;
  const activeDraftSession = useComposerDraftStore((store) =>
    activeDraftId ? store.getDraftSession(activeDraftId) : null,
  );
  const activeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;

  if (quicks.length === 0) {
    return null;
  }

  return (
    <SidebarMenu className="gap-0.5 px-2 pb-1">
      {quicks.map((quick) => {
        const isDraftActive =
          activeDraftSession != null &&
          quick.memberProjectRefs.some(
            (ref) =>
              ref.projectId === activeDraftSession.projectId &&
              ref.environmentId === activeDraftSession.environmentId,
          );
        return (
          <SortlyQuickRow
            key={quick.projectKey}
            quick={quick}
            isActive={activeRouteProjectKey === quick.projectKey || isDraftActive}
            activeThreadRef={activeThreadRef}
            handleNewThread={handleNewThread}
          />
        );
      })}
    </SidebarMenu>
  );
}

function SortlyQuickRow({
  quick,
  isActive,
  activeThreadRef,
  handleNewThread,
}: {
  quick: SidebarProjectSnapshot;
  isActive: boolean;
  activeThreadRef: ScopedThreadRef | null;
  handleNewThread: HandleNewThread;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const primaryRef = quick.memberProjectRefs[0];

  // A Quick has one conversation. Reactively track its newest live thread so
  // the row shows the same descriptive name as the header (the thread title) —
  // not the static "Quick — <date>" project name.
  const liveThreads = useStore(
    useShallow((state) =>
      selectSidebarThreadsForProjectRefs(state, quick.memberProjectRefs).filter(
        (thread) => thread.archivedAt === null,
      ),
    ),
  );
  const sortedThreads = useMemo(
    () =>
      [...liveThreads].sort((a, b) =>
        (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
      ),
    [liveThreads],
  );
  const newestThread = sortedThreads[0] ?? null;
  // A Quick normally has one conversation, but extra threads can exist (e.g.
  // started from the project view). Surface them as sub-rows so no work is
  // ever hidden behind the newest thread.
  const olderThreads = sortedThreads.slice(1);
  // The thread title is the descriptive name; fall back to the project name for
  // an unsent (empty) Quick that has no thread yet.
  const displayName = newestThread?.title?.trim() || quick.name;
  const [draftName, setDraftName] = useState(displayName);
  const confirmThreadDelete = useSettings((settings) => settings.confirmThreadDelete);

  // Open the Quick's single conversation: its newest live thread, or its
  // pending draft if it hasn't been sent yet, or a fresh thread as a fallback.
  const openQuick = () => {
    if (!primaryRef) {
      return;
    }
    if (newestThread) {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(
          scopeThreadRef(newestThread.environmentId, newestThread.id),
        ),
      });
      return;
    }
    const draft = useComposerDraftStore.getState().getDraftSessionByProjectRef(primaryRef);
    if (draft) {
      void router.navigate({ to: "/draft/$draftId", params: { draftId: draft.draftId } });
      return;
    }
    void handleNewThread(primaryRef, { envMode: "local" });
  };

  const removeQuick = async () => {
    if (!primaryRef) {
      return;
    }
    // Honor the same "Delete confirmation" setting threads use — deleting a
    // Quick is even more destructive (server prototype + gallery entry +
    // workspace), so ask first unless the user turned confirmations off.
    if (confirmThreadDelete) {
      const message = [
        `Delete "${displayName}"?`,
        "This deletes the Quick everywhere — its prototype on the server, its gallery entry, and the local workspace.",
      ].join("\n");
      const localApi = readLocalApi();
      // If the local API isn't available, fall back to window.confirm — an
      // enabled confirmation must never be silently skipped.
      const confirmed = localApi ? await localApi.dialogs.confirm(message) : window.confirm(message);
      if (!confirmed) {
        return;
      }
    }
    // Delete everywhere first: the server prototype (which also pulls it from
    // the gallery) and the local workspace folder — the snapshot's cwd is the
    // Quick's workspace root. If that fails (offline, server down), abort the
    // whole delete: the workspace manifest holds the only edit token, so the
    // Quick must stay in the sidebar for the user to retry later.
    let remoteError: string | null = null;
    try {
      const remote = await window.desktopBridge?.sortlyQuickDelete?.(quick.cwd);
      if (remote && "error" in remote) {
        remoteError = remote.error;
      }
    } catch (cause) {
      remoteError = cause instanceof Error ? cause.message : String(cause);
    }
    if (remoteError) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Couldn't delete "${displayName}"`,
          description: remoteError,
        }),
      );
      return;
    }
    const draftStore = useComposerDraftStore.getState();
    const projectDraft = draftStore.getDraftThreadByProjectRef(primaryRef);
    if (projectDraft) {
      draftStore.clearDraftThread(projectDraft.draftId);
    }
    draftStore.clearProjectDraftThreadId(primaryRef);
    const api = readEnvironmentApi(primaryRef.environmentId);
    if (!api) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to delete "${displayName}"`,
          description: "No backend connection — please try again.",
        }),
      );
      return;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: primaryRef.projectId,
      });
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: `Deleted "${displayName}"`,
          description: "Deleted — removed from the gallery and server too.",
        }),
      );
    } catch (cause) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to delete "${displayName}"`,
          description: cause instanceof Error ? cause.message : "Please try again.",
        }),
      );
    }
  };

  const commitRename = async () => {
    const next = draftName.trim();
    setRenaming(false);
    if (next.length === 0 || next === displayName) {
      return;
    }
    try {
      // Rename the thread (its title is what the row + header show). For an
      // unsent Quick with no thread yet, rename the project instead.
      if (newestThread) {
        const api = readEnvironmentApi(newestThread.environmentId);
        if (!api) return;
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: newestThread.id,
          title: next,
        });
        // If the Quick is published, best-effort sync the new name to the
        // gallery (the publish POST is idempotent and patches the name
        // server-side). Failures are swallowed — the rename itself succeeded.
        try {
          const state = await window.desktopBridge?.sortlyQuickPublishState?.(quick.cwd);
          if (state?.isPublic) {
            await window.desktopBridge?.sortlyQuickPublish?.(quick.cwd, true, next);
          }
        } catch {
          // Best-effort only — never surface gallery sync failures on rename.
        }
      } else if (primaryRef) {
        const api = readEnvironmentApi(primaryRef.environmentId);
        if (!api) return;
        await api.orchestration.dispatchCommand({
          type: "project.meta.update",
          commandId: newCommandId(),
          projectId: primaryRef.projectId,
          title: next,
        });
      }
    } catch (cause) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Couldn't rename "${displayName}"`,
          description: cause instanceof Error ? cause.message : "Please try again.",
        }),
      );
    }
  };

  const showMenu = async (clientX: number, clientY: number) => {
    const api = readLocalApi();
    if (!api) {
      return;
    }
    const items: ContextMenuItem<string>[] = [
      { id: "rename", label: "Rename" },
      { id: "delete", label: "Delete", destructive: true },
    ];
    const clicked = await api.contextMenu.show(items, { x: clientX, y: clientY });
    if (clicked === "rename") {
      setDraftName(displayName);
      setRenaming(true);
    } else if (clicked === "delete") {
      void removeQuick();
    }
  };

  if (renaming) {
    return (
      <SidebarMenuItem>
        <input
          autoFocus
          value={draftName}
          aria-label={`Rename ${displayName}`}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraftName(displayName);
              setRenaming(false);
            }
          }}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        />
      </SidebarMenuItem>
    );
  }

  return (
    <>
      <SidebarMenuItem className="group/quick relative">
        <SidebarMenuButton
          size="sm"
          isActive={isActive}
          className={`${resolveThreadRowClassName({ isActive, isSelected: false })} gap-2 pr-7`}
          onClick={openQuick}
          onContextMenu={(event) => {
            event.preventDefault();
            void showMenu(event.clientX, event.clientY);
          }}
        >
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
          <span className="flex-1 truncate text-left text-xs">{displayName}</span>
        </SidebarMenuButton>
        <button
          type="button"
          aria-label={`Actions for ${displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            void showMenu(event.clientX, event.clientY);
          }}
          className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/quick:opacity-100"
        >
          <MoreVerticalIcon className="size-3.5" />
        </button>
      </SidebarMenuItem>
      {olderThreads.map((thread) => {
        const threadTitle = thread.title?.trim() || "Untitled thread";
        const isThreadActive =
          activeThreadRef !== null &&
          activeThreadRef.threadId === thread.id &&
          activeThreadRef.environmentId === thread.environmentId;
        return (
          <SidebarMenuItem key={`${thread.environmentId}:${thread.id}`}>
            <SidebarMenuButton
              size="sm"
              isActive={isThreadActive}
              className={`${resolveThreadRowClassName({ isActive: isThreadActive, isSelected: false })} gap-2 pl-6`}
              onClick={() => {
                void router.navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(
                    scopeThreadRef(thread.environmentId, thread.id),
                  ),
                });
              }}
            >
              <span className="flex-1 truncate text-left text-xs text-muted-foreground">
                {threadTitle}
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        );
      })}
    </>
  );
}
