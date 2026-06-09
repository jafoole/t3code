import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { GithubUser } from "./GithubTokenStorage.ts";

const CLIENT_ID = "Ov23liBFHxh1T1uTiP6h";

export interface GithubDeviceFlowStartResult {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly interval: number;
  readonly expires_in: number;
}

export type GithubPollResult =
  | { readonly status: "pending" }
  | { readonly status: "slow_down"; readonly interval: number }
  | { readonly status: "success"; readonly token: string; readonly user: GithubUser }
  | { readonly status: "denied" }
  | { readonly status: "expired" }
  | { readonly status: "error"; readonly message: string };

export class GithubDeviceFlowError extends Data.TaggedError("GithubDeviceFlowError")<{
  readonly message: string;
}> {}

export interface GithubDeviceFlowShape {
  readonly startFlow: () => Effect.Effect<GithubDeviceFlowStartResult, GithubDeviceFlowError>;
  readonly pollOnce: (
    device_code: string,
    currentInterval: number,
  ) => Effect.Effect<GithubPollResult, GithubDeviceFlowError>;
}

export class GithubDeviceFlow extends Context.Service<
  GithubDeviceFlow,
  GithubDeviceFlowShape
>()("t3/desktop/GithubDeviceFlow") {}

const make = GithubDeviceFlow.of({
  startFlow: () =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch("https://github.com/login/device/code", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            scope: "repo",
          }),
        });
        if (!response.ok) {
          throw new Error(`GitHub device flow start failed: ${response.status}`);
        }
        return (await response.json()) as GithubDeviceFlowStartResult;
      },
      catch: (cause) =>
        new GithubDeviceFlowError({
          message: cause instanceof Error ? cause.message : "Failed to start GitHub device flow.",
        }),
    }),

  pollOnce: (device_code, currentInterval) =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        });
        if (!response.ok) {
          throw new Error(`GitHub token poll failed: ${response.status}`);
        }
        const data = (await response.json()) as Record<string, unknown>;

        if (typeof data.access_token === "string" && data.access_token.length > 0) {
          const token = data.access_token;
          const userResponse = await fetch("https://api.github.com/user", {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          });
          if (!userResponse.ok) {
            throw new Error(`GitHub user fetch failed: ${userResponse.status}`);
          }
          const userData = (await userResponse.json()) as Record<string, unknown>;
          const user: GithubUser = {
            login: typeof userData.login === "string" ? userData.login : "",
            name: typeof userData.name === "string" ? userData.name : null,
            avatar_url: typeof userData.avatar_url === "string" ? userData.avatar_url : "",
          };
          return { status: "success" as const, token, user };
        }

        if (data.error === "authorization_pending") {
          return { status: "pending" as const };
        }

        if (data.error === "slow_down") {
          const addedInterval = typeof data.interval === "number" ? data.interval : 5;
          return { status: "slow_down" as const, interval: currentInterval + addedInterval };
        }

        if (data.error === "access_denied") {
          return { status: "denied" as const };
        }

        if (data.error === "expired_token") {
          return { status: "expired" as const };
        }

        throw new Error(
          typeof data.error_description === "string"
            ? data.error_description
            : `Unknown GitHub error: ${String(data.error)}`,
        );
      },
      catch: (cause) =>
        new GithubDeviceFlowError({
          message: cause instanceof Error ? cause.message : "GitHub token poll failed.",
        }),
    }),
});

export const layer = Layer.succeed(GithubDeviceFlow, make);
