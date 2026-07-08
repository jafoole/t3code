import { contextBridge, ipcRenderer } from "electron";

import type { BrowserNavigationState } from "@t3tools/contracts";

import * as IpcChannels from "./ipc/channels.ts";

// Preload for the pop-out window's toolbar WebContentsView. The toolbar HTML is
// trusted local content; it drives the content view via these IPC messages and
// receives navigation-state updates to render the URL + enable/disable buttons.
contextBridge.exposeInMainWorld("popoutToolbar", {
  back: () => ipcRenderer.send(IpcChannels.POPOUT_NAV_CHANNEL, { type: "back" }),
  forward: () => ipcRenderer.send(IpcChannels.POPOUT_NAV_CHANNEL, { type: "forward" }),
  reload: () => ipcRenderer.send(IpcChannels.POPOUT_NAV_CHANNEL, { type: "reload" }),
  navigate: (url: string) =>
    ipcRenderer.send(IpcChannels.POPOUT_NAV_CHANNEL, { type: "navigate", url }),
  prototypes: () => ipcRenderer.send(IpcChannels.POPOUT_NAV_CHANNEL, { type: "prototypes" }),
  onState: (listener: (state: BrowserNavigationState) => void) => {
    const handler = (_event: unknown, state: BrowserNavigationState) => listener(state);
    ipcRenderer.on(IpcChannels.POPOUT_STATE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.POPOUT_STATE_CHANNEL, handler);
  },
});
