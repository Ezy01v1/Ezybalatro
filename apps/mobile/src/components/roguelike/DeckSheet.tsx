import { SUITS, type RunCard, type RunState, type Suit } from '@naipes/engine';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { EnhancementBadge } from '@/components/shared/EnhancementBadge';
import { Sheet } from '@/components/shared/Sheet';
import { SuitIcon } from '@/components/shared/SuitIcon';
import { ENHANCEMENT_TEXTS, es, RANK_LABELS, RANK_NAMES, SUIT_NAMES } from '@/i18n/es';
import { colors, layout, radii, spacing, typography } from '@/theme/tokens';
import { Button, Text } from '@/ui/primitives';

/** The body scrolls inside this share of the window: the header and the close button stay put. */
const BODY_MAX_SHARE = 0.5;

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Rank high to low; duplicates stay together (same rank and enhancement, then by id for a stable order). */
const byRankDesc = (a: RunCard, b: RunCard) =>
  b.rank - a.rank ||
  (a.enhancement ?? '').localeCompare(b.enhancement ?? '') ||
  a.id.localeCompare(b.id);

const cardLabel = (card: RunCard) => {
  const enhancement = card.enhancement ? ENHANCEMENT_TEXTS[card.enhancement]?.name : undefined;
  return enhancement ? `${RANK_NAMES[card.rank]} ${enhancement}` : RANK_NAMES[card.rank];
};

function Tile({ card }: { card: RunCard }) {
  return (
    <View testID={`deck-card-${card.id}`} accessible={false} style={styles.tile}>
      <Text
        style={[typography.tileIndex, { color: colors.suit[card.suit] }]}
        maxFontSizeMultiplier={layout.fixedBoxFontScale}
      >
        {RANK_LABELS[card.rank]}
      </Text>
      <SuitIcon suit={card.suit} size={layout.deckTile.suitSize} />
      {card.enhancement ? (
        <EnhancementBadge
          enhancement={card.enhancement}
          size="tile"
          testID={`deck-badge-${card.id}`}
        />
      ) : null}
    </View>
  );
}

function SuitSection({ suit, cards }: { suit: Suit; cards: readonly RunCard[] }) {
  const name = capitalize(SUIT_NAMES[suit]);
  const list = cards.length > 0 ? cards.map(cardLabel).join(', ') : es.consumables.deck.emptySuit;
  return (
    <View
      testID={`deck-suit-${suit}`}
      accessible
      accessibilityLabel={es.consumables.deck.suitA11y(name, cards.length, list)}
      style={styles.section}
    >
      <View style={styles.sectionHeader}>
        <SuitIcon suit={suit} size={layout.deckTile.suitSize + spacing.xs} />
        <Text variant="bodyMedium" style={styles.sectionName}>
          {name}
        </Text>
        <Text variant="numeric">{cards.length}</Text>
      </View>
      {cards.length > 0 ? (
        <View style={styles.tiles}>
          {cards.map((card) => (
            <Tile key={card.id} card={card} />
          ))}
        </View>
      ) : (
        <Text variant="caption" tone="muted">
          {es.consumables.deck.emptySuit}
        </Text>
      )}
    </View>
  );
}

/**
 * Read-only list of the whole deck by suit. A card is listed under the suit and rank it has now
 * (read from the card, never from its id), so painted or raised cards show up in their new place.
 * In a blind the header also says how many cards are left to draw.
 */
export function DeckSheet({
  visible,
  run,
  onClose,
}: {
  visible: boolean;
  run: RunState;
  onClose: () => void;
}) {
  const { height } = useWindowDimensions();
  const summary =
    run.phase === 'blind'
      ? `${es.consumables.deck.total(run.deck.length)} · ${es.consumables.deck.drawLeft(run.drawPile.length)}`
      : es.consumables.deck.total(run.deck.length);
  return (
    <Sheet
      visible={visible}
      title={es.consumables.deck.title}
      onClose={onClose}
      testID="deck-sheet"
    >
      <View style={styles.header}>
        <Text testID="deck-total">{summary}</Text>
        <Text variant="caption" tone="muted">
          {es.consumables.deck.legend}
        </Text>
      </View>
      <ScrollView
        style={{ maxHeight: height * BODY_MAX_SHARE }}
        contentContainerStyle={styles.body}
        indicatorStyle="white"
        persistentScrollbar
      >
        {SUITS.map((suit) => (
          <SuitSection
            key={suit}
            suit={suit}
            cards={run.deck.filter((c) => c.suit === suit).sort(byRankDesc)}
          />
        ))}
      </ScrollView>
      <Button testID="deck-close" variant="secondary" label={es.game.close} onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs },
  body: { gap: spacing.md },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionName: { flex: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tile: {
    width: layout.deckTile.width,
    height: layout.deckTile.height,
    alignItems: 'center',
    paddingVertical: spacing.xxs,
    backgroundColor: colors.card.face,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.card.edge,
  },
});
