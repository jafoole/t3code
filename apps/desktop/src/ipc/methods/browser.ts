import { BrowserShowInputSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as InAppBrowser from "../../browser/InAppBrowser.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const browserShow = makeIpcMethod({
  channel: IpcChannels.BROWSER_SHOW_CHANNEL,
  payload: BrowserShowInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.show")(function* (input) {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.show(input);
  }),
});

export const browserHide = makeIpcMethod({
  channel: IpcChannels.BROWSER_HIDE_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.hide")(function* () {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.hide;
  }),
});

export const browserNavigate = makeIpcMethod({
  channel: IpcChannels.BROWSER_NAVIGATE_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.navigate")(function* (url) {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.navigate(url);
  }),
});

export const browserBack = makeIpcMethod({
  channel: IpcChannels.BROWSER_BACK_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.back")(function* () {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.goBack;
  }),
});

export const browserForward = makeIpcMethod({
  channel: IpcChannels.BROWSER_FORWARD_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.forward")(function* () {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.goForward;
  }),
});

export const browserReload = makeIpcMethod({
  channel: IpcChannels.BROWSER_RELOAD_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.reload")(function* () {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.reload;
  }),
});

const OpenPopoutPayloadSchema = Schema.Struct({
  url: Schema.String,
  focus: Schema.optional(Schema.Boolean),
});

export const browserOpenPopout = makeIpcMethod({
  channel: IpcChannels.BROWSER_OPEN_POPOUT_CHANNEL,
  payload: OpenPopoutPayloadSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.openPopout")(function* ({ url, focus }) {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.openPopout(url, focus === undefined ? undefined : { focus });
  }),
});
