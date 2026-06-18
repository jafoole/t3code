import { type EnvironmentId, type ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { useEffect, useState } from "react";
import { ChevronDownIcon, FigmaIcon, Share2Icon } from "lucide-react";

import { useComposerDraftStore, type DraftId } from "~/composerDraftStore";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toastManager, stackedThreadToast } from "../ui/toast";
import { isSortlyQuickWorkspace } from "./createSortlyQuick";

// The design verbs for a Sortly Quick. Send-to-Figma / Update-from-Figma /
// Make-it-real are all driven by the agent's standing orders in the workspace
// CLAUDE.md — these just drop the matching instruction into the composer so the
// user can review and send it, instead of having to know the magic phrase.
const SEND_TO_FIGMA_PROMPT =
  "Send this design to Figma — rebuild it as a frame using the Pallet DS (web) components, then give me the Figma link.";
const UPDATE_FROM_FIGMA_PROMPT =
  "Update this prototype from my Figma changes. Frame URL: <paste the Figma frame link here>";
const MAKE_IT_REAL_PROMPT =
  'Export a "Make it real" handoff brief for this design so I can rebuild it as a real route in my Sortly Prototypes project.';

interface QuickHeaderActionsProps {
  readonly openInCwd: string | null;
  readonly threadEnvironmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId?: DraftId;
}

/**
 * Header controls for a Sortly Quick thread: a one-click Share (copies the
 * clean, token-free view URL) and a Figma/"Make it real" menu. Renders nothing
 * for non-Quick threads, so it's inert everywhere else.
 */
export function QuickHeaderActions({
  openInCwd,
  threadEnvironmentId,
  threadId,
  draftId,
}: QuickHeaderActionsProps) {
  const isQuick = isSortlyQuickWorkspace(openInCwd);
  const [viewUrl, setViewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isQuick || !openInCwd) {
      setViewUrl(null);
      return;
    }
    let cancelled = false;
    void window.desktopBridge?.sortlyQuickInfo?.(openInCwd).then((info) => {
      if (!cancelled) setViewUrl(info?.viewUrl ?? null);
    });
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
          {viewUrl ? "Copy a view-only link to share for feedback" : "Preparing share link…"}
        </TooltipPopup>
      </Tooltip>
      <Menu>
        <MenuTrigger
          render={
            <Button
              className="shrink-0"
              variant="outline"
              size="xs"
              aria-label="Figma round-trip and Make-it-real actions"
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
          <MenuItem onClick={() => injectPrompt(MAKE_IT_REAL_PROMPT)}>Make it real in Sortly</MenuItem>
        </MenuPopup>
      </Menu>
    </>
  );
}
