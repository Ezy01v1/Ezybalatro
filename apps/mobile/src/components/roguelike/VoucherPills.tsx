import { StyleSheet, View } from 'react-native';
import { es, VOUCHER_TEXTS } from '@/i18n/es';
import { colors, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

/**
 * The vouchers bought so far, as short effects ("+1 mano"). Not buttons: the effect was read in full
 * when it was bought. Renders nothing when there are none.
 */
export function VoucherPills({ voucherIds }: { voucherIds: readonly string[] }) {
  if (voucherIds.length === 0) return null;
  return (
    <View testID="vouchers-owned" style={styles.wrap}>
      <Text variant="caption" tone="muted" accessibilityRole="header">
        {es.shop.vouchersOwned(voucherIds.length)}
      </Text>
      <View style={styles.pills}>
        {voucherIds.map((id) => {
          const text = VOUCHER_TEXTS[id];
          return (
            <View
              key={id}
              testID={`voucher-pill-${id}`}
              accessible
              accessibilityLabel={`${text?.name ?? id}: ${text?.description ?? ''}`}
              style={styles.pill}
            >
              <Text variant="caption">{text?.short ?? id}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
