import { create } from "zustand";

/**
 * The Prototypes panel currently renders placeholder data (see
 * `mockPrototypes.ts` — fabricated teammates/branches). Keep it hidden until
 * it's wired to real Quick data so fake entries never ship to users. Flip to
 * `true` once the panel is backed by real prototypes.
 */
export const PROTOTYPES_PANEL_ENABLED = false;

interface PrototypesPanelStore {
  open: boolean;
  enabled: Set<string>;
  search: string;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  togglePrototype: (id: string) => void;
  setSearch: (search: string) => void;
}

export const usePrototypesPanelStore = create<PrototypesPanelStore>((set) => ({
  open: false,
  enabled: new Set(),
  search: "",
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  togglePrototype: (id) =>
    set((state) => {
      const next = new Set(state.enabled);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { enabled: next };
    }),
  setSearch: (search) => set({ search }),
}));
