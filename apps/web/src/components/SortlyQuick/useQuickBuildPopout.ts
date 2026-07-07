import { useEffect, useRef } from "react";

import { isSortlyQuickWorkspace } from "./createSortlyQuick";

// Threads that already surfaced the canvas pop-out. Module-level so the
// "once per thread" guarantee survives ChatView unmount/remount (e.g. the
// user switches threads and comes back mid-build).
const firedThreadKeys = new Set<string>();

// Sortly Quick canvas hand-off, part 2: the pop-out opens BEHIND Pallet by
// ChatView's auto-open effect when the Quick thread becomes active. When the
// agent's FIRST turn in the Quick's thread finishes — working transitions
// true → false — bring the pop-out to the front so the user knows the
// prototype is ready. Fires at most once per thread; repeated focus-stealing
// on every turn would be worse than never surfacing the window.
export function useQuickBuildPopout(input: {
  readonly workspaceRoot: string | null;
  readonly threadKey: string | null;
  // Must be a REAL build signal (phase running / send in flight) — do NOT pass
  // a composite that includes connection churn, or reopening an old completed
  // thread can flicker true → false and steal focus with no build having run.
  readonly isWorking: boolean;
  // True once the thread has a settled turn — i.e. the agent actually produced
  // a response. Guards against `isWorking` flickers (connect/dispatch churn)
  // that transition true → false before any build happened.
  readonly hasCompletedTurn: boolean;
}): void {
  const { workspaceRoot, threadKey, isWorking, hasCompletedTurn } = input;

  // Previous (threadKey, working) pair observed by THIS mount. Requiring
  // prevWorking === true on the same thread key means we only react to a real
  // run→idle transition we watched happen — never on mount, thread switches,
  // or spurious flickers. Draft threads have a null key until the first send
  // promotes them to a server thread, so the transition is observed there.
  const prevRef = useRef<{ threadKey: string | null; working: boolean }>({
    threadKey: null,
    working: false,
  });

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { threadKey, working: isWorking };

    if (!threadKey || !workspaceRoot || !isSortlyQuickWorkspace(workspaceRoot)) return;
    if (!(prev.threadKey === threadKey && prev.working && !isWorking)) return;
    if (!hasCompletedTurn) return;
    if (firedThreadKeys.has(threadKey)) return;
    firedThreadKeys.add(threadKey);

    // Main process no-ops if the pop-out was closed or never opened.
    void window.desktopBridge?.browserFocusPopout?.().catch(() => undefined);
  }, [threadKey, workspaceRoot, isWorking, hasCompletedTurn]);
}
