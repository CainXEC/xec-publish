import { getSharedAudioContext, playSuccessChime } from '@/lib/webAudioUnlock'

const FLASH_OVERLAY_CLASS = 'post-unlock-flash-overlay'
const FLASH_MS = 800

/**
 * Full-screen green flash (same CSS as article unlock). Appends a node to
 * document.body and removes it after the animation duration.
 */
export function flashPaymentSuccessScreen() {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.className = FLASH_OVERLAY_CLASS
  el.setAttribute('aria-hidden', 'true')
  document.body.appendChild(el)
  window.setTimeout(() => {
    try {
      el.remove()
    } catch {
      /* detached */
    }
  }, FLASH_MS)
}

/**
 * Web Audio success chime (no audio file — synthesized in playSuccessChime).
 * Call after priming AudioContext on the pay button user gesture when possible.
 *
 * @param {AudioContext | null | undefined} [primedAudioContext]
 */
export function triggerPaymentSuccessEffect(primedAudioContext) {
  flashPaymentSuccessScreen()
  const ctx =
    primedAudioContext ??
    (typeof window !== 'undefined' ? getSharedAudioContext() : null)
  playSuccessChime(ctx)
}
