import type { RunCard } from '@naipes/engine';
import { StyleSheet, View } from 'react-native';
import { RANK_LABELS } from '@/i18n/es';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { Text } from '@/ui/primitives';
import { EnhancementBadge } from './EnhancementBadge';
import { SuitIcon } from './SuitIcon';

const SIZES = {
  tile: { box: layout.deckTile, suit: layout.deckTile.suitSize },
  pack: { box: layout.packThumb, suit: 18 },
} as const;

/**
 * The face of a card that has no id yet (an option in a pack): rank, suit and the enhancement tag.
 * Read from the card's own fields, never from an id.
 */
export function CardFace({
  card,
  size,
  testID,
}: {
  card: Pick<RunCard, 'rank' | 'suit' | 'enhancement'>;
  size: keyof typeof SIZES;
  testID?: string;
}) {
  const { box, suit } = SIZES[size];
  return (
    <View
      testID={testID}
      accessible={false}
      style={[styles.face, { width: box.width, height: box.height }]}
    >
      <Text
        style={[typography.tileIndex, { color: colors.suit[card.suit] }]}
        maxFontSizeMultiplier={layout.fixedBoxFontScale}
      >
        {RANK_LABELS[card.rank]}
      </Text>
      <SuitIcon suit={card.suit} size={suit} />
      {card.enhancement ? <EnhancementBadge enhancement={card.enhancement} size="tile" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    alignItems: 'center',
    paddingVertical: spacing.xxs,
    backgroundColor: colors.card.face,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.card.edge,
  },
});
