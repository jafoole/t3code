import {
  type EnvironmentId,
  type SortlyQuickInfo,
  type SortlyQuickPublishResult,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime";
import { useEffect, useState } from "react";
import {
  CheckIcon,
  ChevronDownIcon,
  FigmaIcon,
  GlobeIcon,
  Share2Icon,
  SparklesIcon,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { selectProjectsAcrossEnvironments, useStore } from "../../store";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager, stackedThreadToast } from "../ui/toast";
import { isSortlyQuickWorkspace } from "./createSortlyQuick";

// The Figma verbs for a Sortly Quick. Both are driven by the agent's standing
// orders in the workspace CLAUDE.md — these just drop the matching instruction
// into the composer so the user can review and send it, instead of having to
// know the magic phrase.
const SEND_TO_FIGMA_PROMPT =
  "Send this design to Figma — rebuild it as a frame using the Pallet DS (web) components, then give me the Figma link.";
const UPDATE_FROM_FIGMA_PROMPT =
  "Update this prototype from my Figma changes. Frame URL: <paste the Figma frame link here>";

// The GitHub-bootstrap dirName for the Sortly Prototypes project (see
// apps/desktop/src/ipc/methods/projectBootstrap.ts BOOTSTRAP_REPOS) — "Make it
// real" hands the Quick off to whichever project lives in that directory.
const PROTOTYPES_CWD_SUFFIX = "/Sortly Prototypes";

// Builds the ready-to-send handoff prompt. Placement is deliberately NOT a
// fill-in-the-blank (users skip those): the repo recipe has the agent inspect
// the prototype + the app's navigation, PROPOSE where it should live, and wait
// for confirmation before building. The user can still pre-empt by appending
// "put it under Workflows" etc. before sending.
function makeItRealPrompt(name: string, quickId: string): string {
  return `Make this Sortly Quick real: bring "${name}" (Quick id ${quickId}) into this app as a real route, following the "Make it real" recipe in CLAUDE.md and docs/make-it-real.md. Run git pull first so the pipeline components are present. Then look at the prototype and this app's navigation, propose where it should live (section, route, page vs. inline), and confirm the placement with me before building — unless I've already told you where, in which case restate it in your plan.`;
}

interface QuickHeaderActionsProps {
  readonly openInCwd: string | null;
  readonly threadEnvironmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId?: DraftId;
  // The active thread's title — pushed to the gallery as the prototype's
  // descriptive name on publish, so it shows that instead of "Quick — <date>".
  readonly quickName?: string;
}

/**
 * Header controls for a Sortly Quick thread: a one-click Share (copies the
 * clean, token-free view URL), a Figma round-trip menu (Send to / Update
 * from), and a Publish button that posts the prototype to the login-gated
 * gallery for the team to see and upvote. Renders nothing for non-Quick
 * threads, so it's inert everywhere else.
 */
export function QuickHeaderActions({
  openInCwd,
  threadEnvironmentId,
  threadId,
  draftId,
  quickName,
}: QuickHeaderActionsProps) {
  const isQuick = isSortlyQuickWorkspace(openInCwd);
  const [quickInfo, setQuickInfo] = useState<SortlyQuickInfo | null>(null);
  // Distinguishes "still fetching the share link" from "fetch finished and
  // there is no link" so the Share tooltip can say the right thing.
  const [shareInfoSettled, setShareInfoSettled] = useState(false);
  // The local manifest doesn't track published state, so start at "idle" and
  // let the server's answer (fetched below) correct it — publishing is
  // idempotent, so an optimistic "idle" is harmless if that fetch fails.
  const [publishState, setPublishState] = useState<"idle" | "working" | "published">("idle");
  // Guards "Make it real" against double-clicks while it resolves the target
  // project and navigates away.
  const [makeItRealWorking, setMakeItRealWorking] = useState(false);
  const projects = useStore(useShallow((store) => selectProjectsAcrossEnvironments(store)));
  const { handleNewThread } = useNewThreadHandler();

  useEffect(() => {
    setShareInfoSettled(false);
    setPublishState("idle");
    if (!isQuick || !openInCwd) {
      setQuickInfo(null);
      return;
    }
    let cancelled = false;
    void window.desktopBridge?.sortlyQuickInfo
      ?.(openInCwd)
      .then((info) => {
        if (!cancelled) {
          setQuickInfo(info ?? null);
          setShareInfoSettled(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQuickInfo(null);
          setShareInfoSettled(true);
        }
      });
    // Seed the Publish button from the server's actual state; null (endpoint
    // missing, offline, 404) keeps the optimistic "idle" default.
    void window.desktopBridge?.sortlyQuickPublishState
      ?.(openInCwd)
      .then((state) => {
        if (!cancelled && state?.isPublic) setPublishState("published");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isQuick, openInCwd]);

  if (!isQuick) return null;

  const viewUrl = quickInfo?.viewUrl ?? null;
  const target = draftId ?? scopeThreadRef(threadEnvironmentId, threadId);

  const injectPrompt = (text: string) => {
    const store = useComposerDraftStore.getState();
    const current = store.getComposerDraft(target)?.prompt ?? "";
    const next = current.trim().length > 0 ? `${current.trim()}\n\n${text}` : text;
    store.setPrompt(target, next);
  };

  const handleMakeItReal = async () => {
    if (!quickInfo || makeItRealWorking) return;
    setMakeItRealWorking(true);
    try {
      const prototypesProject = projects.find((project) =>
        project.cwd.endsWith(PROTOTYPES_CWD_SUFFIX),
      );
      if (!prototypesProject) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Sortly Prototypes project not found",
            description: "It's created automatically when you sign in with GitHub.",
          }),
        );
        return;
      }
      // A not-yet-sent Quick (draft) has only the placeholder thread title
      // ("New thread") — use the Quick's own name in that case, mirroring the
      // Publish naming rule above.
      const name = !draftId && quickName ? quickName : quickInfo.name;
      const projectRef = scopeProjectRef(prototypesProject.environmentId, prototypesProject.id);
      // Navigates to the Prototypes project's draft thread (creating one if
      // needed) — handleNewThread registers the draft in the store before it
      // navigates, so it's resolvable right after this await.
      await handleNewThread(projectRef, { envMode: "local" });
      const store = useComposerDraftStore.getState();
      let session = store.getDraftSessionByProjectRef(projectRef);
      if (!session) {
        // Shouldn't happen (registration is synchronous), but if the store
        // hasn't settled yet, retry once on the next tick before giving up.
        await new Promise((resolve) => setTimeout(resolve, 0));
        session = useComposerDraftStore.getState().getDraftSessionByProjectRef(projectRef);
      }
      if (!session) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Couldn't prepare the handoff",
            description: "Please try again.",
          }),
        );
        return;
      }
      // Same append-don't-clobber behavior as injectPrompt, but aimed at the
      // Prototypes project's draft instead of the current thread's composer.
      const draftStore = useComposerDraftStore.getState();
      const current = draftStore.getComposerDraft(session.draftId)?.prompt ?? "";
      const text = makeItRealPrompt(name, quickInfo.id);
      const next = current.trim().length > 0 ? `${current.trim()}\n\n${text}` : text;
      draftStore.setPrompt(session.draftId, next);
    } catch {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't open Sortly Prototypes",
          description: "Please try again.",
        }),
      );
    } finally {
      setMakeItRealWorking(false);
    }
  };

  const handleShare = async () => {
    if (!viewUrl) return;
    try {
      await navigator.clipboard.writeText(viewUrl);
      toastManager.add(
        stackedThreadToast({
          type: "success",
          title: "Link copied",
          description: "Anyone with the link can view this prototype.",
        }),
      );
    } catch {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn't copy the link",
          description: viewUrl,
        }),
      );
    }
  };

  const handlePublish = async () => {
    if (!openInCwd || publishState === "working") return;
    const wantPublish = publishState !== "published";
    setPublishState("working");
    // A not-yet-sent Quick (draft) has only the placeholder thread title
    // ("New thread") — publish without a name so the gallery keeps the
    // Quick's own name instead.
    const publishName = draftId ? undefined : quickName;
    let result: SortlyQuickPublishResult | undefined;
    try {
      result = await window.desktopBridge?.sortlyQuickPublish?.(
        openInCwd,
        wantPublish,
        publishName,
      );
    } catch (cause) {
      // An IPC rejection must never wedge the button in "working" — fall
      // through to the shared error path below.
      result = { error: cause instanceof Error ? cause.message : "Please try again." };
    }
    if (!result || "error" in result) {
      setPublishState(wantPublish ? "idle" : "published");
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: wantPublish ? "Couldn't publish" : "Couldn't unpublish",
          description: result && "error" in result ? result.error : "Please try again.",
        }),
      );
      return;
    }
    setPublishState(result.isPublic ? "published" : "idle");
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: result.isPublic ? "Published to the gallery" : "Removed from the gallery",
        description: result.isPublic
          ? "The team can now see and upvote it in the Gallery."
          : "It no longer appears in the gallery.",
      }),
    );
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="shrink-0"
              variant="outline"
              size="xs"
              aria-label="Copy shareable view link"
              disabled={!viewUrl}
              onClick={handleShare}
            >
              <Share2Icon className="size-3" />
              <span className="ml-1 hidden @lg/header-actions:inline">Share</span>
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {viewUrl
            ? "Copy a view-only link to share for feedback"
            : shareInfoSettled
              ? "Share link unavailable"
              : "Preparing share link…"}
        </TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              className="shrink-0"
              variant="outline"
              size="xs"
              aria-label="Figma round-trip actions"
            />
          }
        >
          <FigmaIcon className="size-3" />
          <span className="ml-1 hidden @lg/header-actions:inline">Figma</span>
          <ChevronDownIcon className="ml-0.5 size-3" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => injectPrompt(SEND_TO_FIGMA_PROMPT)}>Send to Figma</MenuItem>
          <MenuItem onClick={() => injectPrompt(UPDATE_FROM_FIGMA_PROMPT)}>
            Update from Figma…
          </MenuItem>
        </MenuPopup>
      </Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="shrink-0"
              variant="outline"
              size="xs"
              aria-label={
                publishState === "published"
                  ? "Published to the gallery — click to remove"
                  : "Publish to the Sortly Quick gallery"
              }
              disabled={publishState === "working"}
              onClick={handlePublish}
            >
              {publishState === "published" ? (
                <CheckIcon className="size-3" />
              ) : (
                <GlobeIcon className="size-3" />
              )}
              <span className="ml-1 hidden @lg/header-actions:inline">
                {publishState === "published"
                  ? "Published"
                  : publishState === "working"
                    ? "Publishing…"
                    : "Publish"}
              </span>
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {publishState === "published"
            ? "In the gallery — click to remove"
            : "Publish to the Sortly Quick gallery for the team to see and upvote"}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              className="shrink-0"
              variant="outline"
              size="xs"
              aria-label="Make it real — bring this design into the real Sortly app"
              disabled={!quickInfo || makeItRealWorking}
              onClick={handleMakeItReal}
            >
              <SparklesIcon className="size-3" />
              <span className="ml-1 hidden @lg/header-actions:inline">Make it real</span>
            </Button>
          }
        />
        <TooltipPopup side="bottom">
          {quickInfo
            ? "Bring this design into the real Sortly app (Sortly Prototypes)"
            : shareInfoSettled
              ? "Make it real unavailable"
              : "Preparing…"}
        </TooltipPopup>
      </Tooltip>
    </>
  );
}
