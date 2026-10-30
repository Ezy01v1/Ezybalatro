import { StyleSheet, View } from 'react-native';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import type { SeatModel } from '@/table/viewModel';
import { colors, radii, sizes, spacing, table } from '@/theme/tokens';
import { Text } from '@/ui/primitives';
import { CardRow } from './Board';
import { DealerButton, seatA11yLabel, StreetBet } from './SeatBadge';

/** Your zone: 2 big cards, name, stack, street bet and your turn timer. */
export function HeroSeat({
  hero,
  timer,
}: {
  hero: SeatModel;
  timer: { fraction: number; low: boolean } | null;
}) {
  const myTurn = hero.state === 'turn';
  const ring = myTurn ? (timer?.low ? table.timerLow : table.timer) : 'transparent';
  const dim = hero.state === 'folded' ? 0.4 : hero.state === 'sittingOut' ? 0.6 : 1;
  return (
    <View style={styles.root} testID="hero-seat">
      <StreetBet amount={hero.streetBet} />
      <View style={[styles.cards, { borderColor: ring, opacity: dim }]}>
        {hero.cards ? (
          <CardRow cards={hero.cards} width={sizes.heroCard.w} height={sizes.heroCard.h} />
        ) : (
          <View style={{ height: sizes.heroCard.h }} />
        )}
        {hero.isButton ? <DealerButton /> : null}
        {myTurn && timer ? (
          <View style={styles.timerTrack}>
            <View
              style={[
                styles.timerFill,
                { width: `${Math.round(timer.fraction * 100)}%`, backgroundColor: ring },
              ]}
            />
          </View>
        ) : null}
      </View>
      <View
        style={styles.info}
        accessible
        accessibilityLabel={seatA11yLabel({ ...hero, name: hero.name ?? es.table.you })}
      >
        <Text variant="bodyMedium" numberOfLines={1} style={styles.name}>
          {hero.name ?? es.table.you}
        </Text>
        <Text variant="numeric" tone="money">
          {formatNumber(hero.stack)}
        </Text>
        {hero.state === 'allIn' ? (
          <Text variant="caption" tone="primary">
            {es.table.allInTag}
          </Text>
        ) : null}
        {hero.state === 'winner' && hero.won !== null ? (
          <Text variant="caption" tone="money">{`+${formatNumber(hero.won)}`}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  cards: { borderWidth: 2, borderRadius: radii.md, padding: spacing.xs },
  timerTrack: {
    position: 'absolute',
    left: spacing.xs,
    right: spacing.xs,
    bottom: -6,
    height: 3,
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  timerFill: { height: 3 },
  info: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  name: { maxWidth: 160 },
});
