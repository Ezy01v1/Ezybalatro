import { Pressable, StyleSheet } from 'react-native';
import { es } from '@/i18n/es';
import { colors, layout, radii, spacing, touchTarget } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

export interface PriceButtonProps {
  price: number;
  /** Already bought: shows "Comprado" in one line and does nothing. */
  sold?: boolean;
  /** Visually and semantically disabled but still announced (with `accessibilityHint` as the reason). */
  inactive?: boolean;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  testID?: string;
}

/** Two-line buy button: the verb over the price. Wide enough for the text to stretch, never the box. */
export function PriceButton({
  price,
  sold,
  inactive,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  testID,
}: PriceButtonProps) {
  const off = !!(sold || inactive);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: off }}
      onPress={off ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        sold ? styles.sold : styles.primary,
        pressed && !off && styles.pressed,
        inactive && !sold && styles.inactive,
      ]}
    >
      {sold ? (
        <Text variant="caption" center>
          {es.shop.bought}
        </Text>
      ) : (
        <>
          <Text variant="caption" tone="primaryFg" center style={styles.verb}>
            {es.shop.priceVerb}
          </Text>
          <Text variant="button" tone="primaryFg" center>
            {`$${price}`}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: layout.priceButton.minWidth,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  primary: { backgroundColor: colors.primary },
  pressed: { backgroundColor: colors.primaryPressed },
  sold: { backgroundColor: colors.secondary, borderColor: colors.border },
  inactive: { opacity: 0.45 },
  verb: { fontWeight: '700' },
});
