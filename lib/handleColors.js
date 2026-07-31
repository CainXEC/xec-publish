// The approved on-theme swatches a handle byline may use across the site.
// One source of truth shared by the color picker (UI), the save action
// (server-side validation), and the accounts.handle_color DB CHECK constraint —
// all three must agree. A null/absent value means "use the default neon byline".
// Ordered around the wheel so the picker reads as an even spectrum. Adding a
// value here also requires widening the accounts.handle_color DB CHECK
// constraint (sql/handle_colors_palette.sql) or the save is rejected.
export const HANDLE_COLORS = [
  { value: '#00ff9c', label: 'Neon' },
  { value: '#22d3bb', label: 'Teal' },
  { value: '#3df0ff', label: 'Cyan' },
  { value: '#5b9dff', label: 'Blue' },
  { value: '#b085ff', label: 'Violet' },
  { value: '#ff6ad5', label: 'Pink' },
  { value: '#ff5c6c', label: 'Coral' },
  { value: '#ff9142', label: 'Orange' },
  { value: '#ffd166', label: 'Gold' },
]

export const HANDLE_COLOR_VALUES = HANDLE_COLORS.map((c) => c.value)

/** True when `value` is one of the approved swatches. Used to reject a crafted
 *  save that tries to set an arbitrary color. */
export function isApprovedHandleColor(value) {
  return typeof value === 'string' && HANDLE_COLOR_VALUES.includes(value)
}
