// The official eCash brand mark (the uploaded hexagon-"e" PNGs), scaled to sit
// inline on the carousel "use my address" tile. ONE DOM node whose background
// image swaps by theme — black mark in light mode, the white mark in dark mode
// (see .ecash-logo in globals.css) — so there's no left/right image flip. `size`
// sets the height; width follows the logo's native aspect (944×1058) so it never
// squishes.
//
// `outline` renders a line-art version instead: a stroked hexagon-"e" in
// currentColor, matching the other outline button icons (UnlockIcon / BellIcon).
// Used where the mark sits beside text as a thin-line glyph (e.g. the dashboard
// "Total Earned" stat) rather than as a solid avatar.
export default function EcashIcon({ size = 16, outline = false }) {
  if (outline) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        role="img"
        aria-label="eCash"
      >
        <path d="M12 2 L20.5 7 L20.5 17 L12 22 L3.5 17 L3.5 7 Z" />
        <path d="M15 8.5 L9.5 8.5 L7 12 L9.5 15.5 L15 15.5" />
        <path d="M7 12 H13.5" />
      </svg>
    )
  }
  const width = Math.round((size * 944) / 1058)
  return (
    <span
      className="ecash-logo"
      role="img"
      aria-label="eCash"
      style={{ display: 'inline-block', width, height: size }}
    />
  )
}
