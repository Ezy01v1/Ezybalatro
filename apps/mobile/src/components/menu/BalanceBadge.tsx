import { StyleSheet, View } from 'react-native';
import { es } from '@/i18n/es';
import { formatNumber } from '@/game/format';
import { colors, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

/** Own chip glyph: a filled disc with an inner ring (no emoji). */
export function ChipIcon({ size = 16 }: { size?: number }) {
  return (
    <View
      accessible={false}
      style={[styles.chip, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <View
        style={{
          width: size * 0.5,
          height: size * 0.5,
          borderRadius: size / 4,
          borderWidth: 1,
          borderColor: colors.bg,
        }}
      />
    </View>
  );
}

/** `balance` null means unknown/loading: shows an em dash. */
export function BalanceBadge({ balance }: { balance: number | null }) {
  const text = balance == null ? '—' : formatNumber(balance);
  return (
    <View style={styles.badge} accessible accessibilityLabel={es.menu.balanceA11y(text)}>
      <ChipIcon />
      <Text variant="button" testID="balance-value">
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chip: {
    backgroundColor: colors.chips,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
