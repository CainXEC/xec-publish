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
import styles from './AnimatedLogo.module.css';

/* ------------------------------------------------------------------ *
 * Timing constants. All durations in ms.
 * Keep these in sync with AnimatedLogo.module.css — the CSS animation
 * durations are the source of truth for how long a thing takes, these
 * constants are the source of truth for when it starts.
 * ------------------------------------------------------------------ */

const IGNITE_MS = 1500;        // .letter animation duration
const FLICK_MS = 500;          // .flick animation duration
const STAGGER_STEP_MS = 70;    // per-letter offset during ignition
const SEQUENCE_GAP_MS = 760;   // gap between word flickers
const SETTLE_MS = 650;         // hold after full ignition before flickers
const BLIP_THROTTLE_MS = 3000; // minimum spacing between chain-driven blips

const SESSION_KEY = 'pow-logo-ignited';

/* Deterministic per-letter jitter. Do NOT replace with Math.random() —
 * this is read during render, so a random value would produce different
 * markup on server and client and break hydration. Fourteen values,
 * reused cyclically if the wordmark is ever changed. */
const JITTER = [
  0.031, 0.008, 0.046, 0.019, 0.002, 0.038, 0.024,
  0.011, 0.049, 0.006, 0.034, 0.017, 0.042, 0.027,
];

const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/* ------------------------------------------------------------------ */

export type AnimatedLogoHandle = {
  /** Flicker one word section. Index 0 = PROOF, 1 = OF, 2 = WRITING.
   *  Omit the index for a random section. Throttled; calls that arrive
   *  inside the throttle window are dropped, not queued. */
  blip: (wordIndex?: number) => void;
  /** Replay the full power-on sequence. Ignores the session gate.
   *  Intended for dev tooling and the brand page, not normal navigation. */
  replay: () => void;
};

export type AnimatedLogoProps = {
  /** The three word sections. Order is preserved. */
  words?: [string, string, string];
  /** Render visible spaces between sections. */
  spaced?: boolean;
  /** Bypass the session gate and always animate. Use on a brand/about
   *  page where the animation is the point. Never on the global header. */
  forceAnimate?: boolean;
  className?: string;
};

const AnimatedLogo = forwardRef<AnimatedLogoHandle, AnimatedLogoProps>(
  function AnimatedLogo(
    {
      words = ['PROOF', 'OF', 'WRITING'],
      spaced = false,
      forceAnimate = false,
      className,
    },
    ref
  ) {
    /* Server and first client render both produce the fully-lit steady
     * state. Animation is opted into after mount. This is what keeps
     * hydration clean — never read sessionStorage or matchMedia during
     * render. */
    const [igniting, setIgniting] = useState(false);

    const rootRef = useRef<HTMLSpanElement>(null);
    const wordRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    const lastBlip = useRef(0);
    const reducedMotion = useRef(false);

    const clearTimers = useCallback(() => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    }, []);

    const schedule = useCallback((fn: () => void, delay: number) => {
      timers.current.push(setTimeout(fn, delay));
    }, []);

    /* Apply the flicker class to one word section. Restarting the
     * animation requires removing the class, forcing a reflow, then
     * re-adding it — otherwise a repeat call within the same frame is
     * a no-op. */
    const flick = useCallback((index: number) => {
      const el = wordRefs.current[index];
      if (!el || reducedMotion.current) return;
      el.classList.remove(styles.flick);
      void el.offsetWidth;
      el.classList.add(styles.flick);
      schedule(() => el.classList.remove(styles.flick), FLICK_MS + 20);
    }, [schedule]);

    /* The three-beat post-ignition sequence: PROOF, then OF, then
     * WRITING. Fires once, after the sign has fully lit and settled. */
    const runSequence = useCallback(
      (startDelay: number) => {
        for (let i = 0; i < 3; i += 1) {
          schedule(() => flick(i), startDelay + i * SEQUENCE_GAP_MS);
        }
      },
      [flick, schedule]
    );

    /* Track the motion preference live — users can change it mid-session
     * and the sign must go static immediately. */
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

    /* Session gate. Runs before paint so there is no frame of lit sign
     * before the ignition starts. */
    useIsomorphicLayoutEffect(() => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      if (!forceAnimate) {
        let seen = false;
        try {
          seen = sessionStorage.getItem(SESSION_KEY) === '1';
          if (!seen) sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          /* Storage can throw in private browsing or with cookies
           * blocked. Treat as already-seen: a static header is the safe
           * failure, a header that re-ignites on every route change is
           * not. */
          seen = true;
        }
        if (seen) return;
      }

      setIgniting(true);

      const letterCount = words.join('').length;
      const fullyLit = IGNITE_MS + letterCount * STAGGER_STEP_MS;
      runSequence(fullyLit + SETTLE_MS);

      return clearTimers;
    }, [forceAnimate, runSequence, clearTimers, words]);

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
              : Math.floor(Math.random() * 3)
          );
        },
        replay() {
          if (reducedMotion.current) return;
          clearTimers();
          setIgniting(false);
          /* Force a reflow between teardown and restart so the letter
           * animations actually re-run. */
          requestAnimationFrame(() => {
            void rootRef.current?.offsetWidth;
            setIgniting(true);
            const letterCount = words.join('').length;
            runSequence(
              IGNITE_MS + letterCount * STAGGER_STEP_MS + SETTLE_MS
            );
          });
        },
      }),
      [flick, clearTimers, runSequence, words]
    );

    // Global letter index (drives each letter's stagger delay + jitter) derived
    // per (word, char) from cumulative word lengths — not a render-scoped mutable
    // counter, which react-hooks/immutability rejects.
    const wordOffsets = words.map((_, i) =>
      words.slice(0, i).reduce((sum, w) => sum + w.length, 0),
    );

    return (
      <span
        ref={rootRef}
        className={[styles.sign, igniting && styles.igniting, className]
          .filter(Boolean)
          .join(' ')}
        /* The wordmark is decorative markup — three spans of single
         * letters. Expose it to assistive tech as one string. */
        role="img"
        aria-label={words.join(' ')}
      >
        {words.map((word, w) => (
          <span
            key={word + w}
            ref={(el) => {
              wordRefs.current[w] = el;
            }}
            className={styles.word}
            style={
              spaced && w < words.length - 1
                ? { marginRight: '0.28em' }
                : undefined
            }
            aria-hidden="true"
          >
            {word.split('').map((char, c) => {
              const letterIndex = wordOffsets[w] + c;
              const delay =
                letterIndex * (STAGGER_STEP_MS / 1000) +
                JITTER[letterIndex % JITTER.length];
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
  }
);

export default AnimatedLogo;
