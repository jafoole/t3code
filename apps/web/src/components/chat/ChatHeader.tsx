import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { cn } from "~/lib/utils";
import { LayersIcon, PictureInPicture as PictureInPictureIcon } from "lucide-react";
import { focusOrOpenPreviewPopout } from "../Browser/openPreview";
import { Button } from "../ui/button";
import { Toggle } from "../ui/toggle";
import {
  usePrototypesPanelStore,
  PROTOTYPES_PANEL_ENABLED,
} from "../Prototypes/prototypesPanelStore";
import { QuickHeaderActions } from "../SortlyQuick/QuickHeaderActions";
import { isSortlyQuickWorkspace } from "../SortlyQuick/createSortlyQuick";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  gitCwd,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  // Sortly Quick threads are design surfaces, not code projects — hide the
  // dev-oriented controls (git, project scripts, open-in-editor) that have no
  // meaning here. Share / Figma / canvas stay.
  const isQuick = isSortlyQuickWorkspace(openInCwd);
  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <Tooltip>
          <TooltipTrigger
            render={
              <h2
                aria-label={activeThreadTitle}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              >
                {activeThreadTitle}
              </h2>
            }
          />
          <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
        </Tooltip>
        {PROTOTYPES_PANEL_ENABLED && <PrototypesPanelToggle />}
      </div>
      <div
        data-chat-header-actions
        className={cn(
          "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
          rightPanelOpen ? "pr-0" : "pr-16",
        )}
      >
        <QuickHeaderActions
          openInCwd={openInCwd}
          threadEnvironmentId={activeThreadEnvironmentId}
          threadId={activeThreadId}
          quickName={activeThreadTitle}
          {...(draftId ? { draftId } : {})}
        />
        {activeProjectScripts && !isQuick && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {showOpenInPicker && !isQuick && (
          <OpenInPicker
            environmentId={activeThreadEnvironmentId}
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && !isQuick && (
          <GitActionsControl
            gitCwd={gitCwd}
            activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
            {...(draftId ? { draftId } : {})}
          />
        )}
        <BrowserPopoutButton />
      </div>
    </div>
  );
});

function PrototypesPanelToggle() {
  const open = usePrototypesPanelStore((s) => s.open);
  const toggle = usePrototypesPanelStore((s) => s.toggleOpen);
  const enabledCount = usePrototypesPanelStore((s) => s.enabled.size);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0"
            pressed={open}
            onPressedChange={toggle}
            aria-label="Toggle prototypes panel"
            variant="outline"
            size="xs"
          >
            <LayersIcon className="size-3" />
            {enabledCount > 0 && (
              <span className="ml-1 text-[10px] font-medium leading-none">{enabledCount}</span>
            )}
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">
        {open ? "Close prototypes" : "Open prototypes"}
      </TooltipPopup>
    </Tooltip>
  );
}

// Single action: open the pop-out browser, or focus it if a window is already
// live. `focusExisting` keeps the reuse path from re-navigating a window the
// user may have moved on — notably the Sortly Quick canvas. Upstream's
// "Open a Surface → Browser" covers the separate intent of opening something
// new in a panel tab, so this needs no dropdown.
function BrowserPopoutButton() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            className="shrink-0"
            variant="ghost"
            size="icon-xs"
            aria-label="Open preview in pop-out window"
            onClick={() => focusOrOpenPreviewPopout()}
          >
            {/* Both the `ghost` and `outline` Button variants force icons to
                text-muted-foreground; any `text-` class on the svg opts out,
                matching the foreground-coloured panel toggles next to it. */}
            <PictureInPictureIcon className="size-3.5 text-foreground" />
          </Button>
        }
      />
      <TooltipPopup side="bottom">Open preview window</TooltipPopup>
    </Tooltip>
  );
}
