import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { formatNumber } from '@/game/format';
import { es } from '@/i18n/es';
import type { SeatModel } from '@/table/viewModel';
import { colors, radii, sizes, spacing, table } from '@/theme/tokens';
import { Text } from '@/ui/primitives';
import { SmallCards } from './Board';

/** Screen-reader label for a seat ("Sol, 2.000 fichas, su turno"). */
export function seatA11yLabel(seat: SeatModel): string {
  const t = es.table.seatA11y;
  if (seat.state === 'empty') return t.empty;
  const parts = [t.chips(seat.name ?? '?', formatNumber(seat.stack))];
  if (seat.state === 'turn') parts.push(t.turn);
  else if (seat.state === 'folded') parts.push(t.folded);
  else if (seat.state === 'allIn') parts.push(t.allIn);
  else if (seat.state === 'sittingOut') parts.push(t.sittingOut);
  else if (seat.state === 'disconnected') parts.push(t.disconnected);
  else if (seat.state === 'winner' && seat.won !== null) parts.push(t.wins(formatNumber(seat.won)));
  if (seat.isButton) parts.push(t.button);
  return parts.join(', ');
}

/** Where the street bet sits relative to the seat (toward the center of the oval). */
export type BetPlacement = 'above' | 'below' | 'left' | 'right';

/** A rival around the oval: avatar (initial), name, stack, state marks and street bet. */
export function SeatBadge({
  seat,
  timer,
  betPlacement = 'below',
  style,
}: {
  seat: SeatModel;
  /** Fraction of the turn left (1 → 0) when it is this seat's turn. */
  timer?: { fraction: number; low: boolean } | null;
  betPlacement?: BetPlacement;
  style?: StyleProp<ViewStyle>;
}) {
  if (seat.state === 'empty') {
    return (
      <View
        style={[styles.root, style]}
        accessible
        accessibilityLabel={seatA11yLabel(seat)}
        testID={`seat-${seat.seat}`}
      >
        <View style={[styles.avatar, styles.emptyAvatar]}>
          <Text variant="caption" tone="muted" maxFontSizeMultiplier={1.2}>
            {es.table.emptySeat}
          </Text>
        </View>
      </View>
    );
  }
  const dim = seat.state === 'folded' ? 0.4 : seat.state === 'sittingOut' ? 0.6 : 1;
  const ringColor =
    seat.state === 'turn'
      ? timer?.low
        ? table.timerLow
        : table.timer
      : seat.state === 'winner'
        ? table.winner
        : 'transparent';
  return (
    <View
      style={[
        styles.root,
        betPlacement === 'above' && styles.colReverse,
        betPlacement === 'left' && styles.rowReverse,
        betPlacement === 'right' && styles.row,
        style,
      ]}
      testID={`seat-${seat.seat}`}
    >
      <View
        style={[styles.body, { opacity: dim }]}
        accessible
        accessibilityLabel={seatA11yLabel(seat)}
      >
        <View style={[styles.avatarRing, { borderColor: ringColor }]}>
          <View style={styles.avatar}>
            <Text variant="subtitle">{(seat.name ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          {seat.state === 'turn' && timer ? (
            // Static bar for now; Task 9 turns it into a draining ring with a pulse.
            <View style={styles.timerTrack}>
              <View
                style={[
                  styles.timerFill,
                  { width: `${Math.round(timer.fraction * 100)}%`, backgroundColor: ringColor },
                ]}
              />
            </View>
          ) : null}
          {seat.isButton ? <DealerButton /> : null}
          {seat.state === 'disconnected' ? (
            <Text variant="caption" tone="danger" style={styles.offline}>
              ⦸
            </Text>
          ) : null}
        </View>
        <Text variant="caption" numberOfLines={1} style={styles.name}>
          {seat.name ?? '?'}
        </Text>
        <Text variant="caption" tone="money" style={styles.numeric}>
          {formatNumber(seat.stack)}
        </Text>
        {seat.state === 'allIn' ? (
          <Text variant="caption" tone="primary">
            {es.table.allInTag}
          </Text>
        ) : null}
        {seat.state === 'sittingOut' ? (
          <Text variant="caption" tone="muted">
            {es.table.sittingOutTag}
          </Text>
        ) : null}
        {seat.state === 'winner' && seat.won !== null ? (
          <Text variant="caption" tone="money">{`+${formatNumber(seat.won)}`}</Text>
        ) : null}
        {seat.cards ? <SmallCards cards={seat.cards} /> : null}
      </View>
      <StreetBet amount={seat.streetBet} />
    </View>
  );
}

/** Ivory "D" chip next to the button seat. */
export function DealerButton() {
  return (
    <View style={styles.dealer} accessibilityElementsHidden importantForAccessibility="no">
      <Text variant="caption" tone="primaryFg" maxFontSizeMultiplier={1}>
        D
      </Text>
    </View>
  );
}

/** Chip stack + number for the current street bet. */
export function StreetBet({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <View style={styles.bet} testID="street-bet">
      <View style={styles.chip} />
      <Text variant="caption" tone="chips" style={styles.numeric}>
        {formatNumber(amount)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: spacing.xs },
  colReverse: { flexDirection: 'column-reverse' },
  row: { flexDirection: 'row' },
  rowReverse: { flexDirection: 'row-reverse' },
  body: { alignItems: 'center', width: 76 },
  avatarRing: { borderWidth: 2, borderRadius: radii.pill, padding: 2 },
  avatar: {
    width: sizes.seatAvatar,
    height: sizes.seatAvatar,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyAvatar: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: table.seatEmpty,
  },
  timerTrack: {
    position: 'absolute',
    left: 4,
    right: 4,
    bottom: -6,
    height: 3,
    backgroundColor: colors.border,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  timerFill: { height: 3 },
  dealer: {
    position: 'absolute',
    right: -6,
    top: -4,
    width: 18,
    height: 18,
    borderRadius: radii.pill,
    backgroundColor: colors.card.face,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offline: { position: 'absolute', left: -4, top: -4 },
  name: { maxWidth: 76 },
  numeric: { fontVariant: ['tabular-nums'] },
  bet: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  chip: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.chips },
});
