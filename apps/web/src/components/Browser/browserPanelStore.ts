import { create } from "zustand";

import { resetAutoOpenLocalhostSeen } from "./autoOpenLocalhost";

interface BrowserPanelStore {
  open: boolean;
  url: string;
  scopeKey: string | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setUrl: (url: string) => void;
  // Bind the panel to a logical scope (typically the active project). Switching
  // to a different non-null scope resets the panel so one project's preview
  // doesn't leak into another.
  setScopeKey: (key: string | null) => void;
}

const DEFAULT_URL = "http://localhost:3000";

export const useBrowserPanelStore = create<BrowserPanelStore>((set, get) => ({
  open: false,
  url: DEFAULT_URL,
  scopeKey: null,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setUrl: (url) => set({ url }),
  setScopeKey: (key) => {
    const current = get().scopeKey;
    if (current === key) return;
    // Reset everything tied to the previous scope. Null → null is filtered
    // above; null → key or key → other-key both reset.
    resetAutoOpenLocalhostSeen();
    set({ scopeKey: key, open: false, url: DEFAULT_URL });
  },
}));
