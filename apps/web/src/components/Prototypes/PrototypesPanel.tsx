import { useMemo } from "react";

import { usePreviewUrlStore } from "../Browser/previewUrlStore";
import { openPreviewPopout } from "../Browser/openPreview";
import { Switch } from "../ui/switch";
import { MOCK_PROTOTYPES, type MockPrototype } from "./mockPrototypes";
import { usePrototypesPanelStore } from "./prototypesPanelStore";

const PANEL_WIDTH = 320;

export function PrototypesPanel() {
  const open = usePrototypesPanelStore((s) => s.open);
  const setOpen = usePrototypesPanelStore((s) => s.setOpen);
  const enabled = usePrototypesPanelStore((s) => s.enabled);
  const togglePrototype = usePrototypesPanelStore((s) => s.togglePrototype);
  const search = usePrototypesPanelStore((s) => s.search);
  const setSearch = usePrototypesPanelStore((s) => s.setSearch);

  // On toggle-on, jump the in-app browser to where the prototype lives so the
  // user doesn't have to hunt for the change. Skipped for site-wide changes.
  const handleToggle = (prototype: MockPrototype) => {
    const willEnable = !enabled.has(prototype.id);
    togglePrototype(prototype.id);
    if (willEnable && prototype.location !== "site-wide") {
      const currentUrl = usePreviewUrlStore.getState().url;
      try {
        const base = currentUrl ? new URL(currentUrl) : new URL("http://localhost:3000");
        base.pathname = prototype.location;
        openPreviewPopout(base.toString());
      } catch {
        // ignore URL parse failures
      }
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return MOCK_PROTOTYPES;
    return MOCK_PROTOTYPES.filter(
      (p) =>
        p.title.toLowerCase().includes(term) ||
        p.branchName.toLowerCase().includes(term) ||
        p.author.name.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term),
    );
  }, [search]);

  const mine = filtered.filter((p) => p.isMine);
  const others = filtered.filter((p) => !p.isMine);

  if (!open) return null;

  return (
    <div
      className="flex h-full min-h-0 flex-col border-r border-border bg-card"
      style={{ width: PANEL_WIDTH, flex: `0 0 ${PANEL_WIDTH}px` }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">Prototypes</div>
          <div className="truncate text-xs text-muted-foreground">
            Toggle other people's work on top of yours.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="ml-2 shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close prototypes panel"
          title="Close prototypes panel"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 4L12 12M12 4L4 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="shrink-0 border-b border-border px-3 py-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prototypes…"
          className="w-full rounded bg-muted/50 px-2 py-1.5 text-xs outline-none focus:bg-background focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {mine.length > 0 && (
          <PrototypeSection
            heading="Your prototype"
            items={mine}
            enabled={enabled}
            onToggle={handleToggle}
          />
        )}
        <PrototypeSection
          heading="Other prototypes"
          items={others}
          enabled={enabled}
          onToggle={handleToggle}
        />
        {filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No prototypes match "{search}".
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        {enabled.size === 0
          ? "Nothing layered. Toggle a prototype to preview it."
          : `${enabled.size} prototype${enabled.size === 1 ? "" : "s"} layered`}
      </div>
    </div>
  );
}

function PrototypeSection({
  heading,
  items,
  enabled,
  onToggle,
}: {
  heading: string;
  items: ReadonlyArray<MockPrototype>;
  enabled: Set<string>;
  onToggle: (prototype: MockPrototype) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </div>
      <ul>
        {items.map((p) => (
          <PrototypeRow
            key={p.id}
            prototype={p}
            isEnabled={enabled.has(p.id)}
            onToggle={() => onToggle(p)}
          />
        ))}
      </ul>
    </div>
  );
}

function PrototypeRow({
  prototype,
  isEnabled,
  onToggle,
}: {
  prototype: MockPrototype;
  isEnabled: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-b border-border px-3 py-3 last:border-b-0 hover:bg-accent/30">
      <div className="flex items-start gap-2.5">
        <div
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground"
          aria-hidden
        >
          {prototype.author.initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">{prototype.title}</span>
            {prototype.isMine && (
              <span className="shrink-0 rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                you
              </span>
            )}
          </div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
            {prototype.description}
          </p>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/80">
            <span className="shrink-0 rounded bg-primary/8 px-1.5 py-0.5 font-medium text-primary">
              {prototype.locationLabel}
            </span>
            <code className="truncate rounded bg-muted/60 px-1 py-0.5 font-mono">
              {prototype.branchName}
            </code>
            <span>·</span>
            <span className="shrink-0">{prototype.updatedAt}</span>
          </div>
        </div>
        <Switch
          checked={isEnabled}
          onCheckedChange={onToggle}
          aria-label={`Toggle ${prototype.title}`}
          className="mt-0.5 shrink-0"
        />
      </div>
    </li>
  );
}
