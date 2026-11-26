import {
  consumableSellValue,
  findConsumable,
  type HandCategory,
  type RunState,
} from '@naipes/engine';
import { useState } from 'react';
import { Sheet } from '@/components/shared/Sheet';
import { haptics, playSound } from '@/feedback/feedback';
import { useGame } from '@/game/store';
import { CONSUMABLE_TEXTS, es, HAND_NAMES } from '@/i18n/es';
import { Button, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';
import { consumableErrorText } from './consumable-errors';

/**
 * Detail of a consumable in the inventory: use it (right away, or by picking cards in a blind)
 * or sell it (two taps). Which of those is possible is decided by the engine; this only reads
 * the consumable's data to show the right button state and texts.
 */
export function ConsumableSheet({
  run,
  instanceId,
  onClose,
  onUsed,
}: {
  run: RunState;
  instanceId: string | null;
  onClose: () => void;
  /** Short message for the screen's notice ("Par sube al nivel 3", "Vendido por $1"). */
  onUsed?: (message: string) => void;
}) {
  const applyConsumable = useGame((s) => s.applyConsumable);
  const beginTargeting = useGame((s) => s.beginTargeting);
  const sellConsumable = useGame((s) => s.sellConsumable);
  const [armedSell, setArmedSell] = useArmed<string>();
  const [error, setError] = useState<string | null>(null);

  const instance = run.consumables.find((c) => c.instanceId === instanceId) ?? null;
  const def = instance ? findConsumable(instance.consumableId) : undefined;
  const text = instance
    ? (CONSUMABLE_TEXTS[instance.consumableId] ?? {
        name: instance.consumableId,
        description: '',
      })
    : null;

  const close = () => {
    setArmedSell(null);
    setError(null);
    onClose();
  };

  // Only consumables that need cards care about the phase: they are for blinds.
  const needsBlind = !!def?.targets && run.phase !== 'blind';
  const sellValue = instance ? consumableSellValue(instance) : 0;
  const selling = !!instance && armedSell === instance.instanceId;

  const use = () => {
    if (!instance || !def || needsBlind) return;
    if (def.targets) {
      beginTargeting(instance.instanceId);
      haptics.select();
      close();
      return;
    }
    const code = applyConsumable(instance.instanceId);
    if (code) {
      setError(consumableErrorText(code, run, instance.consumableId, 0));
      return;
    }
    haptics.select();
    playSound('select');
    // The study's new level is read from the run the engine just produced.
    let hand: HandCategory | undefined;
    for (const op of def.ops) if (op.op === 'levelUpHand') hand = op.hand;
    const level = hand ? useGame.getState().run?.handLevels[hand] : undefined;
    onUsed?.(
      hand && level
        ? es.consumables.studyUsed(HAND_NAMES[hand], level)
        : es.consumables.used(text?.name ?? ''),
    );
    close();
  };

  const sell = () => {
    if (!instance) return;
    if (!selling) return setArmedSell(instance.instanceId);
    sellConsumable(instance.instanceId);
    playSound('coin');
    onUsed?.(es.consumables.sold(sellValue));
    close();
  };

  return (
    <Sheet visible={!!instance} title={text?.name ?? ''} onClose={close} testID="consumable-detail">
      <Text variant="body" center>
        {text?.description}
      </Text>
      <Text variant="caption" tone="muted" center>
        {def?.targets
          ? es.consumables.targetsInfo(def.targets.min, def.targets.max)
          : es.consumables.whereAny}
      </Text>
      <Button
        testID="consumable-use"
        label={es.consumables.use}
        inactive={needsBlind}
        accessibilityHint={needsBlind ? es.consumables.onlyInBlind : undefined}
        onPress={needsBlind ? undefined : use}
      />
      {needsBlind ? (
        <Text variant="caption" tone="muted" center testID="consumable-use-reason">
          {es.consumables.onlyInBlind}
        </Text>
      ) : null}
      {error ? (
        <Text
          variant="caption"
          tone="danger"
          center
          accessibilityLiveRegion="polite"
          testID="consumable-error"
        >
          {error}
        </Text>
      ) : null}
      <Button
        testID="consumable-sell"
        variant="secondary"
        label={selling ? es.shop.sellConfirm(sellValue) : es.shop.sell(sellValue)}
        onPress={sell}
      />
      <Button variant="ghost" label={es.game.close} onPress={close} />
    </Sheet>
  );
}
