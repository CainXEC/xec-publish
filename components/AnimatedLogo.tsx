'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Bebas_Neue } from 'next/font/google';
import styles from './AnimatedLogo.module.css';

// The sign's face. next/font self-hosts + preloads it and generates a
// size-adjusted fallback, so the wordmark doesn't reflow when Bebas swaps in
// mid-ignition. Exposes --pow-logo-font, consumed by AnimatedLogo.module.css.
const bebas = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  display: 'swap',
  variable: '--pow-logo-font',
});

// Timing (ms) — the neon-sign demo's constants, verbatim. CSS owns durations;
// these own the starts (per-letter stagger + when the flicker sweep begins).
const IGNITE_MS = 1500;
const FLICK_MS = 500;
const STAGGER_STEP_MS = 70; // between letters
const SEQUENCE_GAP_MS = 760; // between word flickers
const SETTLE_MS = 650; // hold after full ignition, before the sweep
const BLIP_THROTTLE_MS = 3000;

// Ignite once per browsing session, not on every SPA navigation that remounts
// the header. Cleared naturally when the tab closes.
const SESSION_KEY = 'pow-logo-ignited';
const DEFAULT_WORDS: [string, string, string] = ['PROOF', 'OF', 'WRITING'];

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export type AnimatedLogoHandle = {
  /** One throttled word flicker — a subtle acknowledgement blip. */
  blip: (wordIndex?: number) => void;
  /** Re-run the full ignition + flicker sweep (dev bench / manual replay). */
  replay: () => void;
};

export type AnimatedLogoProps = {
  words?: [string, string, string];
  /** Insert word gaps ("PROOF OF WRITING" vs the solid "PROOFOFWRITING"). */
  spaced?: boolean;
  /** Ignore the once-per-session gate — always animate (dev bench). */
  forceAnimate?: boolean;
  className?: string;
};

const AnimatedLogo = forwardRef<AnimatedLogoHandle, AnimatedLogoProps>(
  function AnimatedLogo(
    { words = DEFAULT_WORDS, spaced = false, forceAnimate = false, className },
    ref,
  ) {
    // Server + first client render both produce the fully-lit steady state;
    // animation is opted into after mount. Never read sessionStorage/matchMedia
    // during render — that's what keeps hydration clean.
    const [igniting, setIgniting] = useState(false);

    const rootRef = useRef<HTMLSpanElement>(null);
    const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const lastBlip = useRef(0);
    const reducedMotion = useRef(false);
    // Decide-once latch: StrictMode double-invokes effects in dev, and the
    // session gate would otherwise consume its own flag on the first pass and
    // read "already seen" on the second, cancelling the animation.
    const shouldAnimate = useRef<boolean | null>(null);

    const clearTimers = useCallback(() => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    }, []);

    const schedule = useCallback((fn: () => void, delay: number) => {
      timers.current.push(setTimeout(fn, delay));
    }, []);

    // Restarting a CSS animation needs the class removed, a forced reflow, then
    // re-added — otherwise a repeat call in the same frame is a no-op.
    const flick = useCallback(
      (index: number) => {
        const el = wordRefs.current[index];
        if (!el || reducedMotion.current) return;
        el.classList.remove(styles.flick);
        void el.offsetWidth;
        el.classList.add(styles.flick);
        schedule(() => el.classList.remove(styles.flick), FLICK_MS + 20);
      },
      [schedule],
    );

    // The post-ignition sweep: PROOF, then OF, then WRITING, once.
    const runSweep = useCallback(
      (startDelay: number) => {
        for (let i = 0; i < 3; i += 1) {
          schedule(() => flick(i), startDelay + i * SEQUENCE_GAP_MS);
        }
      },
      [flick, schedule],
    );

    const wordLetterCount = words.join('').length;

    // Track the reduced-motion preference live; if it flips on mid-run, stop.
    useEffect(() => {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      const sync = () => {
        reducedMotion.current = mq.matches;
        if (mq.matches) {
          clearTimers();
          setIgniting(false);
        }
      };
      sync();
      mq.addEventListener('change', sync);
      return () => mq.removeEventListener('change', sync);
    }, [clearTimers]);

    // Ignition on mount — layout effect so the dark 0% frame is committed
    // before first paint (no flash of lit text, then dark, then ignite).
    useIsomorphicLayoutEffect(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      if (shouldAnimate.current === null) {
        if (forceAnimate) {
          shouldAnimate.current = true;
        } else {
          let seen = false;
          try {
            seen = sessionStorage.getItem(SESSION_KEY) === '1';
            if (!seen) sessionStorage.setItem(SESSION_KEY, '1');
          } catch {
            seen = true; // storage blocked → skip, land on the lit base state
          }
          shouldAnimate.current = !seen;
        }
      }
      if (!shouldAnimate.current) return;

      setIgniting(true);
      runSweep(IGNITE_MS + wordLetterCount * STAGGER_STEP_MS + SETTLE_MS);
      return clearTimers;
    }, [forceAnimate, runSweep, clearTimers, wordLetterCount]);

    useEffect(() => clearTimers, [clearTimers]);

    useImperativeHandle(
      ref,
      () => ({
        blip(wordIndex) {
          if (reducedMotion.current) return;
          const now = Date.now();
          if (now - lastBlip.current < BLIP_THROTTLE_MS) return;
          lastBlip.current = now;
          flick(
            typeof wordIndex === 'number'
              ? wordIndex
              : Math.floor(Math.random() * 3),
          );
        },
        replay() {
          if (reducedMotion.current) return;
          clearTimers();
          setIgniting(false);
          requestAnimationFrame(() => {
            void rootRef.current?.offsetWidth;
            setIgniting(true);
            runSweep(IGNITE_MS + wordLetterCount * STAGGER_STEP_MS + SETTLE_MS);
          });
        },
      }),
      [flick, clearTimers, runSweep, wordLetterCount],
    );

    // Running letter index across all words → the demo's pure `i × step` stagger
    // (no jitter), so each glyph lights in reading order. Derived from cumulative
    // word lengths, not a render-scoped mutable counter.
    const wordOffsets = words.map((_, i) =>
      words.slice(0, i).reduce((sum, w) => sum + w.length, 0),
    );

    return (
      <span
        ref={rootRef}
        className={[
          styles.sign,
          igniting && styles.igniting,
          spaced && styles.spaced,
          bebas.variable,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        role="img"
        aria-label={words.join(' ')}
      >
        {words.map((word, w) => (
          <span
            key={`${word}-${w}`}
            ref={(el) => {
              wordRefs.current[w] = el;
            }}
            className={styles.word}
            aria-hidden="true"
          >
            {word.split('').map((char, c) => {
              const delay = ((wordOffsets[w] + c) * STAGGER_STEP_MS) / 1000;
              return (
                <span
                  key={`${w}-${c}`}
                  className={styles.letter}
                  style={{ animationDelay: `${delay.toFixed(3)}s` }}
                >
                  {char}
                </span>
              );
            })}
          </span>
        ))}
      </span>
    );
  },
);

export default AnimatedLogo;
