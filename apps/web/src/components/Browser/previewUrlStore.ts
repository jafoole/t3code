import { create } from "zustand";

import { resetAutoOpenLocalhostSeen } from "./autoOpenLocalhost";

/**
 * Tracks the last URL Pallet previewed. Pallet's in-app side panel was retired
 * in favour of upstream's Browser surface, so this no longer models an open/
 * closed panel — every Pallet-originated preview goes to the pop-out window.
 *
 * The store survives because two things still need it: the header button needs
 * a URL to (re)open, and `setScopeKey` is the only trigger for
 * `resetAutoOpenLocalhostSeen()`, which lets a project's dev-server URL
 * auto-open again after switching away and back.
 */
interface PreviewUrlStore {
  url: string;
  scopeKey: string | null;
  setUrl: (url: string) => void;
  // Bind previews to a logical scope (typically the active project). Switching
  // to a different non-null scope resets so one project's preview doesn't leak
  // into another.
  setScopeKey: (key: string | null) => void;
}

const DEFAULT_URL = "http://localhost:3000";

export const usePreviewUrlStore = create<PreviewUrlStore>((set, get) => ({
  url: DEFAULT_URL,
  scopeKey: null,
  setUrl: (url) => set({ url }),
  setScopeKey: (key) => {
    const current = get().scopeKey;
    if (current === key) return;
    // Reset everything tied to the previous scope. Null → null is filtered
    // above; null → key or key → other-key both reset.
    resetAutoOpenLocalhostSeen();
    set({ scopeKey: key, url: DEFAULT_URL });
  },
}));
