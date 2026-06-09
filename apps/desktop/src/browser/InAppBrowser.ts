import type { BrowserBounds, BrowserNavigationState } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";

export interface InAppBrowserShape {
  readonly show: (input: { url: string; bounds: BrowserBounds }) => Effect.Effect<void>;
  readonly hide: Effect.Effect<void>;
  readonly navigate: (url: string) => Effect.Effect<void>;
  readonly goBack: Effect.Effect<void>;
  readonly goForward: Effect.Effect<void>;
  readonly reload: Effect.Effect<void>;
  readonly openPopout: (url: string) => Effect.Effect<void>;
}

export class InAppBrowser extends Context.Service<InAppBrowser, InAppBrowserShape>()(
  "t3/desktop/InAppBrowser",
) {}

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-in-app-browser");

interface BrowserState {
  readonly window: Electron.BrowserWindow;
  readonly view: Electron.WebContentsView;
  attached: boolean;
  loadedUrl: string | null;
}

function roundBounds(b: BrowserBounds): Electron.Rectangle {
  return {
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.max(0, Math.round(b.width)),
    height: Math.max(0, Math.round(b.height)),
  };
}

function isBoundsLike(value: unknown): value is BrowserBounds {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as BrowserBounds).x === "number" &&
    typeof (value as BrowserBounds).y === "number" &&
    typeof (value as BrowserBounds).width === "number" &&
    typeof (value as BrowserBounds).height === "number"
  );
}

function themedBackgroundColor(dark: boolean): string {
  // Match the main window's framing colors so the panel feels native and
  // doesn't flash white before a page paints its own background.
  return dark ? "#0a0a0a" : "#ffffff";
}

function snapshotNavigationState(view: Electron.WebContentsView): BrowserNavigationState {
  const wc = view.webContents;
  return {
    url: wc.getURL() ?? "",
    title: wc.getTitle() ?? "",
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    loading: wc.isLoading(),
  };
}

const make = Effect.gen(function* () {
  const stateRef = yield* Ref.make<Option.Option<BrowserState>>(Option.none());
  const popoutRef = yield* Ref.make<Option.Option<Electron.BrowserWindow>>(Option.none());
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const electronTheme = yield* ElectronTheme.ElectronTheme;

  const detachIfAttached = (state: BrowserState) => {
    if (!state.attached) return;
    if (!state.window.isDestroyed()) {
      try {
        state.window.contentView.removeChildView(state.view);
      } catch (cause) {
        void Effect.runPromise(logWarning("removeChildView failed", { cause: String(cause) }));
      }
    }
    state.attached = false;
  };

  const broadcastState = (state: BrowserState) => {
    if (state.window.isDestroyed()) return;
    try {
      const snapshot = snapshotNavigationState(state.view);
      state.window.webContents.send(IpcChannels.BROWSER_STATE_CHANNEL, snapshot);
    } catch (cause) {
      void Effect.runPromise(logWarning("broadcastState failed", { cause: String(cause) }));
    }
  };

  const ensureState = Effect.gen(function* () {
    const existing = yield* Ref.get(stateRef);
    if (Option.isSome(existing) && !existing.value.window.isDestroyed()) {
      return existing.value;
    }

    const windowOpt = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(windowOpt)) {
      return null;
    }
    const window = windowOpt.value;

    const view = new Electron.WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });

    const initialDark = yield* electronTheme.shouldUseDarkColors;
    view.setBackgroundColor(themedBackgroundColor(initialDark));

    const state: BrowserState = { window, view, attached: false, loadedUrl: null };

    const emit = () => broadcastState(state);
    view.webContents.on("did-navigate", emit);
    view.webContents.on("did-navigate-in-page", emit);
    view.webContents.on("page-title-updated", emit);
    view.webContents.on("did-start-loading", emit);
    view.webContents.on("did-stop-loading", emit);
    view.webContents.on("did-finish-load", emit);

    const onClosed = () => {
      detachIfAttached(state);
      void Ref.set(stateRef, Option.none()).pipe(Effect.runPromise);
    };
    window.once("closed", onClosed);

    yield* Ref.set(stateRef, Option.some(state));
    yield* logInfo("WebContentsView created");
    return state;
  });

  const boundsListener = (_event: Electron.IpcMainEvent, raw: unknown) => {
    if (!isBoundsLike(raw)) return;
    void Effect.runPromise(
      Ref.get(stateRef).pipe(
        Effect.flatMap((current) =>
          Effect.sync(() => {
            if (Option.isNone(current)) return;
            if (!current.value.attached) return;
            current.value.view.setBounds(roundBounds(raw));
          }),
        ),
      ),
    );
  };
  Electron.ipcMain.removeAllListeners(IpcChannels.BROWSER_SET_BOUNDS_CHANNEL);
  Electron.ipcMain.on(IpcChannels.BROWSER_SET_BOUNDS_CHANNEL, boundsListener);

  // Re-color the embedded view when the app theme changes so the panel
  // doesn't flash white against a dark window.
  yield* electronTheme.onUpdated(() => {
    void Effect.runPromise(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        if (Option.isNone(current)) return;
        if (current.value.window.isDestroyed()) return;
        const dark = yield* electronTheme.shouldUseDarkColors;
        current.value.view.setBackgroundColor(themedBackgroundColor(dark));
      }),
    );
  });

  const navigatePopout = (url: string) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(popoutRef);
      if (Option.isNone(current) || current.value.isDestroyed()) return;
      yield* Effect.tryPromise({
        try: () => current.value.loadURL(url),
        catch: (cause) => String(cause),
      }).pipe(
        Effect.catch((cause) => logWarning("popout loadURL failed", { url, cause: String(cause) })),
      );
    });

  const withActiveState = <A>(fn: (state: BrowserState) => A): Effect.Effect<A | null> =>
    Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      if (Option.isNone(current)) return null;
      if (current.value.window.isDestroyed()) return null;
      return fn(current.value);
    });

  return InAppBrowser.of({
    show: (input) =>
      Effect.gen(function* () {
        const state = yield* ensureState;
        if (state === null) {
          yield* logWarning("show called with no host window");
          return;
        }

        const rect = roundBounds(input.bounds);
        state.view.setBounds(rect);

        if (!state.attached) {
          state.window.contentView.addChildView(state.view);
          state.attached = true;
        }

        if (state.loadedUrl !== input.url) {
          state.loadedUrl = input.url;
          // Use tryPromise so a navigation failure (refused, 404, bad URL)
          // surfaces as a tracked Effect error and never crashes the IPC
          // handler — Chromium still paints its error page in the view.
          yield* Effect.tryPromise({
            try: () => state.view.webContents.loadURL(input.url),
            catch: (cause) => String(cause),
          }).pipe(
            Effect.catch((cause) =>
              logWarning("loadURL failed", { url: input.url, cause: String(cause) }),
            ),
          );
          yield* navigatePopout(input.url);
        }
        broadcastState(state);
      }),

    hide: Effect.gen(function* () {
      const current = yield* Ref.get(stateRef);
      if (Option.isNone(current)) return;
      detachIfAttached(current.value);
    }),

    navigate: (url) =>
      Effect.gen(function* () {
        const state = yield* ensureState;
        if (state === null) return;
        state.loadedUrl = url;
        yield* Effect.tryPromise({
          try: () => state.view.webContents.loadURL(url),
          catch: (cause) => String(cause),
        }).pipe(
          Effect.catch((cause) => logWarning("loadURL failed", { url, cause: String(cause) })),
        );
        yield* navigatePopout(url);
      }),

    goBack: withActiveState((s) => {
      if (s.view.webContents.navigationHistory.canGoBack()) {
        s.view.webContents.navigationHistory.goBack();
      }
    }).pipe(Effect.asVoid),

    goForward: withActiveState((s) => {
      if (s.view.webContents.navigationHistory.canGoForward()) {
        s.view.webContents.navigationHistory.goForward();
      }
    }).pipe(Effect.asVoid),

    reload: withActiveState((s) => {
      s.view.webContents.reload();
    }).pipe(Effect.asVoid),

    openPopout: (url) =>
      Effect.gen(function* () {
        const existing = yield* Ref.get(popoutRef);
        if (Option.isSome(existing) && !existing.value.isDestroyed()) {
          yield* Effect.tryPromise({
            try: () => existing.value.loadURL(url),
            catch: (cause) => String(cause),
          }).pipe(
            Effect.catch((cause) =>
              logWarning("popout loadURL failed", { url, cause: String(cause) }),
            ),
          );
          existing.value.focus();
          return;
        }

        const dark = yield* electronTheme.shouldUseDarkColors;
        const win = new Electron.BrowserWindow({
          width: 1280,
          height: 900,
          backgroundColor: themedBackgroundColor(dark),
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        });

        win.once("closed", () => {
          void Ref.set(popoutRef, Option.none()).pipe(Effect.runPromise);
        });

        yield* Ref.set(popoutRef, Option.some(win));
        yield* Effect.tryPromise({
          try: () => win.loadURL(url),
          catch: (cause) => String(cause),
        }).pipe(
          Effect.catch((cause) =>
            logWarning("popout loadURL failed", { url, cause: String(cause) }),
          ),
        );
      }),
  });
});

export const layer = Layer.effect(InAppBrowser, make);
