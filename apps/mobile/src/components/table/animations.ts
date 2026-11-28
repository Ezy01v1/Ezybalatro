import { useEffect } from 'react';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { motion } from '@/theme/tokens';

/** With the system's "reduce motion": a plain fade instead of moves and flips (design 4b §4). */
export const REDUCED_FADE_MS = 150;
/** Update period of the turn countdown (the screen ticks every 250 ms). */
const TIMER_STEP_MS = 250;
const out = Easing.bezier(...motion.easing.out);

export type EnterKind = 'deal' | 'flip' | 'chips' | 'allIn' | 'win';

/**
 * Entrance of a card, chip stack or win amount: runs once on mount, transform/opacity only.
 * `index` staggers dealt cards by `dealStaggerMs`.
 */
export function useEnterStyle(kind: EnterKind, index = 0) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      p.value = withTiming(1, { duration: REDUCED_FADE_MS });
      return;
    }
    const duration =
      kind === 'deal'
        ? motion.dealMs
        : kind === 'flip'
          ? motion.flipMs
          : kind === 'win'
            ? motion.potToWinnerMs
            : motion.chipsToPotMs;
    const delay = kind === 'deal' ? index * motion.dealStaggerMs : 0;
    p.value = withDelay(delay, withTiming(1, { duration, easing: out }));
  }, [p, reduced, kind, index]);

  return useAnimatedStyle(() => {
    if (reduced) return { opacity: p.value };
    switch (kind) {
      case 'deal':
        return { opacity: p.value, transform: [{ translateY: (1 - p.value) * -24 }] };
      case 'flip':
        // Grows from edge-on (scaleX 0) to face-up: reads as a card turning over.
        return { transform: [{ scaleX: p.value }] };
      case 'chips':
        return { opacity: p.value, transform: [{ scale: 0.6 + 0.4 * p.value }] };
      case 'allIn': {
        // An extra bounce: overshoots to 1.15 before settling.
        const s =
          p.value < 0.7 ? 0.6 + (0.55 * p.value) / 0.7 : 1.15 - (0.15 * (p.value - 0.7)) / 0.3;
        return { opacity: Math.min(1, p.value * 2), transform: [{ scale: s }] };
      }
      case 'win':
        return { opacity: p.value, transform: [{ translateY: (1 - p.value) * -40 }] };
    }
  });
}

/** A short pulse each time `trigger` changes (pot collecting the street's chips). */
export function usePulseStyle(trigger: number) {
  const reduced = useReducedMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (reduced || trigger === 0) return;
    const half = motion.chipsToPotMs / 2;
    s.value = withSequence(
      withTiming(1.12, { duration: half, easing: out }),
      withTiming(1, { duration: half }),
    );
  }, [s, reduced, trigger]);
  return useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
}

/**
 * Turn timer drained with `scaleX` from `fraction` (no width/layout animation), plus a heartbeat
 * once the last `timerLowAtMs` begin.
 */
export function useTimerStyle(fraction: number, low: boolean) {
  const reduced = useReducedMotion();
  const f = useSharedValue(fraction);
  const beat = useSharedValue(1);
  useEffect(() => {
    f.value = withTiming(fraction, { duration: TIMER_STEP_MS, easing: Easing.linear });
  }, [f, fraction]);
  useEffect(() => {
    if (!low || reduced) {
      beat.value = withTiming(1, { duration: REDUCED_FADE_MS });
      return;
    }
    beat.value = withRepeat(
      withSequence(withTiming(0.45, { duration: 300 }), withTiming(1, { duration: 300 })),
      -1,
    );
  }, [beat, low, reduced]);
  return useAnimatedStyle(() => ({
    opacity: beat.value,
    transform: [{ scaleX: Math.max(0, Math.min(1, f.value)) }],
  }));
}
