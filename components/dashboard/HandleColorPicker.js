'use client'

import { HANDLE_COLORS } from '@/lib/handleColors'

/**
 * Swatch picker for the color a wallet's handle appears in across the site (feed
 * bylines, article byline, profile header, nav). CONTROLLED: the selected value
 * and the persistence live in the parent ProfileSettingsForm, so the pick is
 * staged and only committed when the user hits "Save changes" — no immediate
 * save, no "updated" toast that would imply the choice already stuck. Tapping the
 * selected swatch again clears back to the default neon byline.
 */
export default function HandleColorPicker({ value = '', onChange, disabled = false }) {
  return (
    <section className="dashpanel">
      <h2 className="prof-panel-title">Handle color</h2>
      <p className="prof-panel-sub">
        The color your handle appears in across the site. Tap the selected swatch
        again to reset to the default. Hit “Save changes” below to apply.
      </p>

      <div className="prof-swatches" role="radiogroup" aria-label="Handle color">
        {HANDLE_COLORS.map((c) => {
          const selected = value === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={c.label}
              title={c.label}
              disabled={disabled}
              onClick={() => onChange?.(selected ? '' : c.value)}
              className={`prof-swatch${selected ? ' sel' : ''}`}
              style={{ '--sw': c.value }}
            />
          )
        })}
      </div>
    </section>
  )
}
