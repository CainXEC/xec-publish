// The official eCash brand mark (the uploaded hexagon-"e" PNGs), scaled to sit
// inline on the dashboard "Total Earned" stat and the carousel "use my address"
// tile. ONE DOM node whose background image swaps by theme — black mark in light
// mode, the white mark in dark mode (see .ecash-logo in globals.css) — so there's
// no left/right image flip. `size` sets the height; width follows the logo's
// native aspect (944×1058) so it never squishes.
export default function EcashIcon({ size = 16 }) {
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
