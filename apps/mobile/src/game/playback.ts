import type { HandCategory, ScoreStep } from '@naipes/engine';
import { es } from '@/i18n/es';
import { motion } from '@/theme/tokens';
import { formatMult, formatNumber } from './format';

export type StepTone = 'base' | 'chips' | 'mult' | 'xmult' | 'money';

export interface PlaybackStep {
  /** Card that pulses on this step, if any. */
  readonly cardId?: string;
  /** Joker that pulses on this step, if any. */
  readonly instanceId?: string;
  readonly label: string;
  readonly tone: StepTone;
  /** 1, 2, 3 on the extra passes of a repeated card; absent on the first pass. */
  readonly repeat?: number;
  /** Tally after this step. */
  readonly chips: number;
  readonly mult: number;
}

export interface Playback {
  readonly handType: HandCategory;
  readonly playedIds: readonly string[];
  readonly scoringIds: readonly string[];
  readonly steps: readonly PlaybackStep[];
  /** Time per step: shorter when there are many steps, so the whole count stays under ~2.5 s. */
  readonly stepMs: number;
  readonly score: number;
  readonly roundScore: number;
}

function plainLabelFor(step: ScoreStep): { label: string; tone: StepTone } {
  const { effect, source } = step;
  if (source.kind === 'base') return { label: '', tone: 'base' };
  if (effect.xMult !== undefined && effect.xMult !== 1)
    return { label: `×${formatMult(effect.xMult)} mult`, tone: 'xmult' };
  if (effect.mult) return { label: `+${formatMult(effect.mult)} mult`, tone: 'mult' };
  if (effect.chips) return { label: `+${formatNumber(effect.chips)}`, tone: 'chips' };
  if (effect.money) return { label: `+$${effect.money}`, tone: 'money' };
  return { label: '', tone: 'base' };
}

/** The extra pass of a repeated card is marked, so it reads as "again", not as a new bonus. */
function labelFor(step: ScoreStep): { label: string; tone: StepTone; repeat?: number } {
  const plain = plainLabelFor(step);
  const repeat = step.source.kind === 'base' ? undefined : step.source.repeat;
  if (repeat === undefined || repeat <= 0 || plain.label === '') return plain;
  return { ...plain, label: `${es.score.again} ${plain.label}`, repeat };
}

/** Turns the engine's score steps into what the UI animates. No rules here: only presentation. */
export function buildPlayback(event: {
  readonly handType: HandCategory;
  readonly playedIds: readonly string[];
  readonly scoringIds: readonly string[];
  readonly steps: readonly ScoreStep[];
  readonly score: number;
  readonly roundScore: number;
}): Playback {
  const steps: PlaybackStep[] = event.steps.map((step) => {
    const { label, tone, repeat } = labelFor(step);
    const source = step.source;
    return {
      ...(source.kind === 'card' || source.kind === 'enhancement' ? { cardId: source.cardId } : {}),
      ...(source.kind === 'joker' ? { instanceId: source.instanceId } : {}),
      label,
      tone,
      ...(repeat !== undefined ? { repeat } : {}),
      chips: step.chips,
      mult: step.mult,
    };
  });
  const { scoreStep, scoreStepMin } = motion.duration;
  const stepMs = Math.max(
    scoreStepMin,
    Math.min(scoreStep, Math.floor(motion.maxScoringMs / Math.max(1, steps.length))),
  );
  return {
    handType: event.handType,
    playedIds: event.playedIds,
    scoringIds: event.scoringIds,
    steps,
    stepMs,
    score: event.score,
    roundScore: event.roundScore,
  };
}
