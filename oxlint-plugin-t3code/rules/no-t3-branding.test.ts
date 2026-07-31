import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("t3code/no-t3-branding");
const testFileRule = createOxlintRuleHarness("t3code/no-t3-branding", {
  filename: "fixture.test.ts",
});

describe("t3code/no-t3-branding", () => {
  rule.valid(
    "allows Pallet-branded user-visible strings",
    `
      export const message = "Codex is disabled in Pallet settings.";
      export const title = "Pallet Desktop";
    `,
  );

  rule.valid(
    "allows technical identifiers that contain t3 without brand wording",
    `
      export const scheme = "t3code://";
      export const packageName = "@t3tools/contracts";
      export const homeEnv = "T3CODE_HOME";
      export const artifact = "T3-Code-0.0.4-arm64.zip";
    `,
  );

  rule.valid(
    "ignores brand wording in comments and regex literals",
    `
      // Upstream T3 Code wording appears here only as a comment.
      export const legacyPattern = /Unable to connect to the (?:Pallet|T3) server WebSocket\\./i;
    `,
  );

  testFileRule.valid(
    "allows upstream wording in test fixtures",
    `
      export const fixtureTitle = "T3 Code";
      export const fixtureLabel = "T3 Code Mobile";
    `,
  );

  rule.invalid(
    "reports upstream brand wording in string literals",
    `
      export const message = "Codex is disabled in T3 Code settings.";
    `,
    (output) => {
      assert.match(output, /must use Pallet branding/);
    },
  );

  rule.invalid(
    "reports upstream connect wording in string literals",
    `
      export const message = "Sign in to T3 Connect before linking this environment.";
    `,
  );

  rule.invalid(
    "reports upstream brand wording in template literals",
    `
      export const label = (instanceId: string) =>
        \`Provider instance '\${instanceId}' is disabled in T3 Code settings.\`;
    `,
  );
});
