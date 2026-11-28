import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '@/theme/tokens';
import { PriceButton } from '@/ui/PriceButton';
import { Text } from '@/ui/primitives';

export interface OfferRowProps {
  /** Position in `run.shop`: the test ids stay `offer-<index>` and `buy-<index>`. */
  index: number;
  title: string;
  /** "Elige 1 de 3" (pack) or the short effect (voucher). */
  line2: string;
  description: string;
  /** Why it cannot be bought (or "Comprado"). */
  status?: string | null;
  statusTone?: 'danger' | 'muted';
  price: number;
  sold: boolean;
  inactive: boolean;
  /** Vouchers carry a 3 px brass edge on the left. */
  emphasis?: 'voucher';
  buyLabel: string;
  onBuy: () => void;
}

/** Compact offer (pack or voucher): text on the left, a two-line price button on the right. */
export function OfferRow({
  index,
  title,
  line2,
  description,
  status,
  statusTone = 'muted',
  price,
  sold,
  inactive,
  emphasis,
  buyLabel,
  onBuy,
}: OfferRowProps) {
  return (
    <View
      testID={`offer-${index}`}
      style={[styles.row, emphasis === 'voucher' && styles.voucher, sold && styles.sold]}
    >
      <View
        style={styles.text}
        accessible
        accessibilityLabel={[title, line2, description, status].filter(Boolean).join('. ')}
      >
        <Text variant="bodyMedium" numberOfLines={2}>
          {title}
        </Text>
        <Text variant="caption" tone="primary" style={styles.line2}>
          {line2}
        </Text>
        <Text variant="caption" tone="muted">
          {description}
        </Text>
        {status ? (
          <Text variant="caption" tone={statusTone}>
            {status}
          </Text>
        ) : null}
      </View>
      <PriceButton
        testID={`buy-${index}`}
        price={price}
        sold={sold}
        inactive={inactive}
        accessibilityLabel={buyLabel}
        accessibilityHint={status ?? undefined}
        onPress={onBuy}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  voucher: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  sold: { opacity: 0.7 },
  text: { flex: 1, gap: spacing.xxs },
  line2: { fontWeight: '700' },
});
