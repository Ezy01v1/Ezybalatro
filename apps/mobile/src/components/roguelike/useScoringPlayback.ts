import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { haptics, playSound } from '@/game/feedback';
import type { Playback, PlaybackStep } from '@/game/playback';

export interface PlaybackView {
  /** Index of the step being shown. */
  index: number;
  chips: number;
  mult: number;
  /** cardId / instanceId → how many steps involved it so far (each increment triggers a pulse). */
  cardPulses: Record<string, number>;
  jokerPulses: Record<string, number>;
  jokerLabels: Record<string, string>;
  cardLabels: Record<string, string>;
  /** True once every step was shown and the final score is on screen. */
  finished: boolean;
  skip: () => void;
}

const RESULT_HOLD_MS = 700;

interface Progress {
  of: Playback | null;
  index: number;
  finished: boolean;
}

function stepFeedback(step: PlaybackStep, first: boolean) {
  if (first) {
    haptics.play();
    playSound('play');
  }
  if (step.instanceId) {
    haptics.joker(step.tone === 'xmult');
    playSound('joker');
  } else if (step.tone === 'chips') playSound('chips');
  else if (step.tone === 'mult' || step.tone === 'xmult') playSound('mult');
  else if (step.tone === 'money') playSound('coin');
}

/**
 * Plays the engine's score steps one by one: one timer and one re-render per step (never per
 * frame); the pulses themselves run on the UI thread. `onDone` fires after the final score.
 */
export function useScoringPlayback(
  playback: Playback | null,
  onDone: () => void,
): PlaybackView | null {
  const [progress, setProgress] = useState<Progress>({ of: null, index: 0, finished: false });
  // A new playback starts from its first step (derived, no reset effect needed).
  const current: Progress =
    progress.of === playback ? progress : { of: playback, index: 0, finished: false };
  const done = useEffectEvent(onDone);
  const feedback = useEffectEvent(stepFeedback);

  useEffect(() => {
    if (!playback) return;
    if (current.finished) {
      const timer = setTimeout(() => done(), RESULT_HOLD_MS);
      return () => clearTimeout(timer);
    }
    const step = playback.steps[current.index];
    if (step) feedback(step, current.index === 0);
    const timer = setTimeout(() => {
      const last = current.index + 1 >= playback.steps.length;
      setProgress({
        of: playback,
        index: last ? current.index : current.index + 1,
        finished: last,
      });
    }, playback.stepMs);
    return () => clearTimeout(timer);
  }, [playback, current.index, current.finished]);

  const pulses = useMemo(() => {
    const card: Record<string, number> = {};
    const joker: Record<string, number> = {};
    for (const step of playback?.steps.slice(0, current.index + 1) ?? []) {
      if (step.cardId) card[step.cardId] = (card[step.cardId] ?? 0) + 1;
      if (step.instanceId) joker[step.instanceId] = (joker[step.instanceId] ?? 0) + 1;
    }
    return { card, joker };
  }, [playback, current.index]);

  if (!playback) return null;
  const step = playback.steps[Math.min(current.index, playback.steps.length - 1)]!;
  const showLabels = !current.finished && step.label !== '';

  return {
    index: current.index,
    chips: step.chips,
    mult: step.mult,
    cardPulses: pulses.card,
    jokerPulses: pulses.joker,
    cardLabels: showLabels && step.cardId ? { [step.cardId]: step.label } : {},
    jokerLabels: showLabels && step.instanceId ? { [step.instanceId]: step.label } : {},
    finished: current.finished,
    skip: onDone,
  };
}
