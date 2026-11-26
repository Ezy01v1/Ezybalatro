import { findConsumable, type RunErrorCode, type RunState } from '@naipes/engine';
import { es } from '@/i18n/es';

/**
 * Copy for an engine error when using a consumable. It only picks a sentence: whether the use is
 * valid is always decided by the engine. `count` is how many cards were chosen.
 */
export function consumableErrorText(
  code: RunErrorCode,
  run: RunState,
  consumableId: string,
  count: number,
): string {
  const t = es.consumables.errors;
  switch (code) {
    case 'NO_CONSUMABLE_SLOT':
      return t.noSlot;
    case 'INVALID_PHASE':
      return t.invalidPhase;
    case 'INVALID_CONSUMABLE':
      return t.invalidConsumable;
    case 'INVALID_CARDS': {
      const def = findConsumable(consumableId);
      if (def?.targets && (count < def.targets.min || count > def.targets.max))
        return t.pickBetween(def.targets.min, def.targets.max);
      // The reason is in what the consumable does (data), not in its id.
      if (def?.ops.some((op) => op.op === 'shiftRank')) return t.elevateAce;
      if (def?.ops.some((op) => op.op === 'destroyCards'))
        return t.scrapMin(run.config.minDeckSize);
      return t.invalidCards;
    }
    default:
      return t.generic;
  }
}
