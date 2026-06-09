import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const GithubAuthDocumentSchema = Schema.Struct({
  encryptedToken: Schema.optionalKey(Schema.String),
  encryptedUser: Schema.optionalKey(Schema.String),
});
const GithubAuthDocumentJson = fromLenientJson(GithubAuthDocumentSchema);
const decodeGithubAuthDocumentJson = Schema.decodeEffect(GithubAuthDocumentJson);
const encodeGithubAuthDocumentJson = Schema.encodeEffect(GithubAuthDocumentJson);

const GithubUserSchema = Schema.Struct({
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
  avatar_url: Schema.String,
});
const GithubUserJson = Schema.fromJsonString(GithubUserSchema);
const decodeGithubUserJson = Schema.decodeEffect(GithubUserJson);
const encodeGithubUserJson = Schema.encodeEffect(GithubUserJson);

export type GithubUser = typeof GithubUserSchema.Type;

export class GithubTokenStorageError extends Data.TaggedError("GithubTokenStorageError")<{
  readonly cause: unknown;
}> {
  override get message() {
    return "GitHub token storage operation failed.";
  }
}

export interface GithubTokenStorageShape {
  readonly getToken: Effect.Effect<Option.Option<string>>;
  readonly setToken: (token: string) => Effect.Effect<void, GithubTokenStorageError>;
  readonly clearToken: Effect.Effect<void, GithubTokenStorageError>;
  readonly getUser: Effect.Effect<Option.Option<GithubUser>>;
  readonly setUser: (user: GithubUser) => Effect.Effect<void, GithubTokenStorageError>;
  readonly clearUser: Effect.Effect<void, GithubTokenStorageError>;
}

export class GithubTokenStorage extends Context.Service<
  GithubTokenStorage,
  GithubTokenStorageShape
>()("@t3tools/desktop/auth/GithubTokenStorage") {}

const EMPTY_DOCUMENT = {};

export const layer = Layer.effect(
  GithubTokenStorage,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

    const authPath = path.join(environment.stateDir, "github-auth.json");

    const readDoc = () =>
      fileSystem.readFileString(authPath).pipe(
        Effect.option,
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.succeed(EMPTY_DOCUMENT as typeof GithubAuthDocumentSchema.Type),
            onSome: (raw) =>
              decodeGithubAuthDocumentJson(raw).pipe(
                Effect.catch(() =>
                  Effect.succeed(EMPTY_DOCUMENT as typeof GithubAuthDocumentSchema.Type),
                ),
              ),
          }),
        ),
      );

    const writeDoc = (
      document: typeof GithubAuthDocumentSchema.Type,
    ): Effect.Effect<void, GithubTokenStorageError> =>
      Effect.gen(function* () {
        const encoded = yield* encodeGithubAuthDocumentJson(document);
        const dir = path.dirname(authPath);
        yield* fileSystem.makeDirectory(dir, { recursive: true });
        yield* fileSystem.writeFileString(authPath, encoded);
      }).pipe(Effect.mapError((cause) => new GithubTokenStorageError({ cause })));

    const encryptString = (value: string) =>
      safeStorage.encryptString(value).pipe(
        Effect.map(Encoding.encodeBase64),
        Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
      );

    const decryptString = (encoded: string) =>
      Effect.fromResult(Encoding.decodeBase64(encoded)).pipe(
        Effect.flatMap((bytes) => safeStorage.decryptString(bytes)),
        Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
      );

    const isEncryptionAvailable = () =>
      safeStorage.isEncryptionAvailable.pipe(
        Effect.catch(() => Effect.succeed(false)),
      );

    return GithubTokenStorage.of({
      getToken: Effect.gen(function* () {
        const doc = yield* readDoc();
        if (!doc.encryptedToken) return Option.none<string>();
        if (!(yield* isEncryptionAvailable())) return Option.none<string>();
        return yield* decryptString(doc.encryptedToken).pipe(
          Effect.map(Option.some<string>),
          Effect.catch(() => Effect.succeed(Option.none<string>())),
        );
      }),

      setToken: (token) =>
        Effect.gen(function* () {
          if (!(yield* isEncryptionAvailable().pipe(
            Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
          ))) return;
          const encrypted = yield* encryptString(token);
          const doc = yield* readDoc().pipe(
            Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
          );
          yield* writeDoc({ ...doc, encryptedToken: encrypted });
        }),

      clearToken: Effect.gen(function* () {
        const doc = yield* readDoc().pipe(
          Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
        );
        const { encryptedToken: _removed, ...rest } = doc;
        yield* writeDoc(rest);
      }),

      getUser: Effect.gen(function* () {
        const doc = yield* readDoc();
        if (!doc.encryptedUser) return Option.none<GithubUser>();
        if (!(yield* isEncryptionAvailable())) return Option.none<GithubUser>();
        const userJson = yield* decryptString(doc.encryptedUser).pipe(
          Effect.catch(() => Effect.succeed("")),
        );
        if (!userJson) return Option.none<GithubUser>();
        return yield* decodeGithubUserJson(userJson).pipe(
          Effect.map(Option.some<GithubUser>),
          Effect.catch(() => Effect.succeed(Option.none<GithubUser>())),
        );
      }),

      setUser: (user) =>
        Effect.gen(function* () {
          if (!(yield* isEncryptionAvailable().pipe(
            Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
          ))) return;
          const userJson = yield* encodeGithubUserJson(user).pipe(
            Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
          );
          const encrypted = yield* encryptString(userJson);
          const doc = yield* readDoc().pipe(
            Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
          );
          yield* writeDoc({ ...doc, encryptedUser: encrypted });
        }),

      clearUser: Effect.gen(function* () {
        const doc = yield* readDoc().pipe(
          Effect.mapError((cause) => new GithubTokenStorageError({ cause })),
        );
        const { encryptedUser: _removed, ...rest } = doc;
        yield* writeDoc(rest);
      }),
    });
  }),
);
