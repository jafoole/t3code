import { useBrowserPanelStore } from "./browserPanelStore";

// In Pallet, every AUTOMATIC preview open (Sortly Quick canvas, localhost URLs
// printed by the agent, etc.) goes to the pop-out browser window — never the
// side panel. The side panel is opt-in only, via the browser control's dropdown.
//
// The pop-out is a real Electron BrowserWindow (see desktop InAppBrowser); it
// reuses/focuses a single shared window, so repeated calls don't spawn clutter.
export function openPreviewPopout(url: string, options?: { readonly focus?: boolean }): void {
  const store = useBrowserPanelStore.getState();
  // Remember the URL so the side-panel option (and toolbar) reflect it too.
  store.setUrl(url);
  const popout = window.desktopBridge?.browserOpenPopout;
  if (popout) {
    void popout(url, options);
    return;
  }
  // Web fallback (no desktop bridge): there is no pop-out window, so use the panel.
  store.setOpen(true);
}

export function openPreviewSidePanel(url?: string): void {
  const store = useBrowserPanelStore.getState();
  if (url) store.setUrl(url);
  store.setOpen(true);
}
