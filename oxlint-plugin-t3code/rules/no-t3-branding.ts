import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

// Pallet is a fork of upstream T3 Code. Users must never see upstream branding
// in any notification, error, setting, or label — user-visible strings say
// "Pallet". This rule flags string literals (and template literal chunks) that
// still carry the upstream brand wording.
const UPSTREAM_BRAND_PATTERN = /\bT3 (?:Code|Connect|server)\b/u;

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const normalizePath = (path: string) => path.replaceAll("\\", "/");

const toRepoPath = (filename: string, cwd: string) => {
  const normalizedFilename = normalizePath(filename);
  const normalizedCwd = normalizePath(cwd).replace(/\/+$/u, "");
  const prefix = `${normalizedCwd}/`;
  return normalizedFilename.startsWith(prefix)
    ? normalizedFilename.slice(prefix.length)
    : normalizedFilename;
};

// Files that intentionally keep the upstream wording:
// - DesktopEnvironment.ts: legacy user-data directory names that must keep
//   matching directories already present on users' disks.
// - apps/marketing: verbatim third-party quotes (tweets) about the upstream
//   product; editing them would falsify quotations.
// - scripts directories: release/build infrastructure whose strings must keep
//   matching published artifact and release names.
// - oxlint-plugin-t3code: this plugin's own sources and fixtures.
const EXCLUDED_EXACT_PATHS = new Set(["apps/desktop/src/app/DesktopEnvironment.ts"]);
const EXCLUDED_PATH_PREFIXES = ["apps/marketing/", "scripts/", "oxlint-plugin-t3code/"];
const EXCLUDED_PATH_SEGMENTS = ["/scripts/"];

const isExcludedFile = (filename: string, cwd: string): boolean => {
  const repoPath = toRepoPath(filename, cwd);
  if (TEST_FILE_PATTERN.test(repoPath)) return true;
  if (EXCLUDED_EXACT_PATHS.has(repoPath)) return true;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return true;
  return EXCLUDED_PATH_SEGMENTS.some((segment) => repoPath.includes(segment));
};

const message = (match: string) =>
  `User-visible strings must use Pallet branding: replace "${match}" with the Pallet equivalent ("Pallet", "Pallet Connect", "Pallet server").`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow upstream T3 branding in string literals; user-visible strings must say Pallet.",
    },
  },
  create(context) {
    if (isExcludedFile(context.filename, context.cwd)) return {};

    const check = (node: ESTree.StringLiteral | ESTree.TemplateLiteral, text: string) => {
      const match = UPSTREAM_BRAND_PATTERN.exec(text);
      if (match === null) return;

      context.report({
        node,
        message: message(match[0]),
      });
    };

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        check(node, node.value);
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const text = quasi.value.cooked ?? quasi.value.raw;
          if (typeof text !== "string") continue;
          if (UPSTREAM_BRAND_PATTERN.test(text)) {
            check(node, text);
            return;
          }
        }
      },
    };
  },
});
