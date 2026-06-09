import { useEffect } from "react";

import { useBrowserPanelStore } from "./browserPanelStore";

const LOCALHOST_URL_REGEX = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s)\]<>'"]*)?/gi;

// Session-scoped: each unique localhost URL triggers at most one auto-open,
// but the user can still re-open by clicking. The set is intentionally not
// persisted — a fresh app launch should re-open on the first URL again.
const seenUrls = new Set<string>();

export function resetAutoOpenLocalhostSeen(): void {
  seenUrls.clear();
}

export function extractLocalhostUrls(text: string): string[] {
  if (!text) return [];
  const matches = text.match(LOCALHOST_URL_REGEX);
  return matches ?? [];
}

export function useAutoOpenLocalhostInPanel(text: string): void {
  useEffect(() => {
    const urls = extractLocalhostUrls(text);
    if (urls.length === 0) return;

    let nextUrl: string | null = null;
    for (const raw of urls) {
      const url = raw.trim();
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
      nextUrl = url; // keep last new URL so we land on the most recent one
    }
    if (nextUrl === null) return;

    const store = useBrowserPanelStore.getState();
    store.setUrl(nextUrl);
    store.setOpen(true);
  }, [text]);
}
