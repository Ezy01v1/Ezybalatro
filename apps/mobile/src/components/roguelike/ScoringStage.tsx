import type { RunCard } from '@naipes/engine';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOutUp, useReducedMotion } from 'react-native-reanimated';
import { colors, layout, radii, spacing } from '@/theme/tokens';
import { Text } from '@/ui/primitives';
import { PlayingCard } from './PlayingCard';

/** The played cards, centered in the play zone, pulsing as the engine's steps are shown. */
export function ScoringStage({
  cards,
  scoringIds,
  pulses,
  labels,
}: {
  cards: readonly RunCard[];
  scoringIds: readonly string[];
  pulses: Readonly<Record<string, number>>;
  labels: Readonly<Record<string, string>>;
}) {
  const reduced = useReducedMotion();
  const width = layout.card.width;
  const gap = spacing.sm;
  const total = cards.length * width + (cards.length - 1) * gap;
  return (
    <View
      style={[styles.stage, { width: total, height: layout.card.height + layout.card.lift * 2 }]}
      testID="scoring-stage"
    >
      {cards.map((card, i) => (
        <View key={card.id}>
          <PlayingCard
            card={card}
            width={width}
            height={layout.card.height}
            x={i * (width + gap)}
            dimmed={!scoringIds.includes(card.id)}
            pulseKey={pulses[card.id] ?? 0}
            dealIndex={i}
          />
          {labels[card.id] ? (
            <Animated.View
              key={`${card.id}-${pulses[card.id]}`}
              entering={reduced ? undefined : FadeIn.duration(120)}
              exiting={reduced ? undefined : FadeOutUp.duration(400)}
              style={[styles.label, { left: i * (width + gap) }]}
              pointerEvents="none"
            >
              <Text
                variant="caption"
                tone={labels[card.id]!.includes('mult') ? 'mult' : 'chips'}
                style={styles.labelText}
              >
                {labels[card.id]}
              </Text>
            </Animated.View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'center' },
  label: {
    position: 'absolute',
    top: 0,
    width: layout.card.width,
    alignItems: 'center',
  },
  labelText: {
    fontWeight: '700',
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    overflow: 'hidden',
  },
});
