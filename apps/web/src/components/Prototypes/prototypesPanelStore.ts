import { create } from "zustand";

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
