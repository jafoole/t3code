import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { SearchIcon, ZapIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { isSortlyQuickWorkspace } from "../components/SortlyQuick/createSortlyQuick";
import { useCreateQuick } from "../components/SortlyQuick/NewSortlyQuickButton";
import {
  formatQuickTimestamp,
  resolveQuickActivity,
  useQuickActivityIndex,
} from "../components/SortlyQuick/quickActivity";
import { Button } from "../components/ui/button";
import { useProjects } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";

/**
 * Full list of Sortly Quicks.
 *
 * The sidebar deliberately shows only the few most recent Quicks — this page is
 * where the rest live, with a search that covers just Quicks. Rendered inside
 * the `_chat` layout, so the sidebar stays put.
 */
function QuicksPage() {
  const router = useRouter();
  const handleNewThread = useNewThreadHandler();
  const { create, busy } = useCreateQuick();
  const [query, setQuery] = useState("");

  const projects = useProjects();
  const quicks = useMemo(
    () => projects.filter((project) => isSortlyQuickWorkspace(project.workspaceRoot)),
    [projects],
  );
  const refs = useMemo(
    () => quicks.map((project) => scopeProjectRef(project.environmentId, project.id)),
    [quicks],
  );
  const activityIndex = useQuickActivityIndex(refs);

  const rows = useMemo(() => {
    const now = new Date();
    return quicks
      .map((project) => {
        const ref = scopeProjectRef(project.environmentId, project.id);
        const activity = resolveQuickActivity(activityIndex, [ref], project.createdAt);
        return {
          project,
          ref,
          activity,
          // Same rule as the sidebar: the thread title is the descriptive name;
          // the project title is the placeholder "Quick — <date>".
          name: activity.newestThread?.title?.trim() || project.title,
          stamp: formatQuickTimestamp(activity.sortKey, now),
        };
      })
      .sort((a, b) => b.activity.sortKey.localeCompare(a.activity.sortKey));
  }, [quicks, activityIndex]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(needle));
  }, [rows, query]);

  const openQuick = (row: (typeof rows)[number]) => {
    const newest = row.activity.newestThread;
    if (newest) {
      void router.navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(newest.environmentId, newest.id)),
      });
      return;
    }
    const draft = useComposerDraftStore.getState().getDraftSessionByProjectRef(row.ref);
    if (draft) {
      void router.navigate({ to: "/draft/$draftId", params: { draftId: draft.draftId } });
      return;
    }
    void handleNewThread(row.ref, { envMode: "local" });
  };

  return (
    <div className="flex h-dvh min-w-0 flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden px-6 pt-10">
        <div className="mb-6 flex shrink-0 items-center gap-3">
          <h1 className="flex-1 truncate text-xl font-semibold text-foreground">Sortly Quicks</h1>
          <div className="relative w-56">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Quicks"
              aria-label="Search Quicks"
              className="h-8 w-full rounded-md border border-input bg-popover pr-2 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <Button size="sm" disabled={busy} onClick={() => void create()}>
            <ZapIcon className="size-3.5" />
            {busy ? "Creating…" : "New"}
          </Button>
        </div>

        {filtered.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            {rows.length === 0 ? "No Quicks yet." : `No Quicks match “${query.trim()}”.`}
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pb-10">
            {filtered.map((row) => (
              <button
                key={`${row.ref.environmentId}:${row.ref.projectId}`}
                type="button"
                onClick={() => openQuick(row)}
                className="flex w-full items-center gap-3 border-b border-border/40 px-2 py-3 text-left outline-none transition-colors hover:bg-accent/50 focus-visible:bg-accent/50"
              >
                <ZapIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{row.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.stamp}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const Route = createFileRoute("/_chat/quicks")({
  component: QuicksPage,
});
