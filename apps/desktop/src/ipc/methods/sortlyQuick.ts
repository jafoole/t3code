// @effect-diagnostics globalFetchInEffect:off
// @effect-diagnostics preferSchemaOverJson:off
import * as NodeOS from "node:os";

import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

const SORTLY_QUICK_BASE_URL = "https://sortly-quick.vercel.app";
const QUICKS_DIR_NAME = "Sortly Quicks";
const QUICK_MANIFEST_FILE = "quick.json";

const CreatePayloadSchema = Schema.Struct({ name: Schema.String });

const QuickInfoSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  viewUrl: Schema.String,
  editUrl: Schema.String,
});

const CreateResultSchema = Schema.Union([
  Schema.Struct({
    path: Schema.String,
    id: Schema.String,
    name: Schema.String,
    viewUrl: Schema.String,
    editUrl: Schema.String,
  }),
  Schema.Struct({ error: Schema.String }),
]);

const InfoPayloadSchema = Schema.Struct({ workspaceRoot: Schema.String });
const InfoResultSchema = Schema.NullOr(QuickInfoSchema);

// The agent's standing orders for every Quick workspace. The workspace holds
// no app code — the prototype lives on the Sortly Quick server and is reached
// exclusively through the MCP tools configured in .mcp.json.
function buildWorkspaceClaudeMd(name: string, viewUrl: string): string {
  return `# Sortly Quick — ${name}

This workspace controls one Sortly Quick prototype. It is rendered live at:
${viewUrl}

A new Quick starts as a **blank dot-grid canvas** — an empty design surface. The
user builds it up by describing what they want in this chat ("build an item card
with X"). If the user hasn't said what to build yet, ask them in one short line,
then build it on the canvas with the MCP tools below.

## How to work here

- You have MCP tools from the \`sortly-quick\` server: \`read_prototype\`,
  \`edit_prototype\`, \`update_prototype\`, and \`get_design_system_catalog\`.
- Start every task by calling \`get_design_system_catalog\` (once per session)
  and \`read_prototype\` so you know the available components and current code.
- On the FIRST build, the canvas is the blank starter (a hint on a dot-grid). Use
  \`update_prototype\` to replace it entirely with the user's first design.
- The canvas itself is a **dotted Figma-style board** (provided by the app). Build
  designs that SIT ON it — components/cards/screens with their own surfaces, laid out
  with padding/gaps — and do NOT paint a full-bleed background over the whole canvas
  (that would hide the dot grid). Think "components placed on a design board", not
  "one full-page screen edge to edge".
- For small or targeted changes, ALWAYS use \`edit_prototype\` (exact
  find & replace) — it is dramatically faster. Only use \`update_prototype\`
  (complete source replacement) when rewriting most of the file.
- The prototype runtime accepts ONLY components from the Sortly design system
  catalog plus React hooks (useState, useEffect, useRef, useMemo, useCallback)
  as bare identifiers. No imports. No external libraries. No Tailwind classes
  outside the catalog's tokens.
- If a component you need is missing from the catalog, build the closest
  approximation from allowed primitives and add a line to GAPS.md in this
  workspace describing what was missing — the design team uses that file to
  grow the design system.
- Do NOT create local source files; the prototype's only home is the server.
  The user sees changes in their canvas immediately after update_prototype.

## Figma round-trip — Send to Figma / Update from Figma

The user can take this design to Figma to tweak it, then bring the changes back.
You drive this with the **Figma MCP** (session-connected) plus the Quick MCP.

**Baked-in Sortly Design System (ALWAYS use this, never other Sortly libraries):**
- DS Figma file key: \`JzrHuML2B6dPtb0sBn3hm7\` (PALLET Web DS)
- DS published library key: \`lk-e9fea3d5bd969e07f5ae88b71f9682811ef37a951f71b299402abb13bf09189b4839cde0d377d1746e36749b8394b0709f73deb24310a827ebc66b06c7c3a785\`
  (library name "Sortly Build - PALLET Web DS"). When searching the design system,
  ALWAYS pass \`includeLibraryKeys: ["lk-e9fea3d5…"]\` so you never grab the
  retired/Atlas/Mobile/Web-App Buttons — only PALLET Web DS.

### Send to Figma (when the user asks to send/open this in Figma)
1. Load the \`figma-use\` and \`figma-generate-design\` skills (mandatory before any
   \`use_figma\` call), then \`read_prototype\` to get the current design.
2. **Destination:** if the user gave a Figma file URL, build there. If not, just
   confirm they're connected to Figma and **create a new Figma file** for them
   (the build tools operate on the file open in their Figma desktop app).
3. Rebuild the design as a frame using **PALLET Web DS** component instances
   (locked to the library key above) + DS color variables and text styles. For any
   component with no DS equivalent (e.g. a summary-stat/KPI card), compose it from
   DS primitives and log the gap.
4. Return the Figma frame link so the user can tweak it.

#### INSPECT BEFORE BUILDING (critical — these are real mistakes that ruined a first attempt)

The root cause of bad Figma output is **building before inspecting**. Do these three
pre-build inspections every time, BEFORE placing any node:

- **a) Screenshot a component before building around or inside it.** Create a temp
  instance and screenshot it to see what it ALREADY contains. Some DS components are
  self-contained and cover a whole region — e.g. the **Nav Rail** already includes the
  Sortly logo, all nav items, AND the user profile. If a component covers the region
  (sidebar, header, etc.), use it ALONE. NEVER wrap it in a custom dark frame, add a
  duplicate logo, or place a separate User Avatar on top — that stacks backgrounds and
  shows placeholder text ("FL / Label").
- **b) Never hardcode a font.** The PALLET Web DS uses **Poppins**, not Inter. Before
  writing ANY text, inspect a DS component's text node \`fontName.family\` (e.g. read
  Single Summary Stat's text nodes → Poppins). Load and use that family for all manual
  text. Do not assume Inter.
- **c) Never trust a component by name — verify its visual output.** Temp-instance +
  screenshot + check actual dimensions/structure before committing. Example: "Single
  Summary Stat" is a ~110×24px inline \`Label: Value\` text element, NOT a KPI card. If
  the visual output doesn't match what the design needs, build the container manually
  (e.g. KPI card: white fill, 1px #E0E0E5 border, 10px radius, 20px padding; Poppins
  Medium 11px uppercase label, Semi Bold 32px value, Medium 13px delta) and log the gap.

These three inspections (screenshot components, read their fonts, walk their tree)
catch the failures before a single node is placed.

### Update from Figma (when the user pastes a Figma frame URL)
1. \`get_design_context\` on the pasted Figma node (needs the file open in their
   Figma desktop app).
2. Translate the design back to @sortly/ds source — ONLY @sortly/ds components +
   React hooks, no imports — mapping Figma components to their catalog equivalents.
3. \`update_prototype\` (or \`edit_prototype\`) with the result; the canvas live-updates.

## Exporting a handoff brief ("Make it real in Sortly")

When the user asks to convert this Quick into a real Sortly prototype (or clicks
the "Make it real" affordance), produce a **handoff brief** — a spec they paste
into a Pallet chat on the **Sortly Prototypes** project, where it gets rebuilt as
a real route inside the real Sortly app shell.

IMPORTANT framing: the rebuild mounts the prototype INSIDE the real app, which
already provides the sidebar, header, nav, and theme. So the brief must clearly
separate the **app chrome** (which the real app provides — the rebuild discards it)
from the **screen content** (the actual new view to build). A Quick draws its own
sidebar/header only because it has no real app to live in.

Do this:
1. Call \`read_prototype\` to get the current source.
2. Output the brief in EXACTLY this template (fill every section):

\`\`\`
# Handoff Brief: <screen name>

**Source Sortly Quick:** ${viewUrl}

## What this is
<1–2 sentences: the screen/flow and its purpose>

## App chrome — DO NOT REBUILD (the real Sortly app provides this)
<the prototype's own sidebar, top nav, header bar, custom multi-screen navigation,
logo — list what's here so the rebuild knows to DROP it and use the real shell.
If the Quick is a single screen with no faux chrome, write "none".>

## Screen content to build
<the actual new view(s) that go inside the real app's content area — this is what
gets rebuilt>

### @sortly/ds components used (in the content)
<list each @sortly/ds component — the Sortly Prototypes side maps them to production
via docs/sortly-quick-component-map.md>

### Content layout
<structure of the content area: sections, columns, regions — NOT the app shell>

### Interactions
<what's clickable, what state changes, important behaviors>

## Data needs
<what data the content shows. Note: for now the rebuild targets real look-and-feel;
mock data in the content is fine. Still note what REAL Sortly data it would use
(items, folders, etc.) for a later data-wiring pass.>

## Notes
<edge cases, anything the rebuild should watch for>
\`\`\`

3. After the brief, tell the user: "Paste this into a chat on your Sortly Prototypes
   project and ask to rebuild it — it'll mount as a real route inside the real app
   shell, on your branch."

Keep the brief tight and faithful to what's actually built — it's a spec of intent
and layout, not a code dump.
`;
}

class SortlyQuickError extends Data.TaggedError("SortlyQuickError")<{
  readonly message: string;
}> {}

const fetchJson = (url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(url, init);
      if (!response.ok) {
        throw new Error(`Sortly Quick server returned ${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    },
    catch: (cause) =>
      new SortlyQuickError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "quick";
}

const doCreate = Effect.fn("desktop.ipc.sortlyQuick.doCreate")(function* (name: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const created = yield* fetchJson(`${SORTLY_QUICK_BASE_URL}/api/prototypes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });

  const id = typeof created.id === "string" ? created.id : null;
  const editToken = typeof created.edit_token === "string" ? created.edit_token : null;
  if (!id || !editToken) {
    return { error: "Sortly Quick server response was missing id or edit token." };
  }

  const viewUrl = `${SORTLY_QUICK_BASE_URL}/p/${id}`;
  const editUrl = `${viewUrl}?edit=${editToken}`;
  const mcpUrl = `${SORTLY_QUICK_BASE_URL}/api/mcp/${id}?edit=${editToken}`;

  const workspaceRoot = path.join(
    NodeOS.homedir(),
    QUICKS_DIR_NAME,
    `${slugify(name)}-${id}`,
  );
  yield* fileSystem.makeDirectory(path.join(workspaceRoot, ".claude"), { recursive: true });

  // .mcp.json is how the Claude Code engine discovers the prototype's MCP
  // server — no user-facing connection setup. The edit token lives in this
  // local file only; the workspace is never committed anywhere.
  yield* fileSystem.writeFileString(
    path.join(workspaceRoot, ".mcp.json"),
    JSON.stringify(
      { mcpServers: { "sortly-quick": { type: "http", url: mcpUrl } } },
      null,
      2,
    ),
  );
  yield* fileSystem.writeFileString(
    path.join(workspaceRoot, ".claude", "settings.json"),
    JSON.stringify({ enableAllProjectMcpServers: true }, null, 2),
  );
  yield* fileSystem.writeFileString(
    path.join(workspaceRoot, "CLAUDE.md"),
    buildWorkspaceClaudeMd(name, viewUrl),
  );
  yield* fileSystem.writeFileString(
    path.join(workspaceRoot, QUICK_MANIFEST_FILE),
    JSON.stringify({ id, name, viewUrl, editUrl }, null, 2),
  );

  return { path: workspaceRoot, id, name, viewUrl, editUrl };
});

export const sortlyQuickCreate = makeIpcMethod({
  channel: IpcChannels.SORTLY_QUICK_CREATE_CHANNEL,
  payload: CreatePayloadSchema,
  result: CreateResultSchema,
  handler: Effect.fn("desktop.ipc.sortlyQuick.create")(function* ({ name }) {
    const result = yield* Effect.result(doCreate(name));
    if (Result.isSuccess(result)) {
      return result.success;
    }
    return { error: result.failure.message };
  }),
});

export const sortlyQuickInfo = makeIpcMethod({
  channel: IpcChannels.SORTLY_QUICK_INFO_CHANNEL,
  payload: InfoPayloadSchema,
  result: InfoResultSchema,
  handler: Effect.fn("desktop.ipc.sortlyQuick.info")(function* ({ workspaceRoot }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const manifestPath = path.join(workspaceRoot, QUICK_MANIFEST_FILE);
    const raw = yield* fileSystem
      .readFileString(manifestPath)
      .pipe(Effect.orElseSucceed(() => null));
    if (raw === null) return null;
    const decoded = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(QuickInfoSchema),
    )(raw).pipe(Effect.orElseSucceed(() => null));
    return decoded;
  }),
});
