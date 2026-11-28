import type { PlayerAction } from '@naipes/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import type { QuickKey } from '@/table/viewModel';
import { colors, radii, sizes, spacing, touchTarget } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';
import { useArmed } from '@/ui/useArmed';

const t = es.table;
const QUICK_LABELS: Record<QuickKey, string> = {
  min: t.quick.min,
  half: t.quick.halfPot,
  pot: t.quick.pot,
  all: t.quick.allIn,
};

export interface BetRange {
  type: 'bet' | 'raise';
  min: number;
  max: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Amount picker above the action bar. Every amount stays inside the server's range (`min`..`max`);
 * "Todo" needs a second tap.
 */
export function BetSelector({
  range,
  quick,
  step,
  disabled,
  onConfirm,
  onCancel,
}: {
  range: BetRange;
  quick: { key: QuickKey; amount: number; valid: boolean }[];
  /** The big blind. */
  step: number;
  disabled: boolean;
  onConfirm: (action: PlayerAction) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(range.min);
  const [allInArmed, setAllInArmed] = useArmed();
  const [trackWidth, setTrackWidth] = useState(0);
  const set = (n: number) => {
    setAllInArmed(null);
    setAmount(clamp(Math.round(n), range.min, range.max));
  };
  const fromTouch = (e: GestureResponderEvent) => {
    if (trackWidth <= 0) return;
    const f = clamp(e.nativeEvent.locationX / trackWidth, 0, 1);
    set(range.min + f * (range.max - range.min));
  };
  const confirm = () =>
    onConfirm(range.type === 'bet' ? { type: 'bet', amount } : { type: 'raise', to: amount });
  const fraction = range.max > range.min ? (amount - range.min) / (range.max - range.min) : 1;

  return (
    <View style={styles.root} testID="bet-selector">
      <Text variant="scoreXL" tone="money" center testID="bet-amount">
        {formatNumber(amount)}
      </Text>
      <View style={styles.quickRow}>
        {quick.map((q) => {
          const armed = q.key === 'all' && allInArmed;
          return (
            <Pressable
              key={q.key}
              accessibilityRole="button"
              accessibilityLabel={QUICK_LABELS[q.key]}
              accessibilityState={{ disabled: !q.valid || disabled }}
              disabled={!q.valid || disabled}
              onPress={() => {
                if (q.key !== 'all') return set(q.amount);
                if (allInArmed) return onConfirm({ type: 'allIn' });
                setAmount(range.max);
                setAllInArmed(true);
              }}
              style={[styles.quick, armed && styles.quickArmed, !q.valid && styles.off]}
            >
              <Text variant="bodyMedium" tone={armed ? 'primaryFg' : 'chips'}>
                {QUICK_LABELS[q.key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {allInArmed ? (
        <Text variant="caption" tone="primary" center>
          {t.allInConfirm}
        </Text>
      ) : null}
      <View style={styles.sliderRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.decrease}
          disabled={disabled || amount <= range.min}
          onPress={() => set(amount - step)}
          style={[styles.step, amount <= range.min && styles.off]}
        >
          <Text variant="title">−</Text>
        </Pressable>
        <View
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => !disabled}
          onMoveShouldSetResponder={() => !disabled}
          onResponderGrant={fromTouch}
          onResponderMove={fromTouch}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t.amountA11y}
          accessibilityValue={{ min: range.min, max: range.max, now: amount }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) =>
            set(e.nativeEvent.actionName === 'increment' ? amount + step : amount - step)
          }
          testID="bet-slider"
        >
          <View style={styles.rail} />
          <View style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.increase}
          disabled={disabled || amount >= range.max}
          onPress={() => set(amount + step)}
          style={[styles.step, amount >= range.max && styles.off]}
        >
          <Text variant="title">+</Text>
        </Pressable>
      </View>
      <View style={styles.buttons}>
        <Button label={t.cancel} variant="ghost" onPress={onCancel} style={styles.cancel} />
        <Button
          label={
            range.type === 'bet'
              ? t.actions.betAmount(formatNumber(amount))
              : t.actions.raiseTo(formatNumber(amount))
          }
          disabled={disabled}
          onPress={confirm}
          style={styles.confirm}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.surfaceRaised,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quick: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.chips,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickArmed: { backgroundColor: colors.primary, borderColor: colors.primary },
  off: { opacity: 0.4 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  step: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1, height: touchTarget, justifyContent: 'center' },
  rail: { height: 4, borderRadius: radii.pill, backgroundColor: colors.border },
  fill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.chips,
  },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  cancel: { flex: 1, minHeight: sizes.actionButtonMinHeight },
  confirm: { flex: 2, minHeight: sizes.actionButtonMinHeight },
});
