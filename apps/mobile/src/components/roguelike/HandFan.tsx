import type { RunCard } from '@naipes/engine';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { es } from '@/i18n/es';
import { layout } from '@/theme/tokens';
import { PlayingCard } from './PlayingCard';

export interface HandFanProps {
  cards: readonly RunCard[];
  selected: readonly string[];
  debuffedIds: ReadonlySet<string>;
  onToggle: (cardId: string) => void;
}

/**
 * Cards in a gentle fan. With 8 cards at 360 px each card shows at least 38 px, enough for the
 * corner index (the only part that is always visible). Wider screens grow the cards up to 72 px.
 */
export function computeFan(count: number, width: number) {
  const cardWidth = Math.min(
    layout.card.maxWidth,
    Math.max(layout.card.width, Math.floor(width / 6.2)),
  );
  const cardHeight = Math.round(cardWidth * (layout.card.height / layout.card.width));
  const step = count <= 1 ? 0 : Math.min(cardWidth + 4, (width - cardWidth) / (count - 1));
  const used = cardWidth + step * Math.max(0, count - 1);
  const offset = (width - used) / 2;
  return {
    cardWidth,
    cardHeight,
    positions: Array.from({ length: count }, (_, i) => ({
      x: offset + i * step,
      rotation: count <= 1 ? 0 : (i - (count - 1) / 2) * 1.5,
    })),
  };
}

export function HandFan({ cards, selected, debuffedIds, onToggle }: HandFanProps) {
  const [width, setWidth] = useState(360 - layout.gutter * 2);
  const fan = computeFan(cards.length, width);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      style={[styles.fan, { height: fan.cardHeight + layout.card.lift * 2 }]}
      onLayout={onLayout}
      accessibilityLabel={es.game.handLabel}
    >
      {cards.map((card, i) => (
        <PlayingCard
          // Keyed by card: kept cards slide to their new place, new cards play the deal entrance.
          key={card.id}
          card={card}
          width={fan.cardWidth}
          height={fan.cardHeight}
          x={fan.positions[i]!.x}
          rotation={fan.positions[i]!.rotation}
          selected={selected.includes(card.id)}
          debuffed={debuffedIds.has(card.id)}
          dealIndex={i}
          onPress={onToggle}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fan: { width: '100%' },
});
