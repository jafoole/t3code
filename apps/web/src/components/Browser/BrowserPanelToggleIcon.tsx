interface BrowserPanelToggleIconProps {
  open: boolean;
  className?: string;
}

export function BrowserPanelToggleIcon({ open, className }: BrowserPanelToggleIconProps) {
  // Sidebar/panel toggle: rectangle with a vertical divider hinting at the side panel.
  // Same icon shape used to both open and close; `open` is exposed for future visual variants.
  void open;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className ?? "size-3"}
    >
      <rect
        x="2"
        y="3.5"
        width="12"
        height="9"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line x1="10" y1="3.5" x2="10" y2="12.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}
