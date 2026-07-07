import * as NodeOS from "node:os";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as GithubTokenStorage from "../../auth/GithubTokenStorage.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const BOOTSTRAP_REPOS = {
  prototypes: { slug: "jafoole/sortly-prototypes", dirName: "Sortly Prototypes" },
} as const;

type BootstrapRepoKey = keyof typeof BOOTSTRAP_REPOS;

const BootstrapRepoSchema = Schema.Literal("prototypes");

const BootstrapResultSchema = Schema.Union([
  Schema.Struct({ path: Schema.String }),
  Schema.Struct({ error: Schema.String }),
]);

class ProjectBootstrapError extends Data.TaggedError("ProjectBootstrapError")<{
  readonly message: string;
}> {}

const collectStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

// Runs git with stdout/stderr collected (not inherited) so failures can be
// classified and surfaced to the user instead of vanishing into the void.
const runGit = (args: readonly string[], cwd?: string) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = ChildProcess.make("git", args, {
      cwd,
      stdin: "ignore",
    });
    const child = yield* spawner.spawn(command);
    // stdout must be drained too so the child never blocks on a full pipe.
    const [stderr, , exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stderr),
        collectStreamAsString(child.stdout),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    return { exitCode, stderr } as const;
  }).pipe(
    // The spawned process handle is scope-bound; close the scope when the
    // command settles so runGit's callers don't need to manage it.
    Effect.scoped,
    Effect.mapError((cause) => new ProjectBootstrapError({ message: cause.message })),
  );

// Removes secrets from git output before it's surfaced or logged. Covers both
// the raw token and its base64 Authorization form.
const scrubSecrets = (text: string, secrets: readonly string[]): string =>
  secrets.reduce(
    (acc, secret) => (secret.length > 0 ? acc.split(secret).join("<redacted>") : acc),
    text,
  );

const STDERR_TAIL_LENGTH = 400;

const classifyCloneFailure = (exitCode: number, scrubbedStderr: string): string => {
  const lower = scrubbedStderr.toLowerCase();
  // Auth first: git's 403 message ("unable to access '…': The requested URL
  // returned error: 403") also contains the network keyword, so the
  // auth-specific markers must win.
  if (lower.includes("authentication failed") || scrubbedStderr.includes("403")) {
    return "Access denied. Your account may not have access to this repository. Ask the repo owner to add you.";
  }
  if (lower.includes("could not resolve host") || lower.includes("unable to access")) {
    return "Couldn't reach GitHub — check your network and try again.";
  }
  const tail = scrubbedStderr.trim().slice(-STDERR_TAIL_LENGTH);
  return tail.length > 0
    ? `Clone failed (exit code ${exitCode}): ${tail}`
    : `Clone failed with exit code ${exitCode}.`;
};

const doBootstrap = Effect.fn("desktop.ipc.projectBootstrap.doBootstrap")(function* (
  repoKey: BootstrapRepoKey,
): Effect.fn.Return<
  typeof BootstrapResultSchema.Type,
  ProjectBootstrapError,
  FileSystem.FileSystem | GithubTokenStorage.GithubTokenStorage | ChildProcessSpawner.ChildProcessSpawner
> {
  const repo = BOOTSTRAP_REPOS[repoKey];
  const homeDir = NodeOS.homedir();
  const dest = `${homeDir}/${repo.dirName}`;
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
    if (!gitConfigContent.includes(repo.slug)) {
      return {
        error: `A folder named "${repo.dirName}" already exists at ${dest} but is not the ${repo.slug} repository.`,
      };
    }
  } else {
    if (Option.isNone(tokenOption)) {
      return { error: "Not signed in. Please sign in with GitHub first." };
    }

    const token = tokenOption.value;
    // The token travels in a one-shot Authorization header, never in the
    // remote URL — the cloned repo's origin stays a plain https URL, so the
    // user's own git keeps working and no secret is persisted on disk.
    // `credential.helper=` disables any configured helper so git can't prompt.
    const basicAuth = Buffer.from(`oauth2:${token}`).toString("base64");
    const clone = yield* runGit([
      "-c",
      "credential.helper=",
      "-c",
      `http.extraHeader=Authorization: Basic ${basicAuth}`,
      "clone",
      `https://github.com/${repo.slug}.git`,
      dest,
    ]);

    if (clone.exitCode !== 0) {
      return {
        error: classifyCloneFailure(clone.exitCode, scrubSecrets(clone.stderr, [token, basicAuth])),
      };
    }
  }

  return { path: dest };
});

export const bootstrapPrototypesProject = makeIpcMethod({
  channel: IpcChannels.GITHUB_BOOTSTRAP_PROJECT_CHANNEL,
  payload: BootstrapRepoSchema,
  result: BootstrapResultSchema,
  handler: Effect.fn("desktop.ipc.projectBootstrap.bootstrap")(function* (repoKey) {
    const bootstrapResult = yield* Effect.result(doBootstrap(repoKey));
    if (Result.isSuccess(bootstrapResult)) {
      return bootstrapResult.success;
    }
    return { error: bootstrapResult.failure.message };
  }),
});
