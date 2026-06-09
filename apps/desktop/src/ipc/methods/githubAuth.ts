import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as GithubDeviceFlow from "../../auth/GithubDeviceFlow.ts";
import * as GithubTokenStorage from "../../auth/GithubTokenStorage.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const GithubUserSchema = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.String,
});

const GithubDeviceFlowStartResultSchema = Schema.Struct({
  device_code: Schema.String,
  user_code: Schema.String,
  verification_uri: Schema.String,
  interval: Schema.Number,
  expires_in: Schema.Number,
});

const GithubPollResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal("pending") }),
  Schema.Struct({ status: Schema.Literal("slow_down"), interval: Schema.Number }),
  Schema.Struct({ status: Schema.Literal("success"), user: GithubUserSchema }),
  Schema.Struct({ status: Schema.Literal("denied") }),
  Schema.Struct({ status: Schema.Literal("expired") }),
  Schema.Struct({ status: Schema.Literal("error"), message: Schema.String }),
]);

const GithubPollInputSchema = Schema.Struct({
  device_code: Schema.String,
  currentInterval: Schema.Number,
});

const GithubStoredStateSchema = Schema.Struct({
  token: Schema.NullOr(Schema.String),
  user: Schema.NullOr(GithubUserSchema),
});

export const githubAuthStartDeviceFlow = makeIpcMethod({
  channel: IpcChannels.GITHUB_AUTH_START_DEVICE_FLOW_CHANNEL,
  payload: Schema.Void,
  result: GithubDeviceFlowStartResultSchema,
  handler: Effect.fn("desktop.ipc.githubAuth.startDeviceFlow")(function* () {
    const flow = yield* GithubDeviceFlow.GithubDeviceFlow;
    return yield* flow.startFlow();
  }),
});

export const githubAuthPollForToken = makeIpcMethod({
  channel: IpcChannels.GITHUB_AUTH_POLL_FOR_TOKEN_CHANNEL,
  payload: GithubPollInputSchema,
  result: GithubPollResultSchema,
  handler: Effect.fn("desktop.ipc.githubAuth.pollForToken")(function* ({ device_code, currentInterval }) {
    const flow = yield* GithubDeviceFlow.GithubDeviceFlow;
    const storage = yield* GithubTokenStorage.GithubTokenStorage;

    const result = yield* flow.pollOnce(device_code, currentInterval);

    if (result.status === "success") {
      yield* storage.setToken(result.token);
      yield* storage.setUser(result.user);
      return { status: "success" as const, user: result.user };
    }

    return result;
  }),
});

export const githubAuthGetStoredState = makeIpcMethod({
  channel: IpcChannels.GITHUB_AUTH_GET_STORED_STATE_CHANNEL,
  payload: Schema.Void,
  result: GithubStoredStateSchema,
  handler: Effect.fn("desktop.ipc.githubAuth.getStoredState")(function* () {
    const storage = yield* GithubTokenStorage.GithubTokenStorage;
    const token = Option.getOrNull(yield* storage.getToken);
    const user = Option.getOrNull(yield* storage.getUser);
    return { token, user };
  }),
});

export const githubAuthSignOut = makeIpcMethod({
  channel: IpcChannels.GITHUB_AUTH_SIGN_OUT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.githubAuth.signOut")(function* () {
    const storage = yield* GithubTokenStorage.GithubTokenStorage;
    yield* storage.clearToken;
    yield* storage.clearUser;
  }),
});
