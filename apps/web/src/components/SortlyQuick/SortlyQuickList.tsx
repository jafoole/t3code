import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ContextMenuItem, ScopedThreadRef } from "@t3tools/contracts";
import { Link, useParams, useRouter } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import {
  deleteProjectCommand,
  updateProjectCommand,
  updateThreadMetadataCommand,
} from "../../lib/palletRuntime";
import type { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useClientSettings } from "../../hooks/useSettings";
import { newCommandId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../../threadRoutes";
import { resolveThreadRowClassName } from "../Sidebar.logic";
import { resolveQuickActivity, useQuickActivityIndex } from "./quickActivity";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";

type HandleNewThread = ReturnType<typeof useNewThreadHandler>;

/** Keep the sidebar section short; everything else lives on the /quicks page. */
const SIDEBAR_QUICK_LIMIT = 6;

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

  // One hook call for every Quick, not one per row: the parent needs each
  // Quick's last activity to order and truncate the list, and that lives in the
  // threads. Memoized because `refs` keys an Atom.family.
  const allRefs = useMemo(() => quicks.flatMap((quick) => quick.memberProjectRefs), [quicks]);
  const activityIndex = useQuickActivityIndex(allRefs);

  const ordered = useMemo(() => {
    return quicks
      .map((quick) => ({
        quick,
        activity: resolveQuickActivity(activityIndex, quick.memberProjectRefs, quick.createdAt),
      }))
      .sort((a, b) => b.activity.sortKey.localeCompare(a.activity.sortKey));
  }, [quicks, activityIndex]);

  if (quicks.length === 0) {
    return null;
  }

  const visible = ordered.slice(0, SIDEBAR_QUICK_LIMIT);

  return (
    <SidebarMenu className="gap-0.5 px-2 pb-1">
      {visible.map(({ quick, activity }) => {
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
            threads={activity.threads}
            isActive={activeRouteProjectKey === quick.projectKey || isDraftActive}
            activeThreadRef={activeThreadRef}
            handleNewThread={handleNewThread}
          />
        );
      })}
      {ordered.length > 0 && <ViewAllQuicksRow total={ordered.length} />}
    </SidebarMenu>
  );
}

function ViewAllQuicksRow({ total }: { total: number }) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        className="justify-between text-muted-foreground hover:text-foreground"
        render={<Link to="/quicks" />}
      >
        <span>View all</span>
        <span className="text-[10px] tabular-nums text-muted-foreground/70">{total}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function SortlyQuickRow({
  quick,
  threads,
  isActive,
  activeThreadRef,
  handleNewThread,
}: {
  quick: SidebarProjectSnapshot;
  /** Live threads for this Quick, newest first — resolved once by the parent. */
  threads: readonly EnvironmentThreadShell[];
  isActive: boolean;
  activeThreadRef: ScopedThreadRef | null;
  handleNewThread: HandleNewThread;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const primaryRef = quick.memberProjectRefs[0];

  // A Quick has one conversation; the newest thread's title is the descriptive
  // name shown in the row (not the static "Quick — <date>" project name).
  const sortedThreads = threads;
  const newestThread = sortedThreads[0] ?? null;
  // A Quick normally has one conversation, but extra threads can exist (e.g.
  // started from the project view). Surface them as sub-rows so no work is
  // ever hidden behind the newest thread.
  const olderThreads = sortedThreads.slice(1);
  // The thread title is the descriptive name; fall back to the project name for
  // an unsent (empty) Quick that has no thread yet.
  const displayName = newestThread?.title?.trim() || quick.displayName;
  const [draftName, setDraftName] = useState(displayName);
  const confirmThreadDelete = useClientSettings((settings) => settings.confirmThreadDelete);

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
      const remote = await window.desktopBridge?.sortlyQuickDelete?.(quick.workspaceRoot);
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
    try {
      await deleteProjectCommand(primaryRef.environmentId, {
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
        await updateThreadMetadataCommand(newestThread.environmentId, {
          commandId: newCommandId(),
          threadId: newestThread.id,
          title: next,
        });
        // If the Quick is published, best-effort sync the new name to the
        // gallery (the publish POST is idempotent and patches the name
        // server-side). Failures are swallowed — the rename itself succeeded.
        try {
          const state = await window.desktopBridge?.sortlyQuickPublishState?.(quick.workspaceRoot);
          if (state?.isPublic) {
            await window.desktopBridge?.sortlyQuickPublish?.(quick.workspaceRoot, true, next);
          }
        } catch {
          // Best-effort only — never surface gallery sync failures on rename.
        }
      } else if (primaryRef) {
        await updateProjectCommand(primaryRef.environmentId, {
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
