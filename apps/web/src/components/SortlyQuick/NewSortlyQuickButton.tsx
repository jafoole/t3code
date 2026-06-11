import { ZapIcon } from "lucide-react";
import { useState } from "react";

import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { createSortlyQuick, defaultQuickName, openQuickCanvas } from "./createSortlyQuick";

/**
 * One-click Sortly Quick: creates a prototype on the Sortly Quick server,
 * registers a local workspace project (with the MCP connection prewired),
 * opens a fresh thread in it, and pops the canvas to the prototype.
 */
export function NewSortlyQuickButton() {
  const { handleNewThread } = useNewThreadHandler();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createSortlyQuick(defaultQuickName());
      if ("error" in result) {
        setError(result.error);
        return;
      }
      await handleNewThread(result.projectRef, { envMode: "local" });
      openQuickCanvas(result.editUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

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
            onClick={() => void handleClick()}
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
      {error ? (
        <div className="px-2 pt-1 text-[10px] leading-snug text-destructive">{error}</div>
      ) : null}
    </SidebarGroup>
  );
}
