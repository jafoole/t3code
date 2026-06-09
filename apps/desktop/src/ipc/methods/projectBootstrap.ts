import * as NodeOS from "node:os";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as GithubTokenStorage from "../../auth/GithubTokenStorage.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const REPO_SLUG = "jafoole/sortly-prototypes";
const DEST_DIR_NAME = "Sortly Prototypes";

const BootstrapResultSchema = Schema.Union([
  Schema.Struct({ path: Schema.String }),
  Schema.Struct({ error: Schema.String }),
]);

class ProjectBootstrapError extends Data.TaggedError("ProjectBootstrapError")<{
  readonly message: string;
}> {}

const runGit = (args: readonly string[], cwd?: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make("git", args, {
      cwd,
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
    });
    return yield* spawner.exitCode(command).pipe(
      Effect.mapError((cause) => new ProjectBootstrapError({ message: cause.message })),
    );
  });

const doBootstrap = Effect.fn("desktop.ipc.projectBootstrap.doBootstrap")(function* (): Effect.fn.Return<
  typeof BootstrapResultSchema.Type,
  ProjectBootstrapError,
  FileSystem.FileSystem | GithubTokenStorage.GithubTokenStorage | ChildProcessSpawner.ChildProcessSpawner
> {
  const homeDir = NodeOS.homedir();
  const dest = `${homeDir}/${DEST_DIR_NAME}`;
  const fileSystem = yield* FileSystem.FileSystem;

  const destExists = yield* fileSystem.exists(dest).pipe(
    Effect.option,
    Effect.map(Option.getOrElse(() => false)),
  );

  const tokenOption = yield* GithubTokenStorage.GithubTokenStorage.pipe(
    Effect.flatMap((storage) => storage.getToken),
  );

  if (destExists) {
    const gitConfigPath = `${dest}/.git/config`;
    const gitConfigContent = yield* fileSystem.readFileString(gitConfigPath).pipe(
      Effect.option,
      Effect.map(Option.getOrElse(() => "")),
    );
    if (!gitConfigContent.includes(REPO_SLUG)) {
      return {
        error: `A folder named "${DEST_DIR_NAME}" already exists at ${dest} but is not the Sortly Prototypes repository.`,
      };
    }
  } else {
    if (Option.isNone(tokenOption)) {
      return { error: "Not signed in. Please sign in with GitHub first." };
    }

    const token = tokenOption.value;
    const cloneExitCode = yield* runGit([
      "clone",
      `https://oauth2:${token}@github.com/${REPO_SLUG}.git`,
      dest,
    ]);

    if (Number(cloneExitCode) !== 0) {
      return {
        error:
          Number(cloneExitCode) === 128
            ? "Access denied. Your account may not have access to this repository. Ask the repo owner to add you."
            : `Clone failed with exit code ${Number(cloneExitCode)}.`,
      };
    }

    yield* runGit(
      ["remote", "set-url", "origin", `https://github.com/${REPO_SLUG}.git`],
      dest,
    ).pipe(Effect.catch(() => Effect.void));
  }

  return { path: dest };
});

export const bootstrapPrototypesProject = makeIpcMethod({
  channel: IpcChannels.GITHUB_BOOTSTRAP_PROJECT_CHANNEL,
  payload: Schema.Void,
  result: BootstrapResultSchema,
  handler: Effect.fn("desktop.ipc.projectBootstrap.bootstrap")(function* () {
    const bootstrapResult = yield* Effect.result(doBootstrap());
    if (Result.isSuccess(bootstrapResult)) {
      return bootstrapResult.success;
    }
    return { error: bootstrapResult.failure.message };
  }),
});
