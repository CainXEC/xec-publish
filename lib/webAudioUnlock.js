/**
 * Web Audio API helpers: unlock on user gesture, play synthesized sounds later (mobile / iOS-safe).
 * No <audio> tags or files. Do not import from server code.
 */

let sharedContext = null

export function getSharedAudioContext() {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!sharedContext || sharedContext.state === 'closed') {
    try {
      sharedContext = new Ctor()
    } catch {
      return null
    }
  }
  return sharedContext
}

/**
 * Run inside the pay button (or any) click/touch handler.
 * - Plays a one-sample silent buffer through gain 0 (proves the output path to WebKit).
 * - Resumes suspended context (required on iOS after creation).
 * Returns a promise that settles after resume (still chained from the gesture in typical use).
 */
export function primeAudioContextOnUserGesture(ctx) {
  if (!ctx) return Promise.resolve(false)

  try {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    const gain = ctx.createGain()
    gain.gain.value = 0
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start(0)
  } catch {
    /* still try resume */
  }

  if (ctx.state === 'suspended') {
    return ctx.resume().then(() => true).catch(() => false)
  }
  return Promise.resolve(true)
}

/** Best-effort resume (e.g. after returning from external wallet app). */
export function ensureAudioContextRunning(ctx) {
  if (!ctx || ctx.state === 'closed') return Promise.resolve(false)
  if (ctx.state === 'suspended') {
    return ctx.resume().then(() => true).catch(() => false)
  }
  return Promise.resolve(true)
}

/**
 * Short success chime (oscillators). Safe to call after async work if context was primed on gesture.
 */
export function playSuccessChime(ctx) {
  if (!ctx || ctx.state === 'closed') return

  const schedule = () => {
    try {
      const o1 = ctx.createOscillator()
      const o2 = ctx.createOscillator()
      const gain = ctx.createGain()
      o1.connect(gain)
      o2.connect(gain)
      gain.connect(ctx.destination)

      o1.frequency.setValueAtTime(523, ctx.currentTime)
      o1.frequency.setValueAtTime(659, ctx.currentTime + 0.1)
      o1.frequency.setValueAtTime(784, ctx.currentTime + 0.2)
      o1.frequency.setValueAtTime(1047, ctx.currentTime + 0.3)

      o2.frequency.setValueAtTime(1047, ctx.currentTime + 0.3)
      o2.type = 'sine'

      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)

      o1.start(ctx.currentTime)
      o1.stop(ctx.currentTime + 0.6)
      o2.start(ctx.currentTime + 0.3)
      o2.stop(ctx.currentTime + 0.6)
    } catch {
      /* graph failed */
    }
  }

  void ensureAudioContextRunning(ctx).then(() => {
    schedule()
  })
}
