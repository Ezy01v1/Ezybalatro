import type { Card } from '@naipes/engine';
import { StyleSheet, View } from 'react-native';
import { PlayingCard } from '@/components/shared/PlayingCard';
import { colors, layout, radii, sizes, spacing } from '@/theme/tokens';

/** Face-down card: the deco back with its brass edge. */
export function CardBack({ width, height }: { width: number; height: number }) {
  return (
    <View
      style={[styles.back, { width, height }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.backInner} />
    </View>
  );
}

/** A row of cards; `null` slots show the back. PlayingCard is absolute and offset by its lift. */
export function CardRow({
  cards,
  width,
  height,
  gap = spacing.xs,
}: {
  cards: (Card | null)[];
  width: number;
  height: number;
  gap?: number;
}) {
  return (
    <View style={{ width: cards.length * width + (cards.length - 1) * gap, height }}>
      {cards.map((card, i) => (
        <View
          key={card ? card.id : `back-${i}`}
          style={[styles.slot, { left: i * (width + gap), width, height }]}
        >
          {card ? (
            <View style={styles.lift}>
              <PlayingCard card={card} width={width} height={height} x={0} />
            </View>
          ) : (
            <CardBack width={width} height={height} />
          )}
        </View>
      ))}
    </View>
  );
}

/** The 5 board slots in the center of the oval. */
export function Board({ cards }: { cards: (Card | null)[] }) {
  return (
    <View testID="board">
      <CardRow cards={cards} width={sizes.boardCard.w} height={sizes.boardCard.h} />
    </View>
  );
}

/** A rival's shown cards at showdown. */
export function SmallCards({ cards }: { cards: Card[] }) {
  return <CardRow cards={cards} width={30} height={42} gap={2} />;
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', top: 0 },
  lift: { marginTop: -layout.card.lift },
  back: {
    backgroundColor: colors.card.back,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.card.edge,
    padding: 3,
  },
  backInner: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.card.edge,
    borderRadius: radii.card - 2,
  },
});
