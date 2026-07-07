import {
  type EnvironmentId,
  type SortlyQuickPublishResult,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, FigmaIcon, GlobeIcon, Share2Icon } from "lucide-react";

import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
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
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  // Distinguishes "still fetching the share link" from "fetch finished and
  // there is no link" so the Share tooltip can say the right thing.
  const [shareInfoSettled, setShareInfoSettled] = useState(false);
  // The local manifest doesn't track published state, so start at "idle" and
  // let the server's answer (fetched below) correct it — publishing is
  // idempotent, so an optimistic "idle" is harmless if that fetch fails.
  const [publishState, setPublishState] = useState<"idle" | "working" | "published">("idle");

  useEffect(() => {
    setShareInfoSettled(false);
    setPublishState("idle");
    if (!isQuick || !openInCwd) {
      setViewUrl(null);
      return;
    }
    let cancelled = false;
    void window.desktopBridge?.sortlyQuickInfo
      ?.(openInCwd)
      .then((info) => {
        if (!cancelled) {
          setViewUrl(info?.viewUrl ?? null);
          setShareInfoSettled(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setViewUrl(null);
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

  const target = draftId ?? scopeThreadRef(threadEnvironmentId, threadId);

  const injectPrompt = (text: string) => {
    const store = useComposerDraftStore.getState();
    const current = store.getComposerDraft(target)?.prompt ?? "";
    const next = current.trim().length > 0 ? `${current.trim()}\n\n${text}` : text;
    store.setPrompt(target, next);
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
    </>
  );
}
