/**
 * Tailwind classes for a right-aligned field counter: muted by default, amber near limit, red at/over limit.
 */
export function charCounterClassName(current, max, warnWithin) {
  if (current >= max) return 'text-red-600 dark:text-red-400'
  if (current >= max - warnWithin) return 'text-amber-600 dark:text-amber-400'
  return 'text-zinc-500 dark:text-zinc-400'
}
