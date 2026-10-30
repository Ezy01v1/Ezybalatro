import { StyleSheet, View, type ViewStyle } from 'react-native';
import type { TableModel } from '@/table/viewModel';
import { radii, spacing, table } from '@/theme/tokens';
import { Text } from '@/ui/primitives';
import { Board } from './Board';
import { PotLabel } from './PotLabel';
import { SeatBadge, type BetPlacement } from './SeatBadge';

type Spot = 'bottom' | 'lowerLeft' | 'upperLeft' | 'top' | 'upperRight' | 'lowerRight';

const SPOTS: Record<Spot, { style: ViewStyle; bet: BetPlacement }> = {
  bottom: { style: { bottom: 0, left: 0, right: 0, alignItems: 'center' }, bet: 'above' },
  lowerLeft: { style: { bottom: '14%', left: 0 }, bet: 'right' },
  upperLeft: { style: { top: '16%', left: 0 }, bet: 'right' },
  top: { style: { top: 0, left: 0, right: 0, alignItems: 'center' }, bet: 'below' },
  upperRight: { style: { top: '16%', right: 0 }, bet: 'left' },
  lowerRight: { style: { bottom: '14%', right: 0 }, bet: 'left' },
};

/** Fixed spots by rival count, clockwise from the lower left (the order `toTableModel` gives). */
const LAYOUTS: Record<number, Spot[]> = {
  1: ['top'],
  2: ['upperLeft', 'upperRight'],
  3: ['upperLeft', 'top', 'upperRight'],
  4: ['lowerLeft', 'upperLeft', 'upperRight', 'lowerRight'],
  5: ['lowerLeft', 'upperLeft', 'top', 'upperRight', 'lowerRight'],
};

function spotsFor(count: number, spectating: boolean): Spot[] {
  // A spectator sees every seat starting at seat 0: that one takes your place at the bottom.
  if (spectating) return count > 0 ? ['bottom', ...(LAYOUTS[count - 1] ?? [])] : [];
  return LAYOUTS[count] ?? [];
}

/** The felt oval: rivals at fixed spots, board, pot and hand name in the center. */
export function OvalTable({ model }: { model: TableModel }) {
  const spots = spotsFor(model.seats.length, model.hero === null);
  const winner = model.handLabel === null ? soleWinner(model) : null;
  return (
    <View style={styles.root} testID="oval-table">
      <View style={styles.felt} />
      <View style={styles.center}>
        {model.handLabel ? (
          <Text variant="bodyMedium" tone="primary" center testID="hand-label">
            {model.handLabel}
          </Text>
        ) : null}
        <Board cards={model.board} />
        <PotLabel pots={model.pots} winner={winner} />
      </View>
      {model.seats.map((seat, i) => {
        const spot = SPOTS[spots[i] ?? 'top'];
        return (
          <View key={seat.seat} style={[styles.spot, spot.style]}>
            <SeatBadge
              seat={seat}
              betPlacement={spot.bet}
              timer={model.timer?.seat === seat.seat ? model.timer : null}
            />
          </View>
        );
      })}
    </View>
  );
}

/** Hand won without showdown: one winner, no hand name. */
function soleWinner(model: TableModel): { name: string; amount: number } | null {
  const all = [...model.seats, ...(model.hero ? [model.hero] : [])];
  const winners = all.filter((s) => s.state === 'winner' && s.won !== null);
  const w = winners.length === 1 ? winners[0] : undefined;
  return w && w.name ? { name: w.name, amount: w.won ?? 0 } : null;
}

const styles = StyleSheet.create({
  root: { flex: 1, marginHorizontal: spacing.md, minHeight: 320 },
  felt: {
    position: 'absolute',
    top: 40,
    bottom: 40,
    left: 28,
    right: 28,
    borderRadius: radii.pill,
    backgroundColor: table.felt,
    borderWidth: 2,
    borderColor: table.feltEdge,
  },
  center: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  spot: { position: 'absolute' },
});
