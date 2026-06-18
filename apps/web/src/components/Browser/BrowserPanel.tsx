import type { BrowserNavigationState } from "@t3tools/contracts";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useBrowserPanelStore } from "./browserPanelStore";

const DEFAULT_PANEL_WIDTH = 480;
const MIN_PANEL_WIDTH = 320;
const PANEL_WIDTH_STORAGE_KEY = "t3code.browserPanel.width";

function readPersistedPanelWidth(): number {
  if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH;
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_PANEL_WIDTH;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= MIN_PANEL_WIDTH ? parsed : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
  }
}

function clampPanelWidth(width: number): number {
  // Leave at least 480px for the chat content; max grows the panel up to
  // (window - 480). Falls back to a sane upper bound if no window.
  const chatMin = 480;
  const maxFromWindow =
    typeof window !== "undefined" ? Math.max(MIN_PANEL_WIDTH, window.innerWidth - chatMin) : 1200;
  return Math.max(MIN_PANEL_WIDTH, Math.min(width, maxFromWindow));
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^localhost(:\d+)?(\/.*)?$/i.test(trimmed)) return `http://${trimmed}`;
  if (/^[\w.-]+\.[a-z]{2,}/i.test(trimmed)) return `https://${trimmed}`;
  return `https://${trimmed}`;
}

export function BrowserPanel() {
  const open = useBrowserPanelStore((s) => s.open);
  const url = useBrowserPanelStore((s) => s.url);
  const setUrl = useBrowserPanelStore((s) => s.setUrl);
  const placeholderRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(
    null,
  );
  const rafRef = useRef<number | null>(null);

  const [navState, setNavState] = useState<BrowserNavigationState>({
    url,
    title: "",
    canGoBack: false,
    canGoForward: false,
    loading: false,
  });
  const [draftUrl, setDraftUrl] = useState(url);
  const [editing, setEditing] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>(() => readPersistedPanelWidth());
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    pendingWidth: number;
    rafId: number | null;
  } | null>(null);

  // Re-clamp on window resize so the panel never grows past usable bounds.
  useEffect(() => {
    const onResize = () => {
      setPanelWidth((w) => clampPanelWidth(w));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panelWidth,
      pendingWidth: panelWidth,
      rafId: null,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    // Dragging the handle leftward grows the panel.
    const next = clampPanelWidth(state.startWidth + (state.startX - event.clientX));
    if (next === state.pendingWidth) return;
    state.pendingWidth = next;
    if (state.rafId !== null) return;
    state.rafId = requestAnimationFrame(() => {
      state.rafId = null;
      setPanelWidth(state.pendingWidth);
    });
  };

  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (state.rafId !== null) cancelAnimationFrame(state.rafId);
    resizeStateRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    try {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(state.pendingWidth));
    } catch {
      // ignore storage errors (private mode, quota)
    }
  };

  // Subscribe to native nav state pushes.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge?.onBrowserState) return;
    const unsubscribe = bridge.onBrowserState((state) => {
      setNavState(state);
      if (!editing && state.url) {
        setDraftUrl(state.url);
      }
    });
    return unsubscribe;
  }, [editing]);

  const scheduleBoundsPush = () => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const el = placeholderRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };
      const prev = lastBoundsRef.current;
      if (
        prev &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height
      ) {
        return;
      }
      lastBoundsRef.current = next;
      window.desktopBridge?.browserSetBounds(next);
    });
  };

  useLayoutEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    if (!open) {
      lastBoundsRef.current = null;
      void bridge.browserHide();
      return;
    }

    const el = placeholderRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bounds = { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    lastBoundsRef.current = bounds;
    void bridge.browserShow({ url, bounds });
  }, [open, url]);

  useEffect(() => {
    if (!open) return;
    const el = placeholderRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => scheduleBoundsPush());
    observer.observe(el);
    window.addEventListener("resize", scheduleBoundsPush);
    window.addEventListener("scroll", scheduleBoundsPush, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsPush);
      window.removeEventListener("scroll", scheduleBoundsPush, true);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [open]);

  useEffect(() => {
    return () => {
      window.desktopBridge?.browserHide();
    };
  }, []);

  const submitDraftUrl = () => {
    const normalized = normalizeUrl(draftUrl);
    if (normalized && normalized !== navState.url) {
      setUrl(normalized);
      void window.desktopBridge?.browserNavigate(normalized);
    }
    setEditing(false);
  };

  if (!open) return null;

  return (
    <div
      className="relative flex h-full flex-col border-l border-border bg-card"
      style={{ width: panelWidth, flex: `0 0 ${panelWidth}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize browser panel"
        title="Drag to resize browser panel"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-w-resize hover:bg-accent/40 active:bg-accent/60"
      />
      <div className="flex h-[52px] shrink-0 items-center gap-1 border-b border-border px-3">
        <button
          type="button"
          onClick={() => window.desktopBridge?.browserBack()}
          disabled={!navState.canGoBack}
          title="Back"
          aria-label="Back"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 12L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => window.desktopBridge?.browserForward()}
          disabled={!navState.canGoForward}
          title="Forward"
          aria-label="Forward"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4L10 8L6 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => window.desktopBridge?.browserReload()}
          title="Reload"
          aria-label="Reload"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M2.5 8a5.5 5.5 0 0 1 9.55-3.71M13.5 8a5.5 5.5 0 0 1-9.55 3.71M11.5 2v3h-3M4.5 14v-3h3"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => navState.url && window.desktopBridge?.browserOpenPopout(navState.url)}
          disabled={!navState.url}
          title="Open in new window"
          aria-label="Open in new window"
          className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-30"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M6.5 3H3.5a1 1 0 0 0-1 1v8.5a1 1 0 0 0 1 1H12a1 1 0 0 0 1-1V9.5M9.5 2.5h4v4M13.5 2.5l-6 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <input
          type="text"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={submitDraftUrl}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Escape") {
              setDraftUrl(navState.url);
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          spellCheck={false}
          className="ml-2 min-w-0 flex-1 rounded bg-muted/50 px-2 py-1 text-xs outline-none focus:bg-background focus:ring-1 focus:ring-ring"
        />
        <button
          type="button"
          onClick={() => useBrowserPanelStore.getState().setOpen(false)}
          title="Close browser panel"
          aria-label="Close browser panel"
          className="ml-1 rounded p-1.5 text-muted-foreground hover:bg-accent"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <div ref={placeholderRef} className="flex-1" aria-label="Embedded browser view" />
    </div>
  );
}
