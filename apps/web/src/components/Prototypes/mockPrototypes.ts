export interface MockPrototype {
  id: string;
  branchName: string;
  title: string;
  description: string;
  author: { name: string; initials: string };
  updatedAt: string; // human-readable
  isMine?: boolean;
  // Where the change lives. Either a path appended to the local dev server
  // (e.g. "/dashboard") or "site-wide" for changes that aren't location-specific.
  // When toggled on, the in-app browser navigates to this path (skipped for "site-wide").
  location: string | "site-wide";
  // Friendly label shown on the card. e.g. "Dashboard", "Inventory", "Site-wide".
  locationLabel: string;
}

// Hardcoded for now. Will be replaced by real branch data from the GitHub API
// once we wire auth + repo connection.
export const MOCK_PROTOTYPES: ReadonlyArray<MockPrototype> = [
  {
    id: "simon/dashboard-cards-v2",
    branchName: "simon/dashboard-cards-v2",
    title: "Dashboard cards v2",
    description: "Reworked stock-movement and recent-activity cards with trend lines.",
    author: { name: "Simon Babba", initials: "SB" },
    updatedAt: "2 hours ago",
    isMine: true,
    location: "/dashboard",
    locationLabel: "Dashboard",
  },
  {
    id: "alice/quick-actions",
    branchName: "alice/quick-actions",
    title: "Quick actions toolbar",
    description: "Floating quick-actions toolbar on every screen for common tasks.",
    author: { name: "Alice Nguyen", initials: "AN" },
    updatedAt: "yesterday",
    location: "site-wide",
    locationLabel: "Site-wide",
  },
  {
    id: "bob/dark-mode-polish",
    branchName: "bob/dark-mode-polish",
    title: "Dark mode polish",
    description: "Refined dark theme tokens and improved chart contrast.",
    author: { name: "Bob Reyes", initials: "BR" },
    updatedAt: "2 days ago",
    location: "site-wide",
    locationLabel: "Site-wide",
  },
  {
    id: "maya/inventory-bulk-edit",
    branchName: "maya/inventory-bulk-edit",
    title: "Inventory bulk edit",
    description: "Multi-select rows and bulk-edit fields in inventory tables.",
    author: { name: "Maya Kim", initials: "MK" },
    updatedAt: "3 days ago",
    location: "/inventory",
    locationLabel: "Inventory",
  },
  {
    id: "jamie/reports-redesign",
    branchName: "jamie/reports-redesign",
    title: "Reports redesign",
    description: "New reports landing page with saved-view tabs and KPI tiles.",
    author: { name: "Jamie Reed", initials: "JR" },
    updatedAt: "last week",
    location: "/reports",
    locationLabel: "Reports",
  },
];
