// Outline bell drawn in the same line style as the sun/moon in ThemeToggle:
// 24×24 viewBox, no fill, currentColor stroke, rounded caps/joins. Inherits its
// colour and size from the button it sits in (override via `size`). Shared by
// the feed header bell and the dashboard notifications bell.
export default function BellIcon({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}
