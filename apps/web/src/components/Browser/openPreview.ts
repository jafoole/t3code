import { usePreviewUrlStore } from "./previewUrlStore";

// In Pallet, every preview that originates *inside* the app — the Sortly Quick
// canvas, localhost URLs printed by the agent, clicked links, the header button
// — goes to the pop-out browser window. Upstream's "Open a Surface → Browser"
// covers the other intent: deliberately opening something new in a panel tab.
//
// The pop-out is a real Electron BrowserWindow (see desktop InAppBrowser); it
// reuses/focuses a single shared window, so repeated calls don't spawn clutter.
export function openPreviewPopout(
  url: string,
  options?: { readonly focus?: boolean; readonly focusExisting?: boolean },
): void {
  const store = usePreviewUrlStore.getState();
  // Remember the URL so the header button can re-open it later.
  store.setUrl(url);
  const popout = window.desktopBridge?.browserOpenPopout;
  if (popout) {
    void popout(url, options);
    return;
  }
  // Web fallback (no desktop bridge): no pop-out window exists, so hand off to
  // the host browser rather than silently doing nothing.
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Re-open the pop-out for the last previewed URL, or just focus it if a window
 * is already live. `focusExisting` stops the reuse path from re-navigating a
 * window the user may have moved elsewhere — notably the Sortly Quick canvas.
 */
export function focusOrOpenPreviewPopout(): void {
  const { url } = usePreviewUrlStore.getState();
  openPreviewPopout(url, { focusExisting: true });
}
