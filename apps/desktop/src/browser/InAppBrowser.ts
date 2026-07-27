import type { BrowserNavigationState } from "@t3tools/contracts";
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
  readonly openPopout: (
    url: string,
    options?: { readonly focus?: boolean; readonly focusExisting?: boolean },
  ) => Effect.Effect<void>;
  readonly focusPopout: Effect.Effect<void>;
}

export class InAppBrowser extends Context.Service<InAppBrowser, InAppBrowserShape>()(
  "@t3tools/desktop/browser/InAppBrowser",
) {}

const { logInfo, logWarning } = DesktopObservability.makeComponentLogger("desktop-in-app-browser");

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

// The pop-out window is a real browser window: a thin toolbar view (back /
// forward / reload + editable URL) stacked above a content view that hosts the
// page. The toolbar is trusted local HTML driven via the popoutToolbar preload.
const POPOUT_TOOLBAR_HEIGHT = 44;

interface PopoutState {
  readonly window: Electron.BrowserWindow;
  // null when the popout is chromeless (e.g. Sortly Quick, which renders its
  // own single action bar — a Pallet toolbar on top would be a redundant 2nd bar).
  readonly toolbar: Electron.WebContentsView | null;
  readonly content: Electron.WebContentsView;
  readonly chromeless: boolean;
}

// Pop-outs keep the Pallet toolbar (back / forward / reload + URL). Quick pages
// need real browser nav too — e.g. to return to the canvas after visiting the
// Design Library — so they are NOT chromeless. (The chromeless layout paths
// below stay available but are currently unused.)
function isChromelessUrl(_url: string): boolean {
  return false;
}

function layoutPopout(p: PopoutState): void {
  if (p.window.isDestroyed()) return;
  const { width, height } = p.window.getContentBounds();
  if (!p.toolbar) {
    p.content.setBounds({ x: 0, y: 0, width, height });
    return;
  }
  p.toolbar.setBounds({ x: 0, y: 0, width, height: POPOUT_TOOLBAR_HEIGHT });
  p.content.setBounds({
    x: 0,
    y: POPOUT_TOOLBAR_HEIGHT,
    width,
    height: Math.max(0, height - POPOUT_TOOLBAR_HEIGHT),
  });
}

function buildPopoutToolbarHtml(dark: boolean): string {
  const bg = dark ? "#1a1a1a" : "#f7f7f8";
  const fg = dark ? "#e5e5e5" : "#1c1c1e";
  const hover = dark ? "#2e2e31" : "#e4e4e7";
  const inputBg = dark ? "#2a2a2d" : "#ffffff";
  const focusRing = dark ? "#3b6fd4" : "#bcd0f7";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:${dark ? "dark" : "light"};}
*{box-sizing:border-box;margin:0;padding:0;}
body{height:100vh;display:flex;align-items:center;gap:4px;padding:0 10px;
font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${bg};color:${fg};-webkit-user-select:none;}
button{width:30px;height:30px;border:none;border-radius:6px;background:transparent;color:inherit;cursor:pointer;
font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;}
button:hover:not(:disabled){background:${hover};}
button:disabled{opacity:.3;cursor:default;}
input{flex:1;height:30px;border:none;border-radius:6px;padding:0 12px;font:13px inherit;background:${inputBg};color:inherit;outline:none;}
input:focus{box-shadow:0 0 0 2px ${focusRing};}
#protos{display:none;width:auto;height:30px;padding:0 12px;font-size:13px;font-weight:500;background:${inputBg};
border:1px solid ${dark ? "#3f3f42" : "#e2e2e5"};border-radius:9px;box-shadow:0 1px 2px rgba(0,0,0,.04);}
#protos:hover{background:${hover};}
</style></head><body>
<button id="back" title="Back" disabled>&#8249;</button>
<button id="fwd" title="Forward" disabled>&#8250;</button>
<button id="reload" title="Reload">&#10227;</button>
<input id="url" type="text" spellcheck="false" placeholder="URL" />
<button id="protos" title="Turn prototypes on or off">Prototypes</button>
<script>
var api=window.popoutToolbar;
var back=document.getElementById('back'),fwd=document.getElementById('fwd'),reload=document.getElementById('reload'),url=document.getElementById('url'),protos=document.getElementById('protos');
// The Prototypes button belongs to Real Sortly (the local work-frontend app),
// not to Quicks or other sites — show it only on the app's dev-server origins.
function isRealSortly(u){return /^https?:\\/\\/(localhost|127\\.0\\.0\\.1):(8080|8081)([\\/?#]|$)/.test(u||'');}
var editing=false;
function normalize(v){v=v.trim();if(!v)return '';if(v.indexOf('://')!==-1)return v;var l=v.toLowerCase();if(l.indexOf('localhost')===0||l.indexOf('127.')===0||l.indexOf('0.0.0.0')===0)return 'http://'+v;return 'https://'+v;}
back.onclick=function(){api.back();};
fwd.onclick=function(){api.forward();};
reload.onclick=function(){api.reload();};
url.addEventListener('focus',function(){editing=true;});
url.addEventListener('blur',function(){editing=false;});
url.addEventListener('keydown',function(e){if(e.key==='Enter'){var v=normalize(url.value);if(v){api.navigate(v);}url.blur();}});
protos.onclick=function(){api.prototypes();};
api.onState(function(s){back.disabled=!s.canGoBack;fwd.disabled=!s.canGoForward;if(!editing){url.value=s.url||'';}protos.style.display=isRealSortly(s.url)?'flex':'none';});
</script></body></html>`;
}

const make = Effect.gen(function* () {
  const popoutRef = yield* Ref.make<Option.Option<PopoutState>>(Option.none());
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const electronTheme = yield* ElectronTheme.ElectronTheme;

  const broadcastPopoutState = (p: PopoutState) => {
    if (p.window.isDestroyed() || !p.toolbar) return;
    try {
      p.toolbar.webContents.send(IpcChannels.POPOUT_STATE_CHANNEL, snapshotNavigationState(p.content));
    } catch (cause) {
      void Effect.runPromise(logWarning("broadcastPopoutState failed", { cause: String(cause) }));
    }
  };

  // Toolbar (renderer) → main: drive the pop-out's content view.
  const popoutNavListener = (_event: Electron.IpcMainEvent, raw: unknown) => {
    void Effect.runPromise(
      Ref.get(popoutRef).pipe(
        Effect.flatMap((current) =>
          Effect.sync(() => {
            if (Option.isNone(current) || current.value.window.isDestroyed()) return;
            const wc = current.value.content.webContents;
            const action = raw as { type?: string; url?: string };
            if (action?.type === "back" && wc.navigationHistory.canGoBack()) {
              wc.navigationHistory.goBack();
            } else if (action?.type === "forward" && wc.navigationHistory.canGoForward()) {
              wc.navigationHistory.goForward();
            } else if (action?.type === "reload") {
              wc.reload();
            } else if (action?.type === "navigate" && typeof action.url === "string") {
              void wc.loadURL(action.url).catch(() => undefined);
            } else if (action?.type === "prototypes") {
              // Ask the Real Sortly page to open its Prototypes panel. The
              // panel UI lives in the web app; the toolbar button is just the
              // door, so it works on any route (Dashboard, Items, …).
              void wc
                .executeJavaScript(
                  "window.dispatchEvent(new CustomEvent('sortly-prototypes:toggle-panel'))",
                )
                .catch(() => undefined);
            }
          }),
        ),
      ),
    );
  };
  Electron.ipcMain.removeAllListeners(IpcChannels.POPOUT_NAV_CHANNEL);
  Electron.ipcMain.on(IpcChannels.POPOUT_NAV_CHANNEL, popoutNavListener);

  return InAppBrowser.of({
    openPopout: (url, options) =>
      Effect.gen(function* () {
        // focus === false opens the pop-out BEHIND the main window without
        // stealing keyboard focus (e.g. the freshly-created Sortly Quick canvas
        // while the user should keep typing in Pallet). Default is unchanged:
        // focused, on top.
        const focus = options?.focus !== false;
        const chromeless = isChromelessUrl(url);
        const existing = yield* Ref.get(popoutRef);
        if (Option.isSome(existing) && !existing.value.window.isDestroyed()) {
          if (existing.value.chromeless === chromeless) {
            // focusExisting: surface the window as-is. Re-navigating here is
            // what used to throw away whatever the user had open (notably the
            // Sortly Quick canvas) whenever the header button was clicked.
            if (options?.focusExisting === true) {
              const win = existing.value.window;
              try {
                if (!win.isVisible()) win.show();
                win.moveTop();
                win.focus();
              } catch (cause) {
                yield* logWarning("popout focusExisting failed", { cause: String(cause) });
              }
              return;
            }
            yield* Effect.tryPromise({
              try: () => existing.value.content.webContents.loadURL(url),
              catch: (cause) => String(cause),
            }).pipe(
              Effect.catch((cause) =>
                logWarning("popout loadURL failed", { url, cause: String(cause) }),
              ),
            );
            if (focus) {
              existing.value.window.focus();
            } else if (!existing.value.window.isVisible()) {
              existing.value.window.showInactive();
            }
            return;
          }
          // Chrome shape changed (e.g. Quick ↔ localhost preview) — rebuild fresh.
          existing.value.window.destroy();
          yield* Ref.set(popoutRef, Option.none());
        }

        const dark = yield* electronTheme.shouldUseDarkColors;
        const win = new Electron.BrowserWindow({
          width: 1280,
          height: 900,
          backgroundColor: themedBackgroundColor(dark),
          // Unfocused mode: create hidden, then showInactive() below so the
          // window never activates or jumps in front of the main window.
          ...(focus ? {} : { show: false }),
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        });

        const content = new Electron.WebContentsView({
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: true,
          },
        });
        content.setBackgroundColor(themedBackgroundColor(dark));

        const toolbar = chromeless
          ? null
          : new Electron.WebContentsView({
              webPreferences: {
                preload: `${__dirname}/popoutToolbar.preload.cjs`,
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
              },
            });

        if (toolbar) win.contentView.addChildView(toolbar);
        win.contentView.addChildView(content);

        const state: PopoutState = { window: win, toolbar, content, chromeless };
        layoutPopout(state);

        const emit = () => broadcastPopoutState(state);
        content.webContents.on("did-navigate", emit);
        content.webContents.on("did-navigate-in-page", emit);
        content.webContents.on("page-title-updated", emit);
        content.webContents.on("did-start-loading", emit);
        content.webContents.on("did-stop-loading", emit);
        content.webContents.on("did-finish-load", emit);

        win.on("resize", () => layoutPopout(state));
        win.once("closed", () => {
          void Ref.set(popoutRef, Option.none()).pipe(Effect.runPromise);
        });

        yield* Ref.set(popoutRef, Option.some(state));

        if (!focus) {
          // Show without activating, then re-assert the main window so the
          // pop-out sits behind Pallet instead of covering it.
          win.showInactive();
          const mainOpt = yield* electronWindow.currentMainOrFirst;
          if (Option.isSome(mainOpt) && !mainOpt.value.isDestroyed()) {
            mainOpt.value.moveTop();
            mainOpt.value.focus();
          }
        }

        if (toolbar) {
          const toolbarHtml = buildPopoutToolbarHtml(dark);
          yield* Effect.tryPromise({
            try: () =>
              toolbar.webContents.loadURL(
                "data:text/html;charset=utf-8," + encodeURIComponent(toolbarHtml),
              ),
            catch: (cause) => String(cause),
          }).pipe(
            Effect.catch((cause) => logWarning("popout toolbar load failed", { cause: String(cause) })),
          );
        }
        yield* Effect.tryPromise({
          try: () => content.webContents.loadURL(url),
          catch: (cause) => String(cause),
        }).pipe(
          Effect.catch((cause) =>
            logWarning("popout loadURL failed", { url, cause: String(cause) }),
          ),
        );
      }),

    // Bring an existing pop-out window to the front (show + focus). Used when a
    // Sortly Quick build finishes so the user knows to look at the canvas that
    // was opened behind the main window. No-op if there is no live pop-out.
    focusPopout: Effect.gen(function* () {
      const current = yield* Ref.get(popoutRef);
      if (Option.isNone(current) || current.value.window.isDestroyed()) return;
      const win = current.value.window;
      try {
        if (!win.isVisible()) win.show();
        win.moveTop();
        win.focus();
      } catch (cause) {
        yield* logWarning("focusPopout failed", { cause: String(cause) });
      }
    }),
  });
});

export const layer = Layer.effect(InAppBrowser, make);
