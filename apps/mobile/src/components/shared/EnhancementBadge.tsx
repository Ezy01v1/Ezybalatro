import { StyleSheet, View } from 'react-native';
import { ENHANCEMENT_TEXTS } from '@/i18n/es';
import { colors, radii, spacing, typography } from '@/theme/tokens';
import { Text } from '@/ui/primitives';

export interface EnhancementBadgeProps {
  /** Engine enhancement id. Unknown ids paint nothing. */
  enhancement: string;
  /** `card` sits in the bottom-left corner of a card; `tile` flows inside a deck-viewer tile. */
  size?: 'card' | 'tile';
  testID?: string;
}

/**
 * Three-letter tag. The shape says when it acts, so it reads without color:
 * filled = when the card scores, outlined = while the card stays in the hand.
 */
export function EnhancementBadge({ enhancement, size = 'card', testID }: EnhancementBadgeProps) {
  const text = ENHANCEMENT_TEXTS[enhancement];
  if (!text) return null;
  const filled = text.timing === 'scored';
  return (
    <View
      testID={testID}
      pointerEvents="none"
      style={[
        styles.badge,
        size === 'card' && styles.onCard,
        filled ? styles.filled : styles.outlined,
      ]}
    >
      <Text
        style={[typography.badge, { color: filled ? colors.primaryFg : colors.card.ink }]}
        maxFontSizeMultiplier={1}
      >
        {text.short}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: spacing.lg,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  onCard: { position: 'absolute', left: spacing.xs, bottom: spacing.xs },
  filled: { backgroundColor: colors.primary },
  outlined: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.card.ink },
});
