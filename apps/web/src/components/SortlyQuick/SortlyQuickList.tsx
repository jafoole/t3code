import { scopeThreadRef } from "@t3tools/client-runtime";
import type { ContextMenuItem } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { MoreVerticalIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { readEnvironmentApi } from "../../environmentApi";
import type { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { newCommandId } from "../../lib/utils";
import { readLocalApi } from "../../localApi";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { selectSidebarThreadsForProjectRefs, useStore } from "../../store";
import { buildThreadRouteParams } from "../../threadRoutes";
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
  if (quicks.length === 0) {
    return null;
  }

  return (
    <SidebarMenu className="gap-0.5 px-2 pb-1">
      {quicks.map((quick) => (
        <SortlyQuickRow
          key={quick.projectKey}
          quick={quick}
          isActive={activeRouteProjectKey === quick.projectKey}
          handleNewThread={handleNewThread}
        />
      ))}
    </SidebarMenu>
  );
}

function SortlyQuickRow({
  quick,
  isActive,
  handleNewThread,
}: {
  quick: SidebarProjectSnapshot;
  isActive: boolean;
  handleNewThread: HandleNewThread;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(quick.name);
  const primaryRef = quick.memberProjectRefs[0];

  // Open the Quick's single conversation: its newest live thread, or its
  // pending draft if it hasn't been sent yet, or a fresh thread as a fallback.
  const openQuick = () => {
    if (!primaryRef) {
      return;
    }
    const liveThreads = selectSidebarThreadsForProjectRefs(
      useStore.getState(),
      quick.memberProjectRefs,
    ).filter((thread) => thread.archivedAt === null);
    const newest = [...liveThreads].sort((a, b) =>
      (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt),
    )[0];
    if (newest) {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(newest.environmentId, newest.id)),
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
    const draftStore = useComposerDraftStore.getState();
    const projectDraft = draftStore.getDraftThreadByProjectRef(primaryRef);
    if (projectDraft) {
      draftStore.clearDraftThread(projectDraft.draftId);
    }
    draftStore.clearProjectDraftThreadId(primaryRef);
    const api = readEnvironmentApi(primaryRef.environmentId);
    if (!api) {
      return;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "project.delete",
        commandId: newCommandId(),
        projectId: primaryRef.projectId,
      });
    } catch (cause) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Failed to delete "${quick.name}"`,
          description: cause instanceof Error ? cause.message : "Please try again.",
        }),
      );
    }
  };

  const commitRename = async () => {
    const next = draftName.trim();
    setRenaming(false);
    if (!primaryRef || next.length === 0 || next === quick.name) {
      return;
    }
    const api = readEnvironmentApi(primaryRef.environmentId);
    if (!api) {
      return;
    }
    try {
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: primaryRef.projectId,
        title: next,
      });
    } catch (cause) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Couldn't rename "${quick.name}"`,
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
      setDraftName(quick.name);
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
          aria-label={`Rename ${quick.name}`}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setDraftName(quick.name);
              setRenaming(false);
            }
          }}
          className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-ring"
        />
      </SidebarMenuItem>
    );
  }

  return (
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
        <span className="flex-1 truncate text-left text-xs">{quick.name}</span>
      </SidebarMenuButton>
      <button
        type="button"
        aria-label={`Actions for ${quick.name}`}
        onClick={(event) => {
          event.stopPropagation();
          void showMenu(event.clientX, event.clientY);
        }}
        className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover/quick:opacity-100"
      >
        <MoreVerticalIcon className="size-3.5" />
      </button>
    </SidebarMenuItem>
  );
}
