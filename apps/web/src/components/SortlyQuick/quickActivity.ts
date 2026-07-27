import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useMemo } from "react";

import { useThreadShellsForProjectRefs } from "../../state/entities";

/**
 * "Last activity" for a Sortly Quick.
 *
 * Deliberately derived from the Quick's newest live THREAD, not the project's
 * `updatedAt`. Projects and threads are separate projections server-side, and
 * the project row is only rewritten by project.* commands — chatting inside a
 * Quick never touches it. Ordering on the project timestamp would leave a Quick
 * you worked in all afternoon sitting at the bottom of the list.
 */
export interface QuickActivity {
  /** Live threads, newest first. */
  readonly threads: readonly EnvironmentThreadShell[];
  readonly newestThread: EnvironmentThreadShell | null;
  /** ISO timestamp of the most recent thread activity, or null if no thread yet. */
  readonly lastActivityAt: string | null;
}

const EMPTY_ACTIVITY: QuickActivity = { threads: [], newestThread: null, lastActivityAt: null };

function threadStamp(thread: EnvironmentThreadShell): string {
  return thread.updatedAt ?? thread.createdAt;
}

function refKey(environmentId: string, projectId: string): string {
  return `${environmentId}:${projectId}`;
}

/**
 * Index live threads by project for a whole set of Quicks in ONE hook call.
 *
 * Callers must memoize `refs` — it keys an Atom.family, so a fresh array each
 * render would allocate a new atom every time.
 */
export function useQuickActivityIndex(
  refs: readonly ScopedProjectRef[],
): ReadonlyMap<string, QuickActivity> {
  const shells = useThreadShellsForProjectRefs(refs);
  return useMemo(() => {
    const byProject = new Map<string, EnvironmentThreadShell[]>();
    for (const thread of shells) {
      if (thread.archivedAt !== null) continue;
      const key = refKey(thread.environmentId, thread.projectId);
      const existing = byProject.get(key);
      if (existing) existing.push(thread);
      else byProject.set(key, [thread]);
    }
    const index = new Map<string, QuickActivity>();
    for (const [key, threads] of byProject) {
      threads.sort((a, b) => threadStamp(b).localeCompare(threadStamp(a)));
      const newestThread = threads[0] ?? null;
      index.set(key, {
        threads,
        newestThread,
        lastActivityAt: newestThread ? threadStamp(newestThread) : null,
      });
    }
    return index;
  }, [shells]);
}

/**
 * Collapse a Quick's (possibly grouped) project refs into a single activity
 * record. `fallbackCreatedAt` covers a freshly-created Quick whose draft hasn't
 * been sent yet — it has no thread, but should still sort as brand new rather
 * than falling to the bottom.
 */
export function resolveQuickActivity(
  index: ReadonlyMap<string, QuickActivity>,
  refs: readonly ScopedProjectRef[],
  fallbackCreatedAt: string,
): QuickActivity & { readonly sortKey: string } {
  let merged: QuickActivity = EMPTY_ACTIVITY;
  if (refs.length === 1) {
    const only = refs[0];
    merged = (only && index.get(refKey(only.environmentId, only.projectId))) || EMPTY_ACTIVITY;
  } else {
    const threads: EnvironmentThreadShell[] = [];
    for (const ref of refs) {
      const entry = index.get(refKey(ref.environmentId, ref.projectId));
      if (entry) threads.push(...entry.threads);
    }
    threads.sort((a, b) => threadStamp(b).localeCompare(threadStamp(a)));
    const newestThread = threads[0] ?? null;
    merged = {
      threads,
      newestThread,
      lastActivityAt: newestThread ? threadStamp(newestThread) : null,
    };
  }
  return { ...merged, sortKey: merged.lastActivityAt ?? fallbackCreatedAt };
}

/** "4 days ago" for the last week, then an absolute date — mirrors Claude's list. */
export function formatQuickTimestamp(iso: string, now: Date): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const diffMs = now.getTime() - then.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  if (diffMs < 60 * 1000) return "just now";
  if (diffMs < 60 * 60 * 1000) {
    const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
    return `${mins} min${mins === 1 ? "" : "s"} ago`;
  }
  if (diffMs < dayMs) {
    const hours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)));
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.floor(diffMs / dayMs);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  const sameYear = then.getFullYear() === now.getFullYear();
  return then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
