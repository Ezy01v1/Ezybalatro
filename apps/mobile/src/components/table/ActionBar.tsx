import type { PlayerAction } from '@naipes/shared';
import { StyleSheet, View } from 'react-native';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import type { ActionBarModel } from '@/table/viewModel';
import { colors, sizes, spacing } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';

const t = es.table;

/** Label of the middle button: "Pasar", "Pagar 40" or "Pagar todo (180)". */
export function middleLabel(middle: Extract<ActionBarModel, { kind: 'turn' }>['middle']): string {
  if (middle.type === 'check') return t.actions.check;
  if (middle.type === 'call') return t.actions.callAmount(formatNumber(middle.amount));
  return t.actions.callAllIn(formatNumber(middle.amount));
}

/**
 * Always at the same spot: buttons change text, not position (design 4b §1). Locked while an
 * action travels to the server.
 */
export function ActionBar({
  model,
  disabled,
  onAct,
  onOpenBet,
  onSitIn,
}: {
  model: ActionBarModel;
  disabled: boolean;
  onAct: (action: PlayerAction) => void;
  onOpenBet: () => void;
  onSitIn: () => void;
}) {
  if (model.kind === 'waiting') {
    return (
      <View style={styles.root} testID="action-bar">
        <View style={styles.wide}>
          <Text tone="muted" center numberOfLines={1}>
            {model.actor ? t.waitingFor(model.actor) : t.waitingGeneric}
          </Text>
        </View>
      </View>
    );
  }
  if (model.kind === 'sitIn') {
    return (
      <View style={styles.root} testID="action-bar">
        <Button label={t.sitIn} onPress={onSitIn} disabled={disabled} style={styles.wide} />
      </View>
    );
  }
  const { middle, right } = model;
  return (
    <View style={[styles.root, styles.myTurn]} testID="action-bar">
      <Button
        label={t.actions.fold}
        variant="secondary"
        disabled={disabled}
        onPress={() => onAct({ type: 'fold' })}
        style={styles.button}
      />
      <Button
        label={middleLabel(middle)}
        disabled={disabled}
        onPress={() =>
          onAct(
            middle.type === 'check'
              ? { type: 'check' }
              : middle.type === 'call'
                ? { type: 'call' }
                : { type: 'allIn' },
          )
        }
        style={styles.button}
      />
      {right ? (
        <Button
          label={right.type === 'bet' ? t.actions.bet : t.actions.raise}
          variant="secondary"
          disabled={disabled}
          onPress={onOpenBet}
          style={styles.button}
        />
      ) : (
        <View style={styles.button} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: sizes.actionButtonMinHeight + spacing.sm * 2,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'transparent',
  },
  myTurn: { borderTopColor: colors.primary },
  wide: { flex: 1, minHeight: sizes.actionButtonMinHeight, justifyContent: 'center' },
  button: { flex: 1, minHeight: sizes.actionButtonMinHeight, paddingHorizontal: spacing.xs },
});
