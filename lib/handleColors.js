// The approved on-theme swatches a handle byline may use across the site.
// One source of truth shared by the color picker (UI), the save action
// (server-side validation), and the accounts.handle_color DB CHECK constraint —
// all three must agree. A null/absent value means "use the default neon byline".
export const HANDLE_COLORS = [
  { value: '#00ff9c', label: 'Neon' },
  { value: '#3df0ff', label: 'Cyan' },
  { value: '#ffd166', label: 'Gold' },
  { value: '#ff5c6c', label: 'Coral' },
  { value: '#b085ff', label: 'Violet' },
]

export const HANDLE_COLOR_VALUES = HANDLE_COLORS.map((c) => c.value)

/** True when `value` is one of the approved swatches. Used to reject a crafted
 *  save that tries to set an arbitrary color. */
export function isApprovedHandleColor(value) {
  return typeof value === 'string' && HANDLE_COLOR_VALUES.includes(value)
}
