// Outline open-padlock in the same line style as BellIcon / the ThemeToggle
// sun-moon: 24×24 viewBox, no fill, currentColor stroke, rounded caps/joins.
// Replaces the 🔓 emoji on the dashboard "Total Unlocks" stat.
export default function UnlockIcon({ size = 16 }) {
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
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </svg>
  )
}
