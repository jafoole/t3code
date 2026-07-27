import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as InAppBrowser from "../../browser/InAppBrowser.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const OpenPopoutPayloadSchema = Schema.Struct({
  url: Schema.String,
  focus: Schema.optional(Schema.Boolean),
  focusExisting: Schema.optional(Schema.Boolean),
});

export const browserOpenPopout = makeIpcMethod({
  channel: IpcChannels.BROWSER_OPEN_POPOUT_CHANNEL,
  payload: OpenPopoutPayloadSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.openPopout")(function* ({ url, focus, focusExisting }) {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.openPopout(url, {
      ...(focus === undefined ? {} : { focus }),
      ...(focusExisting === undefined ? {} : { focusExisting }),
    });
  }),
});

export const browserFocusPopout = makeIpcMethod({
  channel: IpcChannels.BROWSER_FOCUS_POPOUT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.browser.focusPopout")(function* () {
    const browser = yield* InAppBrowser.InAppBrowser;
    yield* browser.focusPopout;
  }),
});
