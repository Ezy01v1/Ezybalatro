import type { TableUpdate } from '@naipes/shared';
import { useEffect, useRef } from 'react';
import { haptics, playSound } from '@/feedback/feedback';
import { diff, type Effect } from './viewModel';

/** Sound and haptic for one effect (design 4b §4). Animations are driven by the components. */
export function effectFeedback(effect: Effect): void {
  if (effect === 'dealt') playSound('deal');
  else if (effect === 'checked') {
    playSound('check');
    haptics.light();
  } else if (effect === 'myTurnStarted') {
    playSound('turn');
    haptics.light();
  } else if (effect === 'myAllIn') {
    playSound('chips');
    haptics.play();
  } else if (effect === 'iWon') {
    playSound('win');
    haptics.win();
  } else if (effect === 'streetClosed') return;
  else if ('boardRevealed' in effect) playSound('flip');
  else if ('bet' in effect) playSound('chips');
}

/** Plays the effects of a new update once: each sound at most once per update. */
export function playEffects(effects: Effect[]): void {
  // Several bets in one update (or your all-in, which is also a bet) sound like one stack of chips.
  const allIn = effects.includes('myAllIn');
  const played = new Set<string>();
  for (const e of effects) {
    const key = typeof e === 'string' ? e : Object.keys(e)[0]!;
    if (allIn && key === 'bet') continue;
    if (played.has(key)) continue;
    played.add(key);
    effectFeedback(e);
  }
}

/**
 * Fires sound/haptics for each new `update`, exactly once per (table, seq): re-renders and
 * resyncs that deliver the same seq again play nothing.
 */
export function useTableEffects(update: TableUpdate | null, prev: TableUpdate | null): void {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!update) return;
    const key = `${update.tableId}:${update.seq}`;
    if (last.current === key) return;
    last.current = key;
    playEffects(diff(prev, update, update.view.mySeat ?? null));
  }, [update, prev]);
}
