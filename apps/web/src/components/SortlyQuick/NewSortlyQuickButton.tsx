import { useAtomValue } from "@effect/atom-react";
import { DEFAULT_MODEL } from "@t3tools/contracts";
import { ZapIcon } from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { usePrimarySettings } from "../../hooks/useSettings";
import { resolveAppModelSelectionForInstance } from "../../modelSelection";
import { primaryServerProvidersAtom } from "../../state/server";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager, stackedThreadToast } from "../ui/toast";
import { createSortlyQuick, defaultQuickName } from "./createSortlyQuick";

/**
 * One-click Sortly Quick: creates a prototype on the Sortly Quick server,
 * registers a local workspace project (with the MCP connection prewired),
 * opens a fresh thread in it, and pops the canvas to the prototype.
 */
/**
 * The Quick-creation flow, without any chrome — shared by the sidebar button
 * and the "New" button on the /quicks page so the error handling and the
 * canvas-popping navigation stay in one place.
 */
export function useCreateQuick(): { create: () => Promise<void>; busy: boolean } {
  const handleNewThread = useNewThreadHandler();
  const providers = useAtomValue(primaryServerProvidersAtom);
  const settings = usePrimarySettings();
  const [busy, setBusy] = useState(false);

  const showCreateError = (description: string) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn't create the Quick",
        description,
      }),
    );
  };

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // A Quick's project default becomes its thread's provider, so it has to
      // be one the user actually has on — hardcoding a driver here is what
      // produced "Provider instance 'codex' is disabled".
      const candidates = providers.filter((provider) => provider.enabled && provider.installed);
      const chosen =
        candidates.find((provider) => settings.providerModelPreferences?.[provider.instanceId]) ??
        candidates[0];
      if (!chosen) {
        // While the backend is still connecting, `providers` is simply empty —
        // that's a transient condition, not a settings problem. Don't send the
        // user to Settings for it.
        showCreateError(
          providers.length === 0
            ? "Still connecting to the backend — try again in a moment."
            : "No provider is enabled. Turn one on in Settings → Providers.",
        );
        return;
      }
      const model =
        resolveAppModelSelectionForInstance(chosen.instanceId, settings, providers, null) ??
        DEFAULT_MODEL;
      const result = await createSortlyQuick(defaultQuickName(), {
        instanceId: chosen.instanceId,
        model,
      });
      if ("error" in result) {
        showCreateError(result.error);
        return;
      }
      // Navigating to the new Quick's thread triggers ChatView's auto-open
      // effect, which pops the canvas (unfocused) — no explicit open needed.
      await handleNewThread(result.projectRef, { envMode: "local" });
    } catch (cause) {
      showCreateError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return { create: handleClick, busy };
}

export function NewSortlyQuickButton() {
  const { create, busy } = useCreateQuick();

  return (
    <SidebarGroup className="px-2 pt-1 pb-0">
      <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Sortly Quicks
        </span>
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="sm"
            disabled={busy}
            onClick={() => void create()}
            className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
            data-testid="new-sortly-quick-trigger"
          >
            <ZapIcon className="size-3.5" />
            <span className="flex-1 truncate text-left text-xs">
              {busy ? "Creating Quick…" : "New Sortly Quick"}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
