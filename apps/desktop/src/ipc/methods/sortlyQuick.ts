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

const PublishPayloadSchema = Schema.Struct({
  workspaceRoot: Schema.String,
  publish: Schema.Boolean,
  name: Schema.optional(Schema.String),
});
const PublishResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), isPublic: Schema.Boolean }),
  Schema.Struct({ error: Schema.String }),
]);

const PublishStatePayloadSchema = Schema.Struct({ workspaceRoot: Schema.String });
const PublishStateResultSchema = Schema.NullOr(
  Schema.Struct({ isPublic: Schema.Boolean }),
);

const DeletePayloadSchema = Schema.Struct({ workspaceRoot: Schema.String });
const DeleteResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true) }),
  Schema.Struct({ error: Schema.String }),
]);

// Compiled once at module scope (the lint rule flags rebuilding it per call).
const decodeQuickInfoJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(QuickInfoSchema),
);

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
- **Component props are defined by the RUNTIME @sortly/ds package, NOT the Figma
  DS.** They differ. Do not assume props or copy them from the Figma DS spec —
  those break in the runtime. Known runtime facts: **Button** takes \`children\`
  for its text (NOT \`label\`), uses \`variant\` (NOT \`type\`), and **lowercase**
  sizes (\`size="medium"\`, not \`"Medium"\`). When unsure of a component's props,
  verify by rendering: call \`update_prototype\` with a minimal use, then look at
  the canvas — if a component renders blank or wrong, its props are wrong. Fix by
  testing in the runtime, never by trusting the Figma DS prop names.
- If a component you need is missing from the catalog, build the closest
  approximation from allowed primitives and add a line to GAPS.md in this
  workspace describing what was missing — the design team uses that file to
  grow the design system.
- Do NOT create local source files; the prototype's only home is the server.
  The user sees changes in their canvas immediately after update_prototype.

## Mobile / phone app screens — build to iOS HIG metrics

When the user asks for a mobile app, a phone screen, an iOS/Android app, or shows
you a phone screenshot: design a **full, standard-size phone screen** — NEVER a
cramped half-height card. This is the most common mistake; default to a full phone.

**ALWAYS wrap the entire mobile design in the \`<PhoneScreen>\` DS component.** It
is the standard 390 × 844 iPhone frame — the real iPhone point grid, 1px = 1pt —
with Apple-HIG-correct chrome baked in: 54px status-bar area, a \`bottomBar\` slot
that enforces the 49px minimum tab-bar height, and a 34px home-indicator safe
area. Do NOT hand-roll a card or a partial screen, and do NOT add your own status
bar, home indicator, or bottom safe-area padding — the frame provides all three.
The PhoneScreen frame **is** the discrete "surface that sits on the board" from
the rule above, so it satisfies that rule; just make it a real, full phone.

\`<PhoneScreen>\` props: \`children\` (the screen content — it fills the body and
scrolls), \`bottomBar\` (a tab/nav bar pinned to the bottom), \`time\` (status-bar
time, default "9:41"), \`hideStatusBar\`, and \`background\` (a bg-* token for the
WHOLE phone — status bar + body + home indicator share it, so they blend instead
of reading as separate white bars; defaults to bg-grey-50). Put the app's real
content as children so it fills the screen top-to-bottom; if the app has a tab
bar, pass it as \`bottomBar\`. **Set the screen's background color via the
\`background\` prop, NOT as a full-bleed bg on your content** — that keeps the
status bar and home-indicator areas the same color as the screen.

### iOS layout rules (Apple HIG — numbers, not vibes)

These are Apple's Human Interface Guidelines applied to the 390×844 point grid.
Follow them exactly; they are what makes a screen read as a real iOS app while
keeping the Sortly identity (Poppins + DS color tokens — never change either).

- **Screen margins: 16px** horizontal (\`px-4\`) for all content. Only images,
  maps, and edge-to-edge list backgrounds may bleed to the frame edge.
- **8px spacing grid:** every gap/padding is a multiple of 8 (4 only for tight
  icon–label pairs): \`gap-2\`=8 \`gap-3\`=12 \`gap-4\`=16 \`gap-6\`=24. Never 5/7/9px.
- **Touch targets ≥ 44×44px** for EVERY tappable element — buttons, icon
  buttons, tab items, list rows. \`min-h-11\` / \`size-11\` = exactly 44px.
- **Nav bar / header: 44px tall** (\`h-11\`), title centered, 17px semibold
  (\`text-[17px] font-semibold\`), back/action icons as 44px targets at the
  edges. Large-title screens instead put a **34px** bold title left-aligned
  below a compact bar: \`text-[34px] font-semibold leading-[41px]\`.
- **Tab bar (\`bottomBar\`): 49px tall** (\`h-[49px]\`), **2–5 items**, equal
  widths (\`flex-1\`), each item a centered column of a ~24px icon over a
  **10px label** (\`text-[10px] font-medium\`). Active item \`text-brand\`,
  inactive \`text-grey-500\`. Icons are SF-Symbols-style: simple line/outline
  glyphs with 1.5–2px strokes (inline \`<svg>\` is fine); the active tab may
  use the filled variant.
- **Type scale — iOS sizes rendered in Poppins:**
  - Large title 34px → \`text-[34px] font-semibold leading-[41px]\`
  - Title 22px → \`text-style-headings-drawer\` · Title 20px → \`text-[20px] font-semibold\`
  - Nav title / headline 17px semibold → \`text-[17px] font-semibold\`
  - Body 17px → \`text-[17px] leading-[22px]\` (DS \`text-style-body-large\` at 18px is an OK stand-in)
  - Secondary 15px → \`text-[15px] text-grey-600\` · Footnote 13px → \`text-[13px] text-grey-500\`
  - Caption 12px → \`text-style-body-caption\` · Tab labels 10px → \`text-[10px] font-medium\`

  Rule of thumb: use DS \`text-style-*\` classes wherever the size already
  matches (cards, captions, badges, section headers); use the raw \`text-[Npx]\`
  classes above for iOS-specific metrics (34/20/17/15/13/10). Both render
  Poppins. Use ONLY the raw sizes listed here — other arbitrary px values are
  not in the compiled CSS and will silently not apply.
- **Lists:** rows **≥44px** tall (56–60px is comfortable with a subtitle).
  Grouped list = a white \`rounded-xl\` card whose rows are split by
  \`border-grey-100\` dividers; drill-in rows end in a \`text-grey-400\`
  chevron. Row anatomy: 28–32px leading icon/thumb · 17px (or 15px) title ·
  13px subtitle.
- **Cards:** \`rounded-xl\`/\`rounded-2xl\` (12–16px radius), 16px inner
  padding (\`p-4\`), \`bg-white border border-grey-200\`.
- **Buttons:** the screen's primary CTA is a full-width filled bar:
  \`h-[50px] rounded-xl bg-brand text-white text-[17px] font-semibold\`.
  Secondary/inline actions use the DS \`Button\` or 44px-tall text buttons.
  **Exactly ONE brand-colored primary action per screen.**
- **Search field:** 36px tall (\`h-9\`), \`rounded-[10px] bg-grey-100\`, leading
  search icon, 17px placeholder in \`text-grey-500\`.
- **Color/contrast:** DS tokens only. Primary text \`text-grey-900\`, body
  \`text-grey-700\`, secondary \`text-grey-600\`. Never lighter than grey-500 for
  text that must be read — grey-400 is for chevrons and decorative strokes.

Example — the design goes INSIDE PhoneScreen, built to the metrics above:
\`\`\`jsx
<PhoneScreen
  bottomBar={
    <div className="flex h-[49px] items-stretch">
      <button className="flex flex-1 flex-col items-center justify-center gap-1 text-brand">
        {/* ~24px SF-Symbols-style icon */}
        <span className="text-[10px] font-medium">Items</span>
      </button>
      {/* 1–4 more tabs, inactive ones text-grey-500 */}
    </div>
  }
>
  <div className="flex h-11 items-center justify-between px-4">
    {/* 44px nav bar: back target · 17px semibold title · action target */}
  </div>
  <div className="flex flex-col gap-4 px-4 pb-6">
    {/* screen content: 16px margins, 8px grid, rows ≥44px */}
  </div>
</PhoneScreen>
\`\`\`

Only use a partial screen or an isolated component if the user explicitly asks for
that (or for a non-phone device/size).

## Color tokens — Sortly DS (use these EXACT class names; never guess hex)

Colors are Tailwind utility classes: \`bg-<token>\`, \`text-<token>\`, \`border-<token>\`
(e.g. \`bg-brand\`, \`text-grey-700\`, \`border-grey-200\`, \`bg-yellow-500\`). Every token below
exists in all three forms. ALWAYS pick a token from this list — never invent a name or a raw
hex. Shades run light→dark: 25/50 = pale tint backgrounds, 500 = base, 700–900 = dark text/emphasis.

- **System:** white (#FFFFFF), black (#000000)
- **Brand (Sortly red):** brand (#DD2A3B), brand-light (#E45562), brand-dark (#C92636)
- **Grey (neutral):** grey-25 #FBFBFB · 50 #F7F7F7 · 100 #EEEFEF · 200 #E4E4E5 · 300 #CBCCCE · 400 #A8A8AC · 500 #8F9095 · 600 #76777D · 700 #54565D · 800 #464850 · 900 #2F313A
- **Green (Success):** green-25→900, base green-500 #2B8444
- **Yellow (Caution):** yellow-25→900, base yellow-500 #E7C000
- **Orange (Warning):** orange-25→900, base orange-500 #E76500
- **Red (Error):** red-25→900, base red-500 #BF2323
- **Blue (Info):** blue-25→900, base blue-500 #1364D6
- **Supporting:** pink, fuchsia, purple, indigo, teal — each 50→900 (e.g. teal-500 #046C7A, purple-500 #6C32A9, indigo-500 #533DB6)

Examples: success accent → \`bg-green-500\`; caution badge → \`bg-yellow-100 text-yellow-900\`;
primary button → \`bg-brand text-white\`; body text → \`text-grey-700\`; card border → \`border-grey-200\`.
The DS "green" is \`green-500\` and the DS "yellow" is \`yellow-500\` — to recolor green→yellow, swap
\`bg-green-500\`→\`bg-yellow-500\` (and any matching \`text-green-*\`/\`border-green-*\`). Don't go hunting
for the value — it's right here.

Text styles are classes too: \`text-style-<name>\` (e.g. \`text-style-headings-card\`,
\`text-style-body-regular\`, \`text-style-body-caption\`). Typeface is Poppins.

## Figma round-trip — Send to Figma / Update from Figma

The user can take this design to Figma to tweak it, then bring the changes back.
You drive this with the **Figma MCP** (session-connected) plus the Quick MCP.

**Baked-in Sortly Design System (ALWAYS use this, never other Sortly libraries):**
- DS Figma file key: \`JzrHuML2B6dPtb0sBn3hm7\` (Pallet DS (web))
- DS published library key: \`lk-e9fea3d5bd969e07f5ae88b71f9682811ef37a951f71b299402abb13bf09189b4839cde0d377d1746e36749b8394b0709f73deb24310a827ebc66b06c7c3a785\`
  (library name "Pallet DS (web)"). When searching the design system,
  ALWAYS pass \`includeLibraryKeys: ["lk-e9fea3d5…"]\` so you never grab the
  retired/Atlas/Mobile/Web-App Buttons — only Pallet DS (web).

### Send to Figma (when the user asks to send/open this in Figma)
1. Load the \`figma-use\` and \`figma-generate-design\` skills (mandatory before any
   \`use_figma\` call), then \`read_prototype\` to get the current design.
2. **Destination:** if the user gave a Figma file URL, build there. If not, just
   confirm they're connected to Figma and **create a new Figma file** for them
   (the build tools operate on the file open in their Figma desktop app).
3. Rebuild the design as a frame using **Pallet DS (web)** component instances
   (locked to the library key above) + DS color variables and text styles. For any
   component with no DS equivalent (e.g. a summary-stat/KPI card), compose it from
   DS primitives and log the gap.
   - **Preserve real component names.** Always use genuine DS component INSTANCES
     (they carry their real names — "Button", "Nav Rail", "User Avatar" — in the
     Figma layers panel) rather than hand-drawing look-alike frames. For any element
     you must compose manually, give it a clear, descriptive layer name (e.g. "KPI
     Card", "Reports Sidebar", "Metrics Row") and name its wrapper/sections too.
     NEVER leave default names like "Frame 1", "Group 2", or "Container" — a designer
     opening the file must see meaningful, named layers.
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
- **b) Never hardcode a font.** The Pallet DS (web) uses **Poppins**, not Inter. Before
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
   For genuine raster images (photos, logos), use the asset URLs from the design
   context directly — don't omit them over the ~7-day URL expiry; that's fine for a
   prototype.
3. **Rasterized vectors → re-export as REAL SVG (never ship the bitmap or hue-rotate).**
   \`get_design_context\` rasterizes complex vectors (sparklines, charts, trend arrows,
   line icons, dividers, custom shapes) into a hosted bitmap: a semantically-named node
   (\`data-name\` is NOT "Vector"/"Group") whose only child is
   \`<img src="https://www.figma.com/api/mcp/asset/...">\`. A bitmap CANNOT be recolored to
   a DS token — do NOT fake a color change with a CSS \`hue-rotate\`/filter (it can't hit a
   real hex and won't survive back to Figma). Instead, for each such SINGLE-COLOR vector:
   - export the real SVG via the Figma MCP \`use_figma\` tool:
     \`const n = await figma.getNodeByIdAsync("<nodeId>"); return await n.exportAsync({ format: "SVG_STRING" });\`
   - inline the returned \`<svg>…<path/></svg>\` into the prototype (replace the \`<img>\`), and
     set its \`stroke\`/\`fill\` to the real DS color token (e.g. \`stroke="#E7C000"\` or
     \`className="stroke-yellow-500"\`) — a real token, never a filter.
   For MULTI-COLOR or gradient assets (illustrations) that can't map to one token, keep the
   asset as-is and TELL the user "this is a multi-color asset — recolor it in Figma," rather
   than approximating.
4. \`update_prototype\` (or \`edit_prototype\`) with the result; the canvas live-updates.

## Exporting a handoff brief ("Make it real in Sortly")

Note: the "Make it real" button in the Pallet header does NOT involve you — it
hands off directly by drafting a prompt (with this Quick's id) in the user's
**Sortly Prototypes** project, where the rebuild happens. Only produce a handoff
brief when the user EXPLICITLY asks for one here in chat (e.g. "write me a
handoff brief" / "give me a spec to rebuild this in Sortly"). The brief is a
spec they paste into a Pallet chat on the **Sortly Prototypes** project, where
it gets rebuilt as a real route inside the real Sortly app shell.

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

// Fire-and-forget warm-up of a cold Vercel endpoint. The per-prototype MCP
// route (/api/mcp/<id>) isn't touched until the user's first "build" message,
// so it cold-starts on the interactive critical path. Pinging it at create
// time boots the serverless function ahead of the agent's MCP handshake. Kept
// detached, time-boxed, and error-swallowed so it can never affect (or delay)
// the create result.
const warmEndpoint = (url: string) =>
  Effect.tryPromise(() =>
    fetch(url, { method: "GET", signal: AbortSignal.timeout(2000) }),
  ).pipe(Effect.ignore);

// editUrl is `${viewUrl}?edit=${token}` — pull the token out of the real query
// string (robust to extra params) instead of string-splitting on "?edit=".
function parseEditToken(editUrl: string): string | null {
  try {
    return new URL(editUrl).searchParams.get("edit");
  } catch {
    return null;
  }
}

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

  // Warm the cold MCP function now (detached) so it's ready by the time the
  // agent connects on the user's first build message — overlaps the disk
  // writes below and never blocks the returned result. forkDetach severs the
  // fiber from this request's lifecycle so it survives after create returns.
  yield* Effect.forkDetach(warmEndpoint(mcpUrl));

  const workspaceRoot = path.join(
    NodeOS.homedir(),
    QUICKS_DIR_NAME,
    `${slugify(name)}-${id}`,
  );
  yield* fileSystem.makeDirectory(path.join(workspaceRoot, ".claude"), { recursive: true });

  // The four workspace files are independent — write them concurrently.
  // .mcp.json is how the Claude Code engine discovers the prototype's MCP
  // server — no user-facing connection setup. The edit token lives in these
  // local files only; the workspace is never committed anywhere.
  yield* Effect.all(
    [
      fileSystem.writeFileString(
        path.join(workspaceRoot, ".mcp.json"),
        JSON.stringify(
          { mcpServers: { "sortly-quick": { type: "http", url: mcpUrl } } },
          null,
          2,
        ),
      ),
      fileSystem.writeFileString(
        path.join(workspaceRoot, ".claude", "settings.json"),
        JSON.stringify({ enableAllProjectMcpServers: true }, null, 2),
      ),
      fileSystem.writeFileString(
        path.join(workspaceRoot, "CLAUDE.md"),
        buildWorkspaceClaudeMd(name, viewUrl),
      ),
      fileSystem.writeFileString(
        path.join(workspaceRoot, QUICK_MANIFEST_FILE),
        JSON.stringify({ id, name, viewUrl, editUrl }, null, 2),
      ),
    ],
    { concurrency: "unbounded" },
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
    return yield* readQuickManifest(workspaceRoot);
  }),
});

// Publish / unpublish a Quick to the gallery. The prototype's owner secret
// (the edit token) lives in the workspace manifest (editUrl = viewUrl?edit=…),
// so we read it and authorize the publish call as the owner — no Google login
// needed on this side (browsing + upvoting the gallery is what requires it).
// Reads and decodes the workspace's quick.json manifest — null when the file
// is missing or malformed, so callers can degrade gracefully.
const readQuickManifest = Effect.fn("desktop.ipc.sortlyQuick.readManifest")(function* (
  workspaceRoot: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const manifestPath = path.join(workspaceRoot, QUICK_MANIFEST_FILE);
  const raw = yield* fileSystem
    .readFileString(manifestPath)
    .pipe(Effect.orElseSucceed(() => null));
  if (raw === null) return null;
  return yield* decodeQuickInfoJson(raw).pipe(Effect.orElseSucceed(() => null));
});

const doPublish = Effect.fn("desktop.ipc.sortlyQuick.doPublish")(function* (
  workspaceRoot: string,
  publish: boolean,
  name?: string,
) {
  const info = yield* readQuickManifest(workspaceRoot);
  if (info === null) {
    return { error: "Couldn't read this Quick's manifest, so it can't be published." };
  }
  const editToken = parseEditToken(info.editUrl);
  if (!editToken) {
    return { error: "This Quick's manifest is missing its edit token." };
  }
  // On publish, send the descriptive name so the gallery shows it instead of
  // the auto "Quick — <date>" default. On unpublish (DELETE) we send no body.
  const sendName = publish && typeof name === "string" && name.trim().length > 0;
  const body = yield* fetchJson(`${SORTLY_QUICK_BASE_URL}/api/prototypes/${info.id}/publish`, {
    method: publish ? "POST" : "DELETE",
    headers: sendName
      ? { Authorization: `Bearer ${editToken}`, "Content-Type": "application/json" }
      : { Authorization: `Bearer ${editToken}` },
    ...(sendName && name ? { body: JSON.stringify({ name: name.trim().slice(0, 200) }) } : {}),
  });
  // Trust the server's answer when it reports the resulting state (the POST
  // returns { id, is_public, published_at }); fall back to the requested state.
  return {
    ok: true as const,
    isPublic: typeof body.is_public === "boolean" ? body.is_public : publish,
  };
});

export const sortlyQuickPublish = makeIpcMethod({
  channel: IpcChannels.SORTLY_QUICK_PUBLISH_CHANNEL,
  payload: PublishPayloadSchema,
  result: PublishResultSchema,
  handler: Effect.fn("desktop.ipc.sortlyQuick.publish")(function* ({
    workspaceRoot,
    publish,
    name,
  }) {
    const result = yield* Effect.result(doPublish(workspaceRoot, publish, name));
    if (Result.isSuccess(result)) {
      return result.success;
    }
    return { error: result.failure.message };
  }),
});

// Asks the server whether this Quick is currently in the gallery, so the
// Publish button can reflect reality on load instead of always starting at
// "idle". Best-effort: null on any error/404/missing manifest — the caller
// keeps its optimistic default.
const doFetchPublishState = Effect.fn("desktop.ipc.sortlyQuick.doFetchPublishState")(
  function* (workspaceRoot: string) {
    const info = yield* readQuickManifest(workspaceRoot);
    if (info === null) return null;
    const body = yield* fetchJson(
      `${SORTLY_QUICK_BASE_URL}/api/prototypes/${info.id}/publish`,
      { method: "GET" },
    );
    if (typeof body.isPublic !== "boolean") return null;
    return { isPublic: body.isPublic };
  },
);

export const sortlyQuickPublishState = makeIpcMethod({
  channel: IpcChannels.SORTLY_QUICK_PUBLISH_STATE_CHANNEL,
  payload: PublishStatePayloadSchema,
  result: PublishStateResultSchema,
  handler: Effect.fn("desktop.ipc.sortlyQuick.publishState")(function* ({ workspaceRoot }) {
    return yield* doFetchPublishState(workspaceRoot).pipe(Effect.orElseSucceed(() => null));
  }),
});

// Deletes the prototype on the Sortly Quick server (tolerating an already-gone
// 404) — the DELETE also removes it from the gallery server-side.
const deleteOnServer = (id: string, editToken: string) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${SORTLY_QUICK_BASE_URL}/api/prototypes/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${editToken}` },
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Sortly Quick server returned ${response.status}`);
      }
    },
    catch: (cause) =>
      new SortlyQuickError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
  });

// Full delete cascade for a Quick: remove the prototype from the server (and
// with it, the gallery), then remove the local workspace folder. If the server
// call fails, NOTHING is removed: the workspace manifest holds the only copy of
// the edit token, so deleting the folder first would strand an undeletable
// prototype (and gallery entry) on the server forever.
const doDelete = Effect.fn("desktop.ipc.sortlyQuick.doDelete")(function* (
  workspaceRoot: string,
) {
  // SAFETY: this method recursively deletes a directory — refuse anything that
  // isn't inside the dedicated Sortly Quicks home.
  if (!workspaceRoot.includes(`/${QUICKS_DIR_NAME}/`)) {
    return { error: "Refusing to delete: not a Sortly Quick workspace." };
  }
  const fileSystem = yield* FileSystem.FileSystem;

  const info = yield* readQuickManifest(workspaceRoot);
  const editToken = info === null ? null : parseEditToken(info.editUrl);
  if (info !== null && editToken !== null) {
    const deleted = yield* Effect.result(deleteOnServer(info.id, editToken));
    if (Result.isFailure(deleted)) {
      // The manifest in this workspace holds the ONLY copy of the edit token.
      // If the server delete failed (offline, server down), keep the workspace
      // so the delete can be retried — removing it here would strand an
      // undeletable prototype (and gallery entry) on the server forever.
      return {
        error: `Couldn't delete it from the server (${deleted.failure.message}). Nothing was removed — check your connection and try again.`,
      };
    }
  }

  const removed = yield* Effect.result(
    fileSystem.remove(workspaceRoot, { recursive: true, force: true }),
  );
  if (Result.isFailure(removed)) {
    return { error: String(removed.failure) };
  }
  return { ok: true as const };
});

export const sortlyQuickDelete = makeIpcMethod({
  channel: IpcChannels.SORTLY_QUICK_DELETE_CHANNEL,
  payload: DeletePayloadSchema,
  result: DeleteResultSchema,
  handler: Effect.fn("desktop.ipc.sortlyQuick.delete")(function* ({ workspaceRoot }) {
    // doDelete reports every failure in its return value (error channel is
    // never), so no Effect.result dance is needed here.
    return yield* doDelete(workspaceRoot);
  }),
});
