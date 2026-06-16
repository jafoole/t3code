import { useEffect } from "react";

import { openPreviewPopout } from "./openPreview";

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
  if (!matches) return [];
  return matches.filter((raw) => {
    // Skip glob / wildcard patterns. Config-ish text (CORS allowlists, proxy
    // entries, CSP) often contains things like `http://localhost:8080/**` —
    // those are patterns, not pages, and auto-opening them just yields a blank
    // window. A real navigable URL never contains a literal `*`.
    if (raw.includes("*")) return false;
    // Only auto-open things that actually parse as a URL.
    try {
      new URL(raw);
      return true;
    } catch {
      return false;
    }
  });
}

export function useAutoOpenLocalhostPreview(text: string): void {
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

    // Pallet rule: automatic opens go to the pop-out window, not the side panel.
    openPreviewPopout(nextUrl);
  }, [text]);
}
